import { supabase } from './supabase'
import type { Activity, AssignmentStatus, Profile, Task, TaskInput, TaskPatch } from './types'
import {
  ApiError,
  REQUEST_UPDATE_TYPES,
  normalizeTask,
  toApiError,
  type AssignmentResponse,
  type RequestUpdate,
  type TaskRow,
} from './apiCore'

export * from './apiCore'

function check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
  if (res.error) throw toApiError(res.error)
  return res.data
}

// Tasks are always read with their assignments and bookmark count.
const TASK_SELECT =
  '*, task_assignments(user_id, approval_status, responded_at), bookmarks:task_activities(count)'

function taskQuery() {
  return supabase.from('tasks').select(TASK_SELECT).eq('bookmarks.is_bookmark', true)
}

/** Tasks overlapping [from, to). Callers pass a buffered range. */
export async function fetchTasksInRange(from: Date, to: Date, limit = 2000): Promise<Task[]> {
  const rows = check(
    await taskQuery()
      .lt('start_at', to.toISOString())
      .gt('end_at', from.toISOString())
      .order('start_at')
      .limit(limit),
  ) as unknown as TaskRow[]
  return rows.map(normalizeTask)
}

/** Returns null when the task no longer exists or is no longer visible to the user. */
export async function fetchTask(id: string): Promise<Task | null> {
  const row = check(await taskQuery().eq('id', id).maybeSingle()) as unknown as TaskRow | null
  return row ? normalizeTask(row) : null
}

export async function createTask(input: TaskInput): Promise<string> {
  return check(await supabase.rpc('create_task', { p: input })) as string
}

/** Returns the new version. Throws ApiError with isConflict when `version` is stale. */
export async function updateTask(id: string, version: number, patch: TaskPatch): Promise<number> {
  return check(await supabase.rpc('update_task', { p_id: id, p_version: version, p: patch })) as number
}

export async function setTaskOwners(id: string, version: number, ownerIds: string[]): Promise<number> {
  return check(
    await supabase.rpc('set_task_owners', { p_id: id, p_version: version, p_owner_ids: ownerIds }),
  ) as number
}

export async function respondToAssignment(
  taskId: string,
  response: AssignmentResponse,
  opts: { note?: string; start_at?: string; end_at?: string } = {},
): Promise<string> {
  return check(
    await supabase.rpc('respond_assignment', {
      p_task_id: taskId,
      p_response: response,
      p_note: opts.note ?? null,
      p_start: opts.start_at ?? null,
      p_end: opts.end_at ?? null,
    }),
  ) as string
}

export async function addBookmark(taskId: string, note: string): Promise<void> {
  check(await supabase.rpc('add_bookmark', { p_task_id: taskId, p_note: note }))
}

export async function deleteTask(id: string): Promise<void> {
  check(await supabase.rpc('delete_task', { p_id: id }))
}

export async function fetchActivities(
  taskId: string,
  opts: { bookmarksOnly?: boolean; limit?: number; before?: string } = {},
): Promise<Activity[]> {
  let q = supabase
    .from('task_activities')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.bookmarksOnly) q = q.eq('is_bookmark', true)
  if (opts.before) q = q.lt('created_at', opts.before)
  return check(await q) as Activity[]
}

/** History for many tasks (export). Chunked to keep URLs short; capped by `limit`. */
export async function fetchActivitiesForTasks(taskIds: string[], limit = 5000): Promise<Activity[]> {
  const out: Activity[] = []
  for (let i = 0; i < taskIds.length && out.length < limit; i += 150) {
    const chunk = taskIds.slice(i, i + 150)
    const rows = check(
      await supabase
        .from('task_activities')
        .select('*')
        .in('task_id', chunk)
        .order('created_at')
        .limit(limit - out.length),
    ) as Activity[]
    out.push(...rows)
  }
  return out
}

export async function fetchProfiles(): Promise<Profile[]> {
  return check(await supabase.from('profiles').select('*').order('name')) as Profile[]
}

export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  return check(
    await supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
  ) as Profile | null
}

export async function updateMyProfile(fields: { name?: string; timezone?: string }): Promise<void> {
  check(
    await supabase.rpc('update_my_profile', {
      p_name: fields.name ?? null,
      p_timezone: fields.timezone ?? null,
    }),
  )
}

export async function adminUpdateProfile(
  userId: string,
  fields: Partial<Pick<Profile, 'role' | 'active' | 'capacity_minutes' | 'work_days' | 'name' | 'timezone'>>,
): Promise<void> {
  check(await supabase.rpc('admin_update_profile', { p_user: userId, p: fields }))
}

export async function inviteUser(input: {
  email: string
  name: string
  role: Profile['role']
  redirectTo: string
}): Promise<void> {
  // The Edge Function's URL slug; set VITE_INVITE_FUNCTION if it was deployed under another name.
  const fn = (import.meta.env.VITE_INVITE_FUNCTION as string | undefined) || 'invite-user'
  const { data, error } = await supabase.functions.invoke(fn, { body: input })
  if (error) {
    let message = error.message
    try {
      const body = await (error as { context?: Response }).context?.json()
      if (body?.error) message = body.error
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(message)
  }
  if (data?.error) throw new ApiError(data.error)
}

/** My assignments that still need an answer. */
export async function fetchPendingForMe(userId: string): Promise<Task[]> {
  const rows = check(
    await supabase
      .from('tasks')
      .select(`${TASK_SELECT}, mine:task_assignments!inner(user_id, approval_status)`)
      .eq('bookmarks.is_bookmark', true)
      .eq('mine.user_id', userId)
      .eq('mine.approval_status', 'pending')
      .neq('work_status', 'cancelled')
      .order('start_at')
      .limit(50),
  ) as unknown as TaskRow[]
  return rows.map(normalizeTask)
}

/** Requests I raised, newest first. */
export async function fetchMyRequests(userId: string): Promise<Task[]> {
  const rows = check(
    await taskQuery().eq('requester_id', userId).order('created_at', { ascending: false }).limit(25),
  ) as unknown as TaskRow[]
  return rows.map(normalizeTask)
}

/** Responses to requests I raised (my notification feed). */
export async function fetchRequestUpdates(userId: string): Promise<RequestUpdate[]> {
  return check(
    await supabase
      .from('task_activities')
      .select('*, tasks!inner(title, requester_id)')
      .eq('tasks.requester_id', userId)
      .in('activity_type', REQUEST_UPDATE_TYPES)
      .order('created_at', { ascending: false })
      .limit(25),
  ) as unknown as RequestUpdate[]
}

/** Confirmed commitments of `userIds` that overlap [start, end). */
export async function fetchOverlapping(
  userIds: string[],
  start: string,
  end: string,
  excludeTaskId?: string,
): Promise<Task[]> {
  if (userIds.length === 0) return []
  let q = supabase
    .from('tasks')
    .select(`${TASK_SELECT}, who:task_assignments!inner(user_id, approval_status)`)
    .eq('bookmarks.is_bookmark', true)
    .in('who.user_id', userIds)
    .eq('who.approval_status', 'accepted' satisfies AssignmentStatus)
    .eq('approval_state', 'confirmed')
    .neq('work_status', 'cancelled')
    .lt('start_at', end)
    .gt('end_at', start)
    .limit(20)
  if (excludeTaskId) q = q.neq('id', excludeTaskId)
  const rows = check(await q) as unknown as TaskRow[]
  return rows.map(normalizeTask)
}
