import type { Profile, Task } from './types'

// UI hints only. The database functions enforce the same rules (see the
// migration's _can_edit and friends); these just decide which controls to show.

type Me = Pick<Profile, 'user_id' | 'role'>

export function isAcceptedOwner(task: Task, userId: string): boolean {
  return task.assignments.some((a) => a.user_id === userId && a.approval_status === 'accepted')
}

export function isInvolved(task: Task, userId: string): boolean {
  return (
    task.created_by === userId ||
    task.requester_id === userId ||
    task.assignments.some((a) => a.user_id === userId)
  )
}

export function canEdit(task: Task, me: Me): boolean {
  if (me.role === 'admin') return true
  if (task.created_by === me.user_id || task.requester_id === me.user_id) return true
  return me.role === 'contributor' && isAcceptedOwner(task, me.user_id)
}

/** Unconfirmed requests can only be re-timed by whoever proposed them (or an admin). */
export function canReschedule(task: Task, me: Me): boolean {
  if (!canEdit(task, me)) return false
  if (task.approval_state === 'confirmed') return true
  return me.role === 'admin' || task.created_by === me.user_id || task.requester_id === me.user_id
}

export function canAddNote(task: Task, me: Me): boolean {
  return canEdit(task, me) || task.assignments.some((a) => a.user_id === me.user_id)
}

export function canDelete(task: Task, me: Me): boolean {
  return me.role === 'admin' || task.created_by === me.user_id
}

export function isMyTask(task: Task, userId: string): boolean {
  return (
    task.requester_id === userId ||
    task.created_by === userId ||
    task.assignments.some((a) => a.user_id === userId && a.approval_status !== 'declined')
  )
}
