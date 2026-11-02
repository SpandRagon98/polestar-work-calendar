-- 1. Events: a task can be marked as an event (a meeting, a call). Events have no
--    progress or completion to track, so they never show as overdue.
-- 2. Points: a short bullet list on any task or event (agenda, what was done),
--    shown when you hover over it on the calendar.

create or replace function public.points_valid(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 50
     and not exists (select 1 from jsonb_array_elements(p) e
                     where jsonb_typeof(e) <> 'string' or char_length(btrim(e #>> '{}')) not between 1 and 300)
$$;

alter table public.tasks add column if not exists kind text not null default 'task';
alter table public.tasks add column if not exists points jsonb not null default '[]'::jsonb;
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('task', 'event'));
alter table public.tasks drop constraint if exists tasks_points_check;
alter table public.tasks add constraint tasks_points_check check (public.points_valid(points));

-- Change whether it's a task or an event, and/or its points. p: {kind?, points?}.
-- Returns the new version. Raises PT409 if p_version is stale.
create or replace function public.update_task_notes(p_id uuid, p_version integer, p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._require_role();
  t public.tasks;
  v_kind text;
  v_points jsonb;
begin
  select * into t from public.tasks where id = p_id for update;
  if not found or not public.can_view_task(p_id) then
    raise exception 'Task not found.' using errcode = 'PT404';
  end if;
  if not public._can_edit(t, r) then
    raise exception 'You do not have permission to edit this task.' using errcode = '42501';
  end if;
  if t.version <> p_version then
    raise exception 'This task was changed by someone else. Reload to see the latest version.' using errcode = 'PT409';
  end if;

  v_kind := coalesce(p->>'kind', t.kind);
  v_points := case when p ? 'points'
                   then coalesce((select jsonb_agg(btrim(e #>> '{}') order by i)
                               from jsonb_array_elements(p->'points') with ordinality x(e, i)
                              where btrim(e #>> '{}') <> ''), '[]'::jsonb)
                   else t.points end;
  if v_kind not in ('task', 'event') then
    raise exception 'Choose task or event.';
  end if;
  if not public.points_valid(v_points) then
    raise exception 'Keep to 50 points of up to 300 characters each.';
  end if;
  if v_kind = t.kind and v_points = t.points then
    return t.version;
  end if;

  update public.tasks set kind = v_kind, points = v_points, version = t.version + 1, updated_at = now()
   where id = p_id;

  if v_kind <> t.kind then
    perform public._log(p_id, 'kind_changed', null, jsonb_build_object('from', t.kind, 'to', v_kind));
  end if;
  if v_points <> t.points then
    perform public._log(p_id, 'points_updated', null, jsonb_build_object(
      'added', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_points) e where not t.points @> jsonb_build_array(e)), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(e) from jsonb_array_elements(t.points) e where not v_points @> jsonb_build_array(e)), '[]'::jsonb)));
  end if;
  return t.version + 1;
end;
$$;

-- Same as before, plus kind and points from p.
create or replace function public._insert_task(p jsonb, p_series uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  v_owners uuid[] := public._uuid_array(p->'owner_ids');
  v_start timestamptz := (p->>'start_at')::timestamptz;
  v_end timestamptz := (p->>'end_at')::timestamptz;
  v_parent uuid := nullif(p->>'parent_task_id', '')::uuid;
  v_direct boolean := r = 'admin';
  v_for_others boolean;
  v_state text;
  v_id uuid;
begin
  if coalesce(btrim(p->>'title'), '') = '' then
    raise exception 'Task title is required.';
  end if;
  if v_start is null or v_end is null or v_end <= v_start then
    raise exception 'End time must be later than start time.';
  end if;
  perform public._check_owners(v_owners);
  if v_parent is not null and not public.can_view_task(v_parent) then
    raise exception 'Parent task not found.' using errcode = 'PT404';
  end if;

  v_for_others := not (v_owners <@ array[uid]);
  v_state := case when v_for_others and not v_direct then 'awaiting_approval' else 'confirmed' end;

  insert into public.tasks (title, description, start_at, end_at, priority, category, custom_fields,
                            created_by, requester_id, parent_task_id, approval_state, series_id, kind, points)
  values (btrim(p->>'title'),
          nullif(btrim(p->>'description'), ''),
          v_start, v_end,
          coalesce(p->>'priority', 'medium'),
          nullif(btrim(p->>'category'), ''),
          coalesce(p->'custom_fields', '[]'::jsonb),
          uid,
          case when v_for_others then uid end,
          v_parent,
          v_state,
          p_series,
          coalesce(p->>'kind', 'task'),
          coalesce((select jsonb_agg(btrim(e #>> '{}') order by i)
                       from jsonb_array_elements(coalesce(p->'points', '[]'::jsonb)) with ordinality x(e, i)
                      where btrim(e #>> '{}') <> ''), '[]'::jsonb))
  returning id into v_id;

  insert into public.task_assignments (task_id, user_id, approval_status, responded_at)
  select v_id, u,
         case when u = uid or v_direct then 'accepted' else 'pending' end,
         case when u = uid or v_direct then now() end
  from unnest(v_owners) u;

  perform public._log(v_id,
    case when v_state = 'confirmed' then 'created' else 'request_created' end,
    null,
    jsonb_build_object('owners', to_jsonb(v_owners), 'start_at', v_start, 'end_at', v_end, 'parent_task_id', v_parent));

  if v_parent is not null then
    perform public._log(v_parent, 'follow_up_created', null,
      jsonb_build_object('follow_up_id', v_id, 'start_at', v_start, 'end_at', v_end));
  end if;

  return v_id;
end;
$$;

-- Repeating keeps whether it's a task or an event. Each date gets its own points.
create or replace function public.repeat_task(p_id uuid, p_version integer, p_occurrences jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._require_role();
  t public.tasks;
  v_series uuid := gen_random_uuid();
  v_count int := jsonb_array_length(coalesce(p_occurrences, '[]'::jsonb));
  v_owners uuid[];
  v_base jsonb;
  v_occ jsonb;
  v_ids uuid[] := '{}';
begin
  select * into t from public.tasks where id = p_id for update;
  if not found or not public.can_view_task(p_id) then
    raise exception 'Task not found.' using errcode = 'PT404';
  end if;
  if not public._can_edit(t, r) then
    raise exception 'You do not have permission to repeat this event.' using errcode = '42501';
  end if;
  if t.version <> p_version then
    raise exception 'This task was changed by someone else. Reload to see the latest version.' using errcode = 'PT409';
  end if;
  if t.series_id is not null then
    raise exception 'This event already repeats.';
  end if;
  if v_count < 1 then
    raise exception 'Choose at least one more date.';
  end if;
  if v_count > 119 then
    raise exception 'A repeating event can have at most 120 dates.';
  end if;

  v_owners := array(select user_id from public.task_assignments
                     where task_id = p_id and approval_status <> 'declined');
  v_base := jsonb_build_object(
    'title', t.title,
    'description', t.description,
    'priority', t.priority,
    'category', t.category,
    'custom_fields', t.custom_fields,
    'kind', t.kind,
    'owner_ids', to_jsonb(v_owners));

  update public.tasks
     set series_id = v_series, version = t.version + 1, updated_at = now()
   where id = p_id;

  for v_occ in select value from jsonb_array_elements(p_occurrences) loop
    if (v_occ->>'start_at')::timestamptz <= t.start_at then
      raise exception 'Repeat dates must be after the event.';
    end if;
    v_ids := v_ids || public._insert_task(
      v_base || jsonb_build_object('start_at', v_occ->>'start_at', 'end_at', v_occ->>'end_at'), v_series);
  end loop;

  perform public._log(p_id, 'series_created', null, jsonb_build_object('added', v_count));
  return v_ids;
end;
$$;

revoke execute on function public._insert_task(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.repeat_task(uuid, integer, jsonb) from public, anon;
revoke execute on function public.update_task_notes(uuid, integer, jsonb) from public, anon;
grant execute on function public.repeat_task(uuid, integer, jsonb) to authenticated;
grant execute on function public.update_task_notes(uuid, integer, jsonb) to authenticated;
