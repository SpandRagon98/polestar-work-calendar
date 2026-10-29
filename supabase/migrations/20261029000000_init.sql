-- Polestar Work Calendar — initial schema
-- Four application tables, RLS on every table, and all writes through
-- SECURITY DEFINER functions so task/assignment/activity changes are atomic,
-- version-checked and audit-logged. Clients only get SELECT on tables.

-- ─────────────────────────────────────────────────────────────────────────────
-- Custom field validation (used by a CHECK constraint on tasks.custom_fields)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.custom_fields_valid(f jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  e jsonb;
  pinned int := 0;
  ids text[] := '{}';
begin
  if f is null or jsonb_typeof(f) <> 'array' then return false; end if;
  if jsonb_array_length(f) > 30 or octet_length(f::text) > 20000 then return false; end if;
  for e in select value from jsonb_array_elements(f) loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or char_length(e->>'id') not between 1 and 64 then return false; end if;
    if (e->>'id') = any(ids) then return false; end if;
    ids := ids || (e->>'id');
    if jsonb_typeof(e->'label') is distinct from 'string' or char_length(btrim(e->>'label')) not between 1 and 60 then return false; end if;
    if coalesce(e->>'type', '') not in ('text','long_text','number','date','dropdown','checkbox','url','person') then return false; end if;
    if char_length(coalesce(e->>'value', '')) > 4000 then return false; end if;
    if e->'pinned' = 'true'::jsonb then pinned := pinned + 1; end if;
  end loop;
  return pinned <= 2;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 1 and 120),
  email            text not null default '',
  role             text not null default 'contributor' check (role in ('admin','contributor','requester')),
  active           boolean not null default true,
  capacity_minutes integer not null default 480 check (capacity_minutes between 0 and 1440),
  -- ISO weekdays that carry capacity (1 = Monday … 7 = Sunday). Mon–Fri by default.
  work_days        smallint[] not null default '{1,2,3,4,5}' check (work_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  -- IANA zone, e.g. 'Asia/Kolkata'. Null until the app records the browser zone on first sign-in.
  timezone         text check (timezone is null or char_length(timezone) <= 64),
  created_at       timestamptz not null default now()
);

create table public.tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  description      text check (char_length(description) <= 5000),
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  work_status      text not null default 'scheduled'
                   check (work_status in ('scheduled','in_progress','pending','completed','cancelled')),
  -- Request/approval state, kept separate from work_status.
  approval_state   text not null default 'confirmed'
                   check (approval_state in ('confirmed','awaiting_approval','needs_revision')),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  priority         text not null default 'medium' check (priority in ('low','medium','high')),
  category         text check (char_length(category) <= 80),
  requester_id     uuid references public.profiles(user_id) on delete set null,
  created_by       uuid references public.profiles(user_id) on delete set null,
  pending_reason   text check (char_length(pending_reason) <= 600),
  custom_fields    jsonb not null default '[]'::jsonb check (public.custom_fields_valid(custom_fields)),
  parent_task_id   uuid references public.tasks(id) on delete set null,
  version          integer not null default 1,
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint tasks_time_order check (end_at > start_at),
  constraint tasks_max_duration check (end_at - start_at <= interval '31 days'),
  constraint tasks_completed_at check ((work_status = 'completed') = (completed_at is not null))
);

create index tasks_start_at_idx on public.tasks (start_at);
create index tasks_end_at_idx on public.tasks (end_at);
create index tasks_requester_idx on public.tasks (requester_id);
create index tasks_created_by_idx on public.tasks (created_by);
create index tasks_parent_idx on public.tasks (parent_task_id);

create table public.task_assignments (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  user_id         uuid not null references public.profiles(user_id) on delete cascade,
  approval_status text not null default 'pending'
                  check (approval_status in ('pending','accepted','declined','suggested')),
  responded_at    timestamptz,
  created_at      timestamptz not null default now(),
  constraint task_assignments_unique unique (task_id, user_id)
);

create index task_assignments_user_idx on public.task_assignments (user_id, approval_status);

create table public.task_activities (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  actor_id      uuid references public.profiles(user_id) on delete set null,
  activity_type text not null check (char_length(activity_type) <= 40),
  note          text check (char_length(note) <= 1000),
  metadata      jsonb not null default '{}'::jsonb,
  is_bookmark   boolean not null default false,
  -- clock_timestamp keeps several entries written in one call in order
  created_at    timestamptz not null default clock_timestamp()
);

create index task_activities_task_idx on public.task_activities (task_id, created_at desc);
create index task_activities_created_idx on public.task_activities (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS helpers (SECURITY DEFINER so policies never recurse into each other)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid() and active
$$;

create or replace function public.is_task_member(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.task_assignments where task_id = p_task and user_id = auth.uid())
$$;

create or replace function public.can_view_task(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.current_app_role()
    when 'admin' then true
    when 'contributor' then true
    when 'requester' then
      exists (select 1 from public.tasks t
              where t.id = p_task and (t.created_by = auth.uid() or t.requester_id = auth.uid()))
      or public.is_task_member(p_task)
    else false
  end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row Level Security — reads only. All writes go through the functions below.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignments enable row level security;
alter table public.task_activities enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (public.current_app_role() is not null);

create policy tasks_select on public.tasks
  for select to authenticated
  using (
    public.current_app_role() in ('admin','contributor')
    or (public.current_app_role() = 'requester'
        and (created_by = auth.uid() or requester_id = auth.uid() or public.is_task_member(id)))
  );

create policy task_assignments_select on public.task_assignments
  for select to authenticated
  using (public.can_view_task(task_id));

create policy task_activities_select on public.task_activities
  for select to authenticated
  using (public.can_view_task(task_id));

revoke all on public.profiles, public.tasks, public.task_assignments, public.task_activities from anon, authenticated;
grant select on public.profiles, public.tasks, public.task_assignments, public.task_activities to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Internal helpers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._require_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare r text;
begin
  r := public.current_app_role();
  if r is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  return r;
end;
$$;

create or replace function public._log(p_task uuid, p_type text, p_note text default null,
                                       p_meta jsonb default '{}'::jsonb, p_bookmark boolean default false)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.task_activities (task_id, actor_id, activity_type, note, metadata, is_bookmark)
  values (p_task, auth.uid(), p_type, p_note, coalesce(p_meta, '{}'::jsonb), p_bookmark);
$$;

-- Who may edit a task's fields (time, progress, status, custom fields, owners).
create or replace function public._can_edit(t public.tasks, r text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when r = 'admin' then true
    when t.created_by = auth.uid() or t.requester_id = auth.uid() then true
    when r = 'contributor' then exists (
      select 1 from public.task_assignments a
      where a.task_id = t.id and a.user_id = auth.uid() and a.approval_status = 'accepted')
    else false
  end
$$;

-- Initial requests become confirmed only when every requested owner accepts.
-- A declined owner or a counter-proposal sends the request back for revision.
-- Once confirmed, the task stays confirmed; later owners are pending individually.
create or replace function public._recompute_approval(p_task uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
  next_state text;
begin
  select approval_state into s from public.tasks where id = p_task;
  if s = 'confirmed' then return s; end if;

  if exists (select 1 from public.task_assignments
             where task_id = p_task and approval_status in ('declined','suggested')) then
    next_state := 'needs_revision';
  elsif not exists (select 1 from public.task_assignments
                    where task_id = p_task and approval_status <> 'accepted') then
    next_state := 'confirmed';
  else
    next_state := 'awaiting_approval';
  end if;

  if next_state <> s then
    update public.tasks set approval_state = next_state, updated_at = now() where id = p_task;
    if next_state = 'confirmed' then
      perform public._log(p_task, 'request_confirmed', null, '{}'::jsonb);
    elsif next_state = 'needs_revision' then
      perform public._log(p_task, 'request_needs_revision', null, '{}'::jsonb);
    end if;
  end if;
  return next_state;
end;
$$;

create or replace function public._uuid_array(j jsonb)
returns uuid[]
language sql
immutable
as $$
  select coalesce(array(select distinct x::uuid from jsonb_array_elements_text(coalesce(j, '[]'::jsonb)) x), '{}')
$$;

create or replace function public._check_owners(p_owners uuid[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if cardinality(p_owners) = 0 then
    raise exception 'Choose at least one owner.';
  end if;
  if cardinality(p_owners) > 25 then
    raise exception 'A task can have at most 25 owners.';
  end if;
  if exists (select 1 from unnest(p_owners) u
             where not exists (select 1 from public.profiles p where p.user_id = u and p.active)) then
    raise exception 'One or more owners are not active team members.';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public RPC: tasks
-- ─────────────────────────────────────────────────────────────────────────────

-- p: {title, description?, start_at, end_at, priority?, category?, custom_fields?, owner_ids[], parent_task_id?}
create or replace function public.create_task(p jsonb)
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

  v_state := case when v_owners <@ array[uid] then 'confirmed' else 'awaiting_approval' end;

  insert into public.tasks (title, description, start_at, end_at, priority, category, custom_fields,
                            created_by, requester_id, parent_task_id, approval_state)
  values (btrim(p->>'title'),
          nullif(btrim(p->>'description'), ''),
          v_start, v_end,
          coalesce(p->>'priority', 'medium'),
          nullif(btrim(p->>'category'), ''),
          coalesce(p->'custom_fields', '[]'::jsonb),
          uid,
          case when v_state = 'awaiting_approval' then uid end,
          v_parent,
          v_state)
  returning id into v_id;

  insert into public.task_assignments (task_id, user_id, approval_status, responded_at)
  select v_id, u,
         case when u = uid then 'accepted' else 'pending' end,
         case when u = uid then now() end
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

-- Patch a task. p may contain: title, description, priority, category, start_at, end_at,
-- custom_fields, progress_percent, work_status, pending_reason, note.
-- Returns the new version. Raises PT409 if p_version is stale.
create or replace function public.update_task(p_id uuid, p_version integer, p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  t public.tasks;
  n public.tasks;
  v_note text := nullif(btrim(p->>'note'), '');
  time_changed boolean;
  details jsonb := '[]'::jsonb;
  cf jsonb;
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

  n := t;
  if p ? 'title' then n.title := btrim(p->>'title'); end if;
  if p ? 'description' then n.description := nullif(btrim(p->>'description'), ''); end if;
  if p ? 'priority' then n.priority := p->>'priority'; end if;
  if p ? 'category' then n.category := nullif(btrim(p->>'category'), ''); end if;
  if p ? 'start_at' then n.start_at := (p->>'start_at')::timestamptz; end if;
  if p ? 'end_at' then n.end_at := (p->>'end_at')::timestamptz; end if;
  if p ? 'custom_fields' then n.custom_fields := coalesce(p->'custom_fields', '[]'::jsonb); end if;
  if p ? 'progress_percent' then n.progress_percent := (p->>'progress_percent')::smallint; end if;
  if p ? 'work_status' then n.work_status := p->>'work_status'; end if;
  if p ? 'pending_reason' then n.pending_reason := nullif(btrim(p->>'pending_reason'), ''); end if;

  if n.start_at is null or n.end_at is null or n.end_at <= n.start_at then
    raise exception 'End time must be later than start time.';
  end if;

  time_changed := n.start_at is distinct from t.start_at or n.end_at is distinct from t.end_at;
  if time_changed and t.approval_state <> 'confirmed' and r <> 'admin'
     and uid is distinct from t.created_by and uid is distinct from t.requester_id then
    raise exception 'Only the requester can change the proposed time. Use "Suggest another time" instead.'
      using errcode = '42501';
  end if;

  -- Progress moving off zero starts the work, unless the caller chose a status explicitly.
  if not (p ? 'work_status') and t.work_status = 'scheduled' and t.progress_percent = 0 and n.progress_percent > 0 then
    n.work_status := 'in_progress';
  end if;

  -- Completion is always explicit: status, 100% and timestamp move together.
  if n.work_status = 'completed' then
    if t.work_status <> 'completed' then
      n.progress_percent := 100;
      n.completed_at := now();
    end if;
  else
    n.completed_at := null;
  end if;

  if n.work_status = 'pending' then
    if n.pending_reason is null then
      raise exception 'Choose a reason when marking a task pending.';
    end if;
  else
    n.pending_reason := null;
  end if;

  update public.tasks set
    title = n.title, description = n.description, priority = n.priority, category = n.category,
    start_at = n.start_at, end_at = n.end_at, custom_fields = n.custom_fields,
    progress_percent = n.progress_percent, work_status = n.work_status,
    pending_reason = n.pending_reason, completed_at = n.completed_at,
    version = t.version + 1, updated_at = now()
  where id = p_id;

  -- Audit trail
  if time_changed then
    perform public._log(p_id, 'rescheduled', v_note, jsonb_build_object(
      'from', jsonb_build_object('start_at', t.start_at, 'end_at', t.end_at),
      'to', jsonb_build_object('start_at', n.start_at, 'end_at', n.end_at)));
    -- Changing the proposal of an unconfirmed request asks every other owner again.
    if t.approval_state <> 'confirmed' then
      update public.task_assignments
         set approval_status = 'pending', responded_at = null
       where task_id = p_id
         and user_id is distinct from coalesce(t.requester_id, t.created_by)
         and approval_status <> 'pending';
      update public.tasks set approval_state = 'awaiting_approval' where id = p_id;
      perform public._log(p_id, 'proposal_updated', null, jsonb_build_object('start_at', n.start_at, 'end_at', n.end_at));
      perform public._recompute_approval(p_id);
    end if;
  end if;

  if n.work_status <> t.work_status then
    perform public._log(p_id,
      case n.work_status when 'completed' then 'completed' else 'status_changed' end,
      v_note,
      jsonb_build_object('from', t.work_status, 'to', n.work_status, 'pending_reason', n.pending_reason));
  elsif n.pending_reason is distinct from t.pending_reason then
    perform public._log(p_id, 'status_changed', v_note,
      jsonb_build_object('from', t.work_status, 'to', n.work_status, 'pending_reason', n.pending_reason));
  end if;

  if n.progress_percent <> t.progress_percent then
    perform public._log(p_id, 'progress', null,
      jsonb_build_object('from', t.progress_percent, 'to', n.progress_percent));
  end if;

  if n.title is distinct from t.title then details := details || '"title"'::jsonb; end if;
  if n.description is distinct from t.description then details := details || '"description"'::jsonb; end if;
  if n.priority is distinct from t.priority then details := details || '"priority"'::jsonb; end if;
  if n.category is distinct from t.category then details := details || '"category"'::jsonb; end if;
  if jsonb_array_length(details) > 0 then
    perform public._log(p_id, 'details_changed', null, jsonb_build_object('fields', details,
      'title', jsonb_build_object('from', t.title, 'to', n.title)));
  end if;

  if n.custom_fields is distinct from t.custom_fields then
    select jsonb_build_object(
      'added', coalesce((select jsonb_agg(e->>'label') from jsonb_array_elements(n.custom_fields) e
                         where not exists (select 1 from jsonb_array_elements(t.custom_fields) o where o->>'id' = e->>'id')), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(o->>'label') from jsonb_array_elements(t.custom_fields) o
                         where not exists (select 1 from jsonb_array_elements(n.custom_fields) e where o->>'id' = e->>'id')), '[]'::jsonb),
      'changed', coalesce((select jsonb_agg(jsonb_build_object('label', e->>'label', 'from_label', o->>'label',
                                                               'from', o->'value', 'to', e->'value'))
                         from jsonb_array_elements(n.custom_fields) e
                         join jsonb_array_elements(t.custom_fields) o on o->>'id' = e->>'id'
                         where (o->'value') is distinct from (e->'value') or (o->>'label') <> (e->>'label')), '[]'::jsonb))
    into cf;
    if cf->'added' <> '[]'::jsonb or cf->'removed' <> '[]'::jsonb or cf->'changed' <> '[]'::jsonb then
      perform public._log(p_id, 'custom_fields', null, cf);
    end if;
  end if;

  return t.version + 1;
end;
$$;

-- Replace the owner list. New owners (other than the caller) start pending;
-- existing assignments keep their state. Returns the new version.
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
    select p_id, u, case when u = uid then 'accepted' else 'pending' end, case when u = uid then now() end
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

-- An owner answers their own pending assignment: 'accept' | 'decline' | 'suggest'.
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
begin
  perform 1 from public.tasks where id = p_task_id for update;
  select * into a from public.task_assignments where task_id = p_task_id and user_id = uid for update;
  if not found then
    raise exception 'You are not assigned to this task.' using errcode = '42501';
  end if;
  if a.approval_status <> 'pending' then
    raise exception 'You have already responded to this request.';
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

create or replace function public.add_bookmark(p_task_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  r text := public._require_role();
  t public.tasks;
  v_id uuid;
begin
  select * into t from public.tasks where id = p_task_id;
  if not found or not public.can_view_task(p_task_id) then
    raise exception 'Task not found.' using errcode = 'PT404';
  end if;
  if not (public._can_edit(t, r) or public.is_task_member(p_task_id)) then
    raise exception 'Only owners and requesters can add progress notes.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 1 and 500 then
    raise exception 'Notes must be between 1 and 500 characters.';
  end if;

  insert into public.task_activities (task_id, actor_id, activity_type, note, is_bookmark)
  values (p_task_id, uid, 'bookmark', btrim(p_note), true)
  returning id into v_id;
  update public.tasks set updated_at = now() where id = p_task_id;
  return v_id;
end;
$$;

create or replace function public.delete_task(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := public._require_role();
  t public.tasks;
begin
  select * into t from public.tasks where id = p_id for update;
  if not found or not public.can_view_task(p_id) then
    raise exception 'Task not found.' using errcode = 'PT404';
  end if;
  if r <> 'admin' and t.created_by is distinct from auth.uid() then
    raise exception 'Only the creator or an admin can delete a task.' using errcode = '42501';
  end if;
  delete from public.tasks where id = p_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Public RPC: profiles
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.update_my_profile(p_name text default null, p_timezone text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_role();
  if p_timezone is not null and not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown time zone.';
  end if;
  update public.profiles
     set name = coalesce(nullif(btrim(p_name), ''), name),
         timezone = coalesce(p_timezone, timezone)
   where user_id = auth.uid();
end;
$$;

-- p: {role?, active?, capacity_minutes?, work_days?, name?, timezone?}
create or replace function public.admin_update_profile(p_user uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public._require_role() <> 'admin' then
    raise exception 'Only admins can manage users.' using errcode = '42501';
  end if;
  if p ? 'timezone' and p->>'timezone' is not null
     and not exists (select 1 from pg_timezone_names where name = p->>'timezone') then
    raise exception 'Unknown time zone.';
  end if;

  update public.profiles set
    role = case when p ? 'role' then p->>'role' else role end,
    active = case when p ? 'active' then (p->>'active')::boolean else active end,
    capacity_minutes = case when p ? 'capacity_minutes' then (p->>'capacity_minutes')::int else capacity_minutes end,
    work_days = case when p ? 'work_days'
                     then coalesce(array(select x::smallint from jsonb_array_elements_text(p->'work_days') x), '{}')
                     else work_days end,
    name = case when p ? 'name' and coalesce(btrim(p->>'name'), '') <> '' then btrim(p->>'name') else name end,
    timezone = case when p ? 'timezone' then p->>'timezone' else timezone end
  where user_id = p_user;

  if not found then
    raise exception 'User not found.' using errcode = 'PT404';
  end if;
  if not exists (select 1 from public.profiles where role = 'admin' and active) then
    raise exception 'At least one active admin is required.';
  end if;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- New auth users get a contributor profile. Role is never taken from user metadata.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name, email)
  values (new.id,
          left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email, 'user'), '@', 1)), 120),
          coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────────────────────
-- Function privileges: nothing for anon; authenticated gets the RPC surface
-- plus the helpers that RLS policies call.
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.current_app_role(),
  public.is_task_member(uuid),
  public.can_view_task(uuid),
  public.custom_fields_valid(jsonb),
  public.create_task(jsonb),
  public.update_task(uuid, integer, jsonb),
  public.set_task_owners(uuid, integer, uuid[]),
  public.respond_assignment(uuid, text, text, timestamptz, timestamptz),
  public.add_bookmark(uuid, text),
  public.delete_task(uuid),
  public.update_my_profile(text, text),
  public.admin_update_profile(uuid, jsonb)
to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: changes are delivered per subscriber through these tables' RLS.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tasks, public.task_assignments, public.task_activities;
  end if;
end;
$$;
