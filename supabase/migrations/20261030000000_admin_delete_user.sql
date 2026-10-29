-- Admins can permanently delete a person (including invites never accepted).
--
-- Effects, all in one transaction:
--  • tasks where they are the only owner are deleted (with their history);
--  • they are removed from shared tasks; unconfirmed requests are re-evaluated,
--    so a request waiting only on them becomes confirmed;
--  • tickets they raised and history they wrote stay, attributed to nobody;
--  • their login (auth.users) and profile are removed.
--
-- p_dry_run = true returns the same counts without changing anything, so the
-- app can show what will happen before the admin confirms.

create or replace function public.admin_delete_user(p_user uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sole uuid[];
  v_shared uuid[];
  v_raised int;
  v_task uuid;
begin
  if public._require_role() <> 'admin' then
    raise exception 'Only admins can delete people.' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'You can’t delete your own account.';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_user) then
    raise exception 'User not found.' using errcode = 'PT404';
  end if;
  if exists (select 1 from public.profiles where user_id = p_user and role = 'admin' and active)
     and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'At least one active admin is required.';
  end if;

  select coalesce(array_agg(a.task_id), '{}') into v_sole
    from public.task_assignments a
   where a.user_id = p_user
     and not exists (select 1 from public.task_assignments o where o.task_id = a.task_id and o.user_id <> p_user);

  select coalesce(array_agg(a.task_id), '{}') into v_shared
    from public.task_assignments a
   where a.user_id = p_user and not (a.task_id = any(v_sole));

  select count(*) into v_raised
    from public.tasks t
   where (t.requester_id = p_user or t.created_by = p_user) and not (t.id = any(v_sole));

  if not p_dry_run then
    delete from public.tasks where id = any(v_sole);

    foreach v_task in array v_shared loop
      perform public._log(v_task, 'owners_changed', 'Owner removed from the team',
        jsonb_build_object('added', '[]'::jsonb, 'removed', jsonb_build_array(p_user)));
    end loop;
    delete from public.task_assignments where user_id = p_user;
    update public.tasks set version = version + 1, updated_at = now() where id = any(v_shared);
    foreach v_task in array v_shared loop
      perform public._recompute_approval(v_task);
    end loop;

    -- Removing the login cascades to the profile; references elsewhere become null.
    delete from auth.users where id = p_user;
    delete from public.profiles where user_id = p_user;
  end if;

  return jsonb_build_object(
    'sole_tasks', cardinality(v_sole),
    'shared_tasks', cardinality(v_shared),
    'raised_tasks', v_raised
  );
end;
$$;

revoke execute on function public.admin_delete_user(uuid, boolean) from public, anon;
grant execute on function public.admin_delete_user(uuid, boolean) to authenticated;
