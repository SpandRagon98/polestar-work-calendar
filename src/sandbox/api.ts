// Sandbox stand-in for src/lib/api.ts (vite --mode sandbox only). Every call runs
// the real SQL functions as the signed-in user, with RLS, inside PGlite.
import type { Activity, Profile, Task, TaskInput, TaskPatch } from '../lib/types'
import {
  ApiError,
  REQUEST_UPDATE_TYPES,
  normalizeTask,
  toApiError,
  type AssignmentResponse,
  type RequestUpdate,
  type TaskRow,
} from '../lib/apiCore'
import { SANDBOX_USERS, asUser, getDb } from './db'
import { emit } from './supabase'

export * from '../lib/apiCore'

const me = () => {
  try {
    return localStorage.getItem('pwc.sandbox.user')
  } catch {
    return null
  }
}

async function q<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await asUser<T>(me(), sql, params)
  } catch (e) {
    throw toApiError(e)
  }
}

const TASK_JSON = `
  to_jsonb(t) || jsonb_build_object(
    'task_assignments', coalesce((select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'approval_status', a.approval_status, 'responded_at', a.responded_at))
                                  from public.task_assignments a where a.task_id = t.id), '[]'::jsonb),
    'bookmarks', jsonb_build_array(jsonb_build_object('count', (select count(*) from public.task_activities x where x.task_id = t.id and x.is_bookmark)))
  ) as row`

async function tasks(where: string, params: unknown[], tail = 'order by t.start_at limit 2000'): Promise<Task[]> {
  const rows = await q<{ row: TaskRow }>(`select ${TASK_JSON} from public.tasks t where ${where} ${tail}`, params)
  return rows.map((r) => normalizeTask(r.row))
}

/** Mimic Realtime: tell subscribers about a changed task and its new history rows. */
async function changed(taskId: string, since: string, deleted = false) {
  if (deleted) return emit('tasks', 'DELETE', { id: taskId })
  emit('tasks', 'UPDATE', { id: taskId })
  const rows = await q<{ row: Activity }>(
    `select to_jsonb(a) as row from public.task_activities a where task_id = $1 and created_at >= $2 order by created_at`,
    [taskId, since],
  )
  rows.forEach((r) => emit('task_activities', 'INSERT', r.row as unknown as Record<string, unknown>))
}

async function stamp() {
  const db = await getDb()
  return (await db.query<{ now: string }>(`select clock_timestamp()::text as now`)).rows[0].now
}

export async function fetchTasksInRange(from: Date, to: Date, limit = 2000): Promise<Task[]> {
  return tasks(`t.start_at < $1 and t.end_at > $2`, [to.toISOString(), from.toISOString()], `order by t.start_at limit ${limit}`)
}

export async function fetchTask(id: string): Promise<Task | null> {
  return (await tasks(`t.id = $1`, [id]))[0] ?? null
}

export async function createTask(input: TaskInput): Promise<string> {
  const since = await stamp()
  const [{ id }] = await q<{ id: string }>(`select public.create_task($1) as id`, [input])
  await changed(id, since)
  if (input.parent_task_id) await changed(input.parent_task_id, since)
  for (const uid of input.owner_ids) emit('task_assignments', 'INSERT', { user_id: uid, task_id: id })
  return id
}

export async function updateTask(id: string, version: number, patch: TaskPatch): Promise<number> {
  const since = await stamp()
  const [{ v }] = await q<{ v: number }>(`select public.update_task($1, $2, $3) as v`, [id, version, patch])
  await changed(id, since)
  return v
}

export async function setTaskOwners(id: string, version: number, ownerIds: string[]): Promise<number> {
  const since = await stamp()
  const [{ v }] = await q<{ v: number }>(`select public.set_task_owners($1, $2, $3::uuid[]) as v`, [id, version, ownerIds])
  await changed(id, since)
  for (const uid of ownerIds) emit('task_assignments', 'UPDATE', { user_id: uid, task_id: id })
  return v
}

export async function respondToAssignment(
  taskId: string,
  response: AssignmentResponse,
  opts: { note?: string; start_at?: string; end_at?: string } = {},
): Promise<string> {
  const since = await stamp()
  const [{ s }] = await q<{ s: string }>(`select public.respond_assignment($1, $2, $3, $4, $5) as s`, [
    taskId,
    response,
    opts.note ?? null,
    opts.start_at ?? null,
    opts.end_at ?? null,
  ])
  await changed(taskId, since)
  emit('task_assignments', 'UPDATE', { user_id: me(), task_id: taskId })
  return s
}

export async function addBookmark(taskId: string, note: string): Promise<void> {
  const since = await stamp()
  await q(`select public.add_bookmark($1, $2)`, [taskId, note])
  await changed(taskId, since)
}

export async function deleteTask(id: string): Promise<void> {
  await q(`select public.delete_task($1)`, [id])
  await changed(id, '', true)
}

export async function fetchActivities(
  taskId: string,
  opts: { bookmarksOnly?: boolean; limit?: number; before?: string } = {},
): Promise<Activity[]> {
  const rows = await q<{ row: Activity }>(
    `select to_jsonb(a) as row from public.task_activities a
      where task_id = $1 and ($2::boolean is not true or is_bookmark) and ($3::timestamptz is null or created_at < $3)
      order by created_at desc limit $4`,
    [taskId, opts.bookmarksOnly ?? false, opts.before ?? null, opts.limit ?? 50],
  )
  return rows.map((r) => r.row)
}

export async function fetchActivitiesForTasks(taskIds: string[], limit = 5000): Promise<Activity[]> {
  if (!taskIds.length) return []
  const rows = await q<{ row: Activity }>(
    `select to_jsonb(a) as row from public.task_activities a where task_id = any($1::uuid[]) order by created_at limit $2`,
    [taskIds, limit],
  )
  return rows.map((r) => r.row)
}

export async function fetchProfiles(): Promise<Profile[]> {
  return (await q<{ row: Profile }>(`select to_jsonb(p) as row from public.profiles p order by name`)).map((r) => r.row)
}

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  return (await q<{ row: Profile }>(`select to_jsonb(p) as row from public.profiles p where user_id = $1`, [userId]))[0]?.row ?? null
}

export async function updateMyProfile(fields: { name?: string; timezone?: string }): Promise<void> {
  await q(`select public.update_my_profile($1, $2)`, [fields.name ?? null, fields.timezone ?? null])
}

export async function adminUpdateProfile(userId: string, fields: Partial<Profile>): Promise<void> {
  await q(`select public.admin_update_profile($1, $2)`, [userId, fields])
}

export async function inviteUser(input: { email: string; name: string; role: Profile['role'] }): Promise<void> {
  const [prof] = await q<{ role: string }>(`select public.current_app_role() as role`)
  if (prof?.role !== 'admin') throw new ApiError('Only admins can invite users.', '42501')
  const db = await getDb()
  const id = crypto.randomUUID()
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('name', $3::text))`, [
    id,
    input.email,
    input.name,
  ])
  await db.query(`update public.profiles set role = $2 where user_id = $1`, [id, input.role])
  ;(SANDBOX_USERS as unknown as { id: string; email: string; name: string; role: string }[]).push({ id, ...input })
}

export async function fetchPendingForMe(userId: string): Promise<Task[]> {
  return tasks(
    `t.work_status <> 'cancelled' and exists (select 1 from public.task_assignments a where a.task_id = t.id and a.user_id = $1 and a.approval_status = 'pending')`,
    [userId],
    'order by t.start_at limit 50',
  )
}

export async function fetchMyRequests(userId: string, limit = 25): Promise<Task[]> {
  return tasks(`t.requester_id = $1`, [userId], `order by t.created_at desc limit ${Number(limit)}`)
}

export async function fetchTicketsAssignedTo(userId: string, limit = 100): Promise<Task[]> {
  return tasks(
    `t.requester_id is not null and t.requester_id <> $1 and exists (select 1 from public.task_assignments a where a.task_id = t.id and a.user_id = $1)`,
    [userId],
    `order by t.created_at desc limit ${Number(limit)}`,
  )
}

export async function fetchAllTickets(limit = 200): Promise<Task[]> {
  return tasks(`t.requester_id is not null`, [], `order by t.created_at desc limit ${Number(limit)}`)
}

export async function fetchRequestUpdates(userId: string): Promise<RequestUpdate[]> {
  const rows = await q<{ row: RequestUpdate }>(
    `select to_jsonb(a) || jsonb_build_object('tasks', jsonb_build_object('title', t.title, 'requester_id', t.requester_id)) as row
       from public.task_activities a join public.tasks t on t.id = a.task_id
      where t.requester_id = $1 and a.activity_type = any($2)
      order by a.created_at desc limit 25`,
    [userId, REQUEST_UPDATE_TYPES],
  )
  return rows.map((r) => r.row)
}

export async function fetchOverlapping(userIds: string[], start: string, end: string, excludeTaskId?: string): Promise<Task[]> {
  if (!userIds.length) return []
  return tasks(
    `t.approval_state = 'confirmed' and t.work_status <> 'cancelled' and t.start_at < $2 and t.end_at > $1
     and ($4::uuid is null or t.id <> $4)
     and exists (select 1 from public.task_assignments a where a.task_id = t.id and a.user_id = any($3::uuid[]) and a.approval_status = 'accepted')`,
    [start, end, userIds, excludeTaskId ?? null],
    'order by t.start_at limit 20',
  )
}
