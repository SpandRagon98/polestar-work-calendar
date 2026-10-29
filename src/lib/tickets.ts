import type { Task } from './types'

/** A ticket is any task raised for someone else (it has a requester). */
export function isTicket(task: Task): boolean {
  return task.requester_id !== null
}

export type TicketStatus =
  | 'awaiting'
  | 'needs_revision'
  | 'accepted'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled'

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  awaiting: 'Awaiting acceptance',
  needs_revision: 'Needs revision',
  accepted: 'Accepted',
  in_progress: 'In progress',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const TICKET_STATUS_STYLE: Record<TicketStatus, string> = {
  awaiting: 'bg-st-awaiting/10 text-st-awaiting',
  needs_revision: 'bg-st-pending/10 text-st-pending',
  accepted: 'bg-st-scheduled/12 text-[#5f5a57]',
  in_progress: 'bg-st-progress/12 text-[#9a5512]',
  on_hold: 'bg-st-pending/10 text-st-pending',
  completed: 'bg-st-completed/12 text-st-completed',
  cancelled: 'bg-line text-stone',
}

/** Where a ticket stands, combining the request (approval) and the work. */
export function ticketStatus(task: Task): TicketStatus {
  if (task.work_status === 'cancelled') return 'cancelled'
  if (task.approval_state === 'needs_revision') return 'needs_revision'
  if (task.approval_state === 'awaiting_approval') return 'awaiting'
  switch (task.work_status) {
    case 'completed':
      return 'completed'
    case 'in_progress':
      return 'in_progress'
    case 'pending':
      return 'on_hold'
    default:
      return 'accepted'
  }
}

export function acceptedCount(task: Task): { accepted: number; total: number } {
  return {
    accepted: task.assignments.filter((a) => a.approval_status === 'accepted').length,
    total: task.assignments.length,
  }
}
