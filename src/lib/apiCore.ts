// Backend-independent pieces of the API layer: errors and row normalisation.
import type { Activity, CustomField, Task } from './types'

export class ApiError extends Error {
  code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
  /** Someone else saved a newer version of the task (optimistic-concurrency failure). */
  get isConflict() {
    return this.code === 'PT409'
  }
  get isForbidden() {
    return this.code === '42501'
  }
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; code?: string }
    if (/Failed to fetch|NetworkError/i.test(e.message)) {
      return new ApiError('Network error — check your connection and try again.', 'network')
    }
    return new ApiError(e.message, e.code)
  }
  return new ApiError('Something went wrong.')
}

export const UPDATE_FILE = '20261103000000_tickets_unscheduled_and_series_moves.sql'

/** A database function that hasn't been installed yet, explained in plain words. */
export function explainMissing(err: unknown, fn: string, file = UPDATE_FILE): ApiError {
  const e = toApiError(err)
  return e.message.includes(fn) && /could not find|does not exist|schema cache/i.test(e.message)
    ? new ApiError(`This needs a one-time database update: run supabase/migrations/${file} in the Supabase SQL Editor.`, e.code)
    : e
}

/** A task row as returned with its embedded assignments and bookmark count. */
export type TaskRow = Omit<Task, 'assignments' | 'bookmark_count'> & {
  task_assignments?: Task['assignments']
  bookmarks?: { count: number }[]
}

export function normalizeTask(row: TaskRow): Task {
  const { task_assignments, bookmarks, ...rest } = row
  return {
    ...rest,
    custom_fields: Array.isArray(rest.custom_fields) ? (rest.custom_fields as CustomField[]) : [],
    kind: rest.kind === 'event' ? 'event' : 'task',
    points: Array.isArray(rest.points) ? rest.points : [],
    assignments: task_assignments ?? [],
    bookmark_count: Number(bookmarks?.[0]?.count ?? 0),
  }
}

/** What deleting a person would change (also returned after the delete). */
export interface DeleteImpact {
  sole_tasks: number
  shared_tasks: number
  raised_tasks: number
}

export type AssignmentResponse = 'accept' | 'decline' | 'suggest'

export type RequestUpdate = Activity & { tasks: { title: string; requester_id: string | null } }

export const REQUEST_UPDATE_TYPES = [
  'ticket_scheduled',
  'assignment_accepted',
  'assignment_declined',
  'time_suggested',
  'request_confirmed',
  'request_needs_revision',
]
