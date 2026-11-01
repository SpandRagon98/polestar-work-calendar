-- Repeat an event that already exists: it becomes the first date of a new series,
-- and one real copy is created per later date (same details and owners). Owners
-- follow the usual rules: an admin's copies go straight onto calendars; anyone
-- else's need each other owner to accept.

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

revoke execute on function public.repeat_task(uuid, integer, jsonb) from public, anon;
grant execute on function public.repeat_task(uuid, integer, jsonb) to authenticated;
