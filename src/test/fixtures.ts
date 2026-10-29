import type { Assignment, Profile, Task } from '../lib/types'

export const SPANDAN = 'u-spandan'
export const MANDYA = 'u-mandya'
export const RUPAM = 'u-rupam'

export function profile(id: string, name: string, extra: Partial<Profile> = {}): Profile {
  return {
    user_id: id,
    name,
    email: `${name.toLowerCase()}@polestar.test`,
    role: 'contributor',
    active: true,
    capacity_minutes: 480,
    work_days: [1, 2, 3, 4, 5],
    timezone: 'Asia/Kolkata',
    created_at: '2026-10-01T00:00:00Z',
    ...extra,
  }
}

export const people = {
  spandan: profile(SPANDAN, 'Spandan'),
  mandya: profile(MANDYA, 'Mandya'),
  rupam: profile(RUPAM, 'Rupam', { role: 'requester' }),
}

let n = 0
export function makeTask(partial: Partial<Task> & { owners?: Array<[string, Assignment['approval_status']]> } = {}): Task {
  n += 1
  const { owners = [[SPANDAN, 'accepted']], ...rest } = partial
  return {
    id: `task-${n}`,
    title: `Task ${n}`,
    description: null,
    start_at: '2026-11-02T08:30:00Z', // 14:00 IST, Monday
    end_at: '2026-11-02T10:30:00Z', // 16:00 IST
    work_status: 'scheduled',
    approval_state: 'confirmed',
    progress_percent: 0,
    priority: 'medium',
    category: null,
    requester_id: null,
    created_by: SPANDAN,
    pending_reason: null,
    custom_fields: [],
    parent_task_id: null,
    version: 1,
    completed_at: null,
    created_at: '2026-10-30T05:00:00Z',
    updated_at: '2026-10-30T05:00:00Z',
    assignments: owners.map(([user_id, approval_status]) => ({ user_id, approval_status, responded_at: null })),
    bookmark_count: 0,
    ...rest,
  }
}
