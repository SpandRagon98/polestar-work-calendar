-- 1. Admins assign directly: when an admin creates a task or adds an owner, every
--    owner is accepted straight away and the task is confirmed. Anyone else still
--    needs each other owner to accept.
-- 2. Recurring events: create_task_series creates one real task per occurrence in
--    a single transaction, linked by tasks.series_id. Each occurrence can then be
--    moved, updated or completed on its own.

alter table public.tasks add column if not exists series_id uuid;
create index if not exists tasks_series_idx on public.tasks (series_id) where series_id is not null;

-- Shared by create_task and create_task_series.
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
                            created_by, requester_id, parent_task_id, approval_state, series_id)
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
          p_series)
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

create or replace function public.create_task(p jsonb)
returns uuid
language sql
security definer
set search_path = public
as $$
  select public._insert_task(p, null)
$$;

-- p: the create_task fields plus occurrences: [{start_at, end_at}, …]. Returns the new ids.
create or replace function public.create_task_series(p jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series uuid := gen_random_uuid();
  v_count int := jsonb_array_length(coalesce(p->'occurrences', '[]'::jsonb));
  v_occ jsonb;
  v_ids uuid[] := '{}';
  v_base jsonb := (p - 'occurrences') - 'parent_task_id';
begin
  perform public._require_role();
  if v_count < 2 then
    raise exception 'A repeating event needs at least two dates.';
  end if;
  if v_count > 120 then
    raise exception 'A repeating event can have at most 120 dates.';
  end if;
  for v_occ in select value from jsonb_array_elements(p->'occurrences') loop
    v_ids := v_ids || public._insert_task(
      v_base || jsonb_build_object('start_at', v_occ->>'start_at', 'end_at', v_occ->>'end_at'), v_series);
  end loop;
  return v_ids;
end;
$$;

-- Same as before, except that owners an admin adds are accepted straight away.
create or replace function public.set_task_owners(p_id uuid, p_version integer, p_owner_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  t public.tasks;
  v_owners uuid[] := coalesce(array(select distinct u from unnest(p_owner_ids) u where u is not null), '{}');
  v_removed uuid[];
  v_added uuid[];
begin
  select * into t from public.tasks where id = p_id for update;
  if not found or not public.can_view_task(p_id) then
    raise exception 'Task not found.' using errcode = 'PT404';
  end if;
  if not public._can_edit(t, r) then
    raise exception 'You do not have permission to change owners of this task.' using errcode = '42501';
  end if;
  if t.version <> p_version then
    raise exception 'This task was changed by someone else. Reload to see the latest version.' using errcode = 'PT409';
  end if;
  perform public._check_owners(v_owners);

  with d as (
    delete from public.task_assignments
     where task_id = p_id and not (user_id = any(v_owners))
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_removed from d;

  with ins as (
    insert into public.task_assignments (task_id, user_id, approval_status, responded_at)
    select p_id, u,
           case when u = uid or r = 'admin' then 'accepted' else 'pending' end,
           case when u = uid or r = 'admin' then now() end
      from unnest(v_owners) u
    on conflict (task_id, user_id) do nothing
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_added from ins;

  if cardinality(v_removed) = 0 and cardinality(v_added) = 0 then
    return t.version;
  end if;

  update public.tasks
     set version = t.version + 1, updated_at = now(),
         requester_id = case when exists (select 1 from unnest(v_added) a where a <> uid)
                             then coalesce(t.requester_id, uid) else t.requester_id end
   where id = p_id;

  perform public._log(p_id, 'owners_changed', null,
    jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));
  perform public._recompute_approval(p_id);
  return t.version + 1;
end;
$$;

-- Answer all of my still-pending occurrences in a series at once. Returns how many.
create or replace function public.respond_series(p_series uuid, p_response text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task uuid;
  v_count int := 0;
begin
  perform public._require_role();
  if p_response not in ('accept', 'decline') then
    raise exception 'Unknown response.';
  end if;
  for v_task in
    select a.task_id from public.task_assignments a
      join public.tasks t on t.id = a.task_id
     where t.series_id = p_series and a.user_id = auth.uid() and a.approval_status = 'pending'
  loop
    perform public.respond_assignment(v_task, p_response, p_note);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Delete a whole series: admins delete all of it, others the occurrences they created.
create or replace function public.delete_task_series(p_series uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._require_role();
  v_count int;
begin
  with d as (
    delete from public.tasks
     where series_id = p_series and (r = 'admin' or created_by = auth.uid())
    returning id)
  select count(*) into v_count from d;
  if v_count = 0 then
    raise exception 'You can only delete a series you created.' using errcode = '42501';
  end if;
  return v_count;
end;
$$;

revoke execute on function public._insert_task(jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.create_task_series(jsonb) from public, anon;
revoke execute on function public.respond_series(uuid, text, text) from public, anon;
revoke execute on function public.delete_task_series(uuid) from public, anon;
grant execute on function public.create_task_series(jsonb) to authenticated;
grant execute on function public.respond_series(uuid, text, text) to authenticated;
grant execute on function public.delete_task_series(uuid) to authenticated;
