-- 1. Tickets without a time: whoever raises a ticket gives the work and a priority.
--    The people assigned choose the date and time when they accept it; only then
--    does it reach a calendar. tasks.unscheduled marks a ticket nobody has timed yet
--    (its start_at/end_at are placeholders until then).
-- 2. Moving a repeating event can move every later date of the series too.

alter table public.tasks add column if not exists unscheduled boolean not null default false;

-- p: {title, description?, priority?, category?, custom_fields?, owner_ids[]}
create or replace function public.create_ticket(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  v_owners uuid[] := public._uuid_array(p->'owner_ids');
  v_start timestamptz := date_trunc('hour', now()) + interval '1 hour';
  v_id uuid;
begin
  if coalesce(btrim(p->>'title'), '') = '' then
    raise exception 'Ticket title is required.';
  end if;
  perform public._check_owners(v_owners);

  insert into public.tasks (title, description, start_at, end_at, priority, category, custom_fields,
                            created_by, requester_id, approval_state, unscheduled)
  values (btrim(p->>'title'),
          nullif(btrim(p->>'description'), ''),
          v_start, v_start + interval '1 hour',
          coalesce(p->>'priority', 'medium'),
          nullif(btrim(p->>'category'), ''),
          coalesce(p->'custom_fields', '[]'::jsonb),
          uid, uid, 'awaiting_approval', true)
  returning id into v_id;

  insert into public.task_assignments (task_id, user_id, approval_status)
  select v_id, u, 'pending' from unnest(v_owners) u;

  perform public._log(v_id, 'request_created', null,
    jsonb_build_object('owners', to_jsonb(v_owners), 'unscheduled', true));
  return v_id;
end;
$$;

-- An assignee sets the time of an unscheduled ticket, which also accepts it for them.
-- Other assignees then accept that time as usual (straight away when an admin raised it).
create or replace function public.schedule_ticket(p_task_id uuid, p_start timestamptz, p_end timestamptz,
                                                  p_note text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  t public.tasks;
  a public.task_assignments;
begin
  select * into t from public.tasks where id = p_task_id for update;
  if not found or not public.can_view_task(p_task_id) then
    raise exception 'Ticket not found.' using errcode = 'PT404';
  end if;
  select * into a from public.task_assignments where task_id = p_task_id and user_id = uid for update;
  if not found then
    raise exception 'Only the people assigned to this ticket can set its time.' using errcode = '42501';
  end if;
  if not t.unscheduled then
    raise exception 'Someone has already set a time for this ticket. Reload to see it.' using errcode = 'PT409';
  end if;
  if a.approval_status <> 'pending' then
    raise exception 'You have already responded to this ticket.';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'End time must be later than start time.';
  end if;

  update public.tasks
     set start_at = p_start, end_at = p_end, unscheduled = false,
         version = t.version + 1, updated_at = now()
   where id = p_task_id;
  update public.task_assignments set approval_status = 'accepted', responded_at = now() where id = a.id;
  if exists (select 1 from public.profiles where user_id = t.created_by and role = 'admin') then
    update public.task_assignments set approval_status = 'accepted', responded_at = now()
     where task_id = p_task_id and approval_status = 'pending';
  end if;

  perform public._log(p_task_id, 'ticket_scheduled', nullif(btrim(p_note), ''),
    jsonb_build_object('start_at', p_start, 'end_at', p_end));
  perform public._log(p_task_id, 'assignment_accepted', null, '{}'::jsonb);
  return public._recompute_approval(p_task_id);
end;
$$;

-- Nobody accepts an unscheduled ticket except by choosing its time (schedule_ticket
-- clears the flag first). This also covers owners an admin adds later.
create or replace function public._unscheduled_stays_pending()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.approval_status = 'accepted'
     and exists (select 1 from public.tasks where id = new.task_id and unscheduled) then
    new.approval_status := 'pending';
    new.responded_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists task_assignments_unscheduled on public.task_assignments;
create trigger task_assignments_unscheduled
  before insert or update on public.task_assignments
  for each row execute function public._unscheduled_stays_pending();

-- The placeholder time of an unscheduled ticket can't be edited; schedule_ticket sets it.
create or replace function public._unscheduled_keeps_time()
returns trigger
language plpgsql
as $$
begin
  if old.unscheduled and new.unscheduled
     and (new.start_at is distinct from old.start_at or new.end_at is distinct from old.end_at) then
    raise exception 'The people assigned to this ticket choose its time.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_unscheduled_time on public.tasks;
create trigger tasks_unscheduled_time
  before update on public.tasks
  for each row execute function public._unscheduled_keeps_time();

-- Same as before, except that accepting or suggesting needs a time first.
create or replace function public.respond_assignment(p_task_id uuid, p_response text, p_note text default null,
                                                     p_start timestamptz default null, p_end timestamptz default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  a public.task_assignments;
  v_note text := nullif(btrim(p_note), '');
  v_unscheduled boolean;
begin
  select unscheduled into v_unscheduled from public.tasks where id = p_task_id for update;
  select * into a from public.task_assignments where task_id = p_task_id and user_id = uid for update;
  if not found then
    raise exception 'You are not assigned to this task.' using errcode = '42501';
  end if;
  if a.approval_status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;
  if v_unscheduled and p_response in ('accept', 'suggest') then
    raise exception 'Choose a date and time for this ticket to accept it.';
  end if;

  if p_response = 'accept' then
    update public.task_assignments set approval_status = 'accepted', responded_at = now() where id = a.id;
    perform public._log(p_task_id, 'assignment_accepted', v_note, '{}'::jsonb);
  elsif p_response = 'decline' then
    update public.task_assignments set approval_status = 'declined', responded_at = now() where id = a.id;
    perform public._log(p_task_id, 'assignment_declined', v_note, '{}'::jsonb);
  elsif p_response = 'suggest' then
    if p_start is null or p_end is null or p_end <= p_start then
      raise exception 'Suggested end time must be later than the start time.';
    end if;
    update public.task_assignments set approval_status = 'suggested', responded_at = now() where id = a.id;
    perform public._log(p_task_id, 'time_suggested', v_note,
      jsonb_build_object('start_at', p_start, 'end_at', p_end));
  else
    raise exception 'Unknown response.';
  end if;

  -- Touch the task (without bumping version) so subscribers refresh it.
  update public.tasks set updated_at = now() where id = p_task_id;
  return public._recompute_approval(p_task_id);
end;
$$;

-- Move one date of a repeating event and every later date by the same change, on
-- the clock of p_zone (so 7 PM stays 7 PM across daylight saving). Later dates the
-- caller may not re-time are left alone. Returns how many dates moved.
create or replace function public.reschedule_following(p_id uuid, p_version integer, p_start timestamptz,
                                                       p_end timestamptz, p_zone text default 'UTC')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  t public.tasks;
  s public.tasks;
  v_zone text := coalesce(nullif(p_zone, ''), 'UTC');
  v_ds interval;
  v_de interval;
  v_count integer := 1;
begin
  select * into t from public.tasks where id = p_id;
  if not found or not public.can_view_task(p_id) then
    raise exception 'Task not found.' using errcode = 'PT404';
  end if;
  if t.series_id is null then
    raise exception 'This event does not repeat.';
  end if;
  begin
    perform now() at time zone v_zone;
  exception when others then
    v_zone := 'UTC';
  end;

  v_ds := (p_start at time zone v_zone) - (t.start_at at time zone v_zone);
  v_de := (p_end at time zone v_zone) - (t.end_at at time zone v_zone);

  perform public.update_task(p_id, p_version, jsonb_build_object('start_at', p_start, 'end_at', p_end));

  for s in
    select * from public.tasks
     where series_id = t.series_id and id <> p_id and start_at > t.start_at
     order by start_at
     for update
  loop
    continue when not public._can_edit(s, r);
    continue when s.approval_state <> 'confirmed' and r <> 'admin'
                  and uid is distinct from s.created_by and uid is distinct from s.requester_id;
    perform public.update_task(s.id, s.version, jsonb_build_object(
      'start_at', ((s.start_at at time zone v_zone) + v_ds) at time zone v_zone,
      'end_at', ((s.end_at at time zone v_zone) + v_de) at time zone v_zone));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.create_ticket(jsonb) from public, anon;
revoke execute on function public.schedule_ticket(uuid, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.reschedule_following(uuid, integer, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public._unscheduled_stays_pending() from public, anon, authenticated;
revoke execute on function public._unscheduled_keeps_time() from public, anon, authenticated;
grant execute on function public.create_ticket(jsonb) to authenticated;
grant execute on function public.schedule_ticket(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.reschedule_following(uuid, integer, timestamptz, timestamptz, text) to authenticated;
