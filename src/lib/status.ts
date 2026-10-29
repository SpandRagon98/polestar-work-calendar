import type { AssignmentStatus, ApprovalState, Priority, Task, WorkStatus } from './types'

/** What the calendar shows for a task, from the viewer's point of view. */
export type DisplayState = WorkStatus | 'awaiting' | 'needs_revision'

export function myAssignment(task: Task, userId: string | undefined) {
  return userId ? task.assignments.find((a) => a.user_id === userId) : undefined
}

export function displayState(task: Task, userId?: string): DisplayState {
  if (task.approval_state === 'needs_revision') return 'needs_revision'
  if (task.approval_state === 'awaiting_approval') return 'awaiting'
  const mine = myAssignment(task, userId)
  if (mine && (mine.approval_status === 'pending' || mine.approval_status === 'suggested')) return 'awaiting'
  return task.work_status
}

export const STATE_LABEL: Record<DisplayState, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
  awaiting: 'Awaiting approval',
  needs_revision: 'Needs revision',
}

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  pending: 'Pending',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const APPROVAL_STATE_LABEL: Record<ApprovalState, string> = {
  confirmed: 'Confirmed',
  awaiting_approval: 'Awaiting approval',
  needs_revision: 'Needs revision',
}

export const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  pending: 'Awaiting response',
  accepted: 'Accepted',
  declined: 'Declined',
  suggested: 'Suggested new time',
}

export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' }

/**
 * Elapsed time never completes a task. Once the scheduled end passes and the work
 * is still open, the task asks its owners for an update instead.
 */
export function needsUpdate(task: Task, now: Date = new Date()): boolean {
  return (
    task.approval_state === 'confirmed' &&
    (task.work_status === 'scheduled' || task.work_status === 'in_progress') &&
    new Date(task.end_at).getTime() < now.getTime()
  )
}

export const PENDING_REASONS = [
  'Waiting for input',
  'Technical blocker',
  'External dependency',
  'More time required',
  'Other',
] as const

const SEP = ' — '

export function formatPendingReason(reason: string, note?: string): string {
  const n = note?.trim()
  return n ? `${reason}${SEP}${n}` : reason
}

export function parsePendingReason(value: string | null): { reason: string; note: string } {
  if (!value) return { reason: PENDING_REASONS[0], note: '' }
  const i = value.indexOf(SEP)
  const head = i === -1 ? value : value.slice(0, i)
  const note = i === -1 ? '' : value.slice(i + SEP.length)
  return (PENDING_REASONS as readonly string[]).includes(head)
    ? { reason: head, note }
    : { reason: 'Other', note: value }
}

/** Amber at the start, easing toward green as work approaches 100%. */
export function progressColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent)) / 100
  const from = [224, 138, 46] // amber
  const to = [47, 143, 91] // green
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * p * p))
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_TINTS = ['#5C0605', '#AF1F0A', '#8A4B2E', '#615E5E', '#B5651D', '#7A2E3B', '#3F3A39']
export function avatarColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[h % AVATAR_TINTS.length]
}
