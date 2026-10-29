export type Role = 'admin' | 'contributor' | 'requester'
export type WorkStatus = 'scheduled' | 'in_progress' | 'pending' | 'completed' | 'cancelled'
export type ApprovalState = 'confirmed' | 'awaiting_approval' | 'needs_revision'
export type AssignmentStatus = 'pending' | 'accepted' | 'declined' | 'suggested'
export type Priority = 'low' | 'medium' | 'high'
export type FieldType = 'text' | 'long_text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'url' | 'person'

export interface Profile {
  user_id: string
  name: string
  email: string
  role: Role
  active: boolean
  capacity_minutes: number
  work_days: number[]
  timezone: string | null
  created_at: string
}

/** Values are stored as strings for every type ('true'/'false' for checkboxes, user_id for people). */
export interface CustomField {
  id: string
  label: string
  type: FieldType
  value: string
  pinned?: boolean
  options?: { choices?: string[] }
}

export interface Assignment {
  user_id: string
  approval_status: AssignmentStatus
  responded_at: string | null
}

export interface Task {
  id: string
  title: string
  description: string | null
  start_at: string
  end_at: string
  work_status: WorkStatus
  approval_state: ApprovalState
  progress_percent: number
  priority: Priority
  category: string | null
  requester_id: string | null
  created_by: string | null
  pending_reason: string | null
  custom_fields: CustomField[]
  parent_task_id: string | null
  version: number
  completed_at: string | null
  created_at: string
  updated_at: string
  assignments: Assignment[]
  bookmark_count: number
}

export interface Activity {
  id: string
  task_id: string
  actor_id: string | null
  activity_type: string
  note: string | null
  metadata: Record<string, unknown>
  is_bookmark: boolean
  created_at: string
}

export interface TaskInput {
  title: string
  description?: string
  start_at: string
  end_at: string
  priority?: Priority
  category?: string
  custom_fields?: CustomField[]
  owner_ids: string[]
  parent_task_id?: string
}

export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'priority'
    | 'category'
    | 'start_at'
    | 'end_at'
    | 'custom_fields'
    | 'progress_percent'
    | 'work_status'
    | 'pending_reason'
  >
> & { note?: string }
