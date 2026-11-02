/**
 * Runs the real Supabase migration in PGlite and exercises RLS + RPC functions
 * as different users (Spandan, Mandya, Rupam, an admin, an outsider).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './db'

let t: TestDb
let admin: string, spandan: string, mandya: string, rupam: string, priya: string, gone: string

const at = (h: number, m = 0, day = 2) =>
  `2026-11-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`

async function rpc<T = unknown>(user: string, fn: string, args: unknown[]): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  const rows = await t.as<Record<string, T>>(user, `select public.${fn}(${params}) as r`, args)
  return rows[0].r
}

async function fails(p: Promise<unknown>, code?: string, message?: RegExp) {
  let err: { code?: string; message?: string } | undefined
  try {
    await p
  } catch (e) {
    err = e as { code?: string; message?: string }
  }
  expect(err, 'expected the call to fail').toBeDefined()
  if (code) expect(err!.code).toBe(code)
  if (message) expect(err!.message).toMatch(message)
}

async function task(id: string) {
  const rows = await t.db.query<Record<string, unknown>>(`select * from public.tasks where id = $1`, [id])
  return rows.rows[0]
}
async function assignments(id: string) {
  const rows = await t.db.query<{ user_id: string; approval_status: string }>(
    `select user_id, approval_status from public.task_assignments where task_id = $1 order by user_id`,
    [id],
  )
  return Object.fromEntries(rows.rows.map((r) => [r.user_id, r.approval_status]))
}
async function activityTypes(id: string) {
  const rows = await t.db.query<{ activity_type: string }>(
    `select activity_type from public.task_activities where task_id = $1 order by created_at, id`,
    [id],
  )
  return rows.rows.map((r) => r.activity_type)
}

const newTask = (user: string, owners: string[], extra: Record<string, unknown> = {}) =>
  rpc<string>(user, 'create_task', [{ title: 'Brightspeed Data Validation', start_at: at(14), end_at: at(16), owner_ids: owners, ...extra }])

beforeAll(async () => {
  t = await createTestDb()
  admin = await t.addUser('Coordinator', 'admin')
  spandan = await t.addUser('Spandan')
  mandya = await t.addUser('Mandya')
  rupam = await t.addUser('Rupam', 'requester')
  priya = await t.addUser('Priya')
  gone = await t.addUser('Former')
  await t.db.query(`update public.profiles set active = false where user_id = $1`, [gone])
})

describe('profiles and sign-up', () => {
  it('creates a contributor profile for new auth users and ignores role in metadata', async () => {
    const id = '00000000-0000-4000-8000-0000000000ff'
    await t.db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'sneaky@x.test', '{"name":"Sneaky","role":"admin"}')`,
      [id],
    )
    const p = (await t.db.query<{ role: string; name: string }>(`select role, name from public.profiles where user_id = $1`, [id])).rows[0]
    expect(p).toEqual({ role: 'contributor', name: 'Sneaky' })
    await t.db.query(`delete from auth.users where id = $1`, [id])
  })

  it('does not let users change their own role directly', async () => {
    await fails(t.as(spandan, `update public.profiles set role = 'admin' where user_id = $1`, [spandan]), '42501')
    await fails(rpc(spandan, 'admin_update_profile', [spandan, { role: 'admin' }]), '42501')
  })

  it('lets users set their own name and time zone, validating the zone', async () => {
    await rpc(spandan, 'update_my_profile', ['Spandan', 'Asia/Kolkata'])
    await fails(rpc(spandan, 'update_my_profile', [null, 'Mars/Olympus']), undefined, /time zone/)
  })

  it('lets admins manage people but never removes the last admin', async () => {
    await rpc(admin, 'admin_update_profile', [mandya, { capacity_minutes: 420, work_days: [1, 2, 3, 4] }])
    const m = (await t.db.query<{ capacity_minutes: number; work_days: number[] }>(
      `select capacity_minutes, work_days from public.profiles where user_id = $1`,
      [mandya],
    )).rows[0]
    expect(m).toEqual({ capacity_minutes: 420, work_days: [1, 2, 3, 4] })
    await rpc(admin, 'admin_update_profile', [mandya, { capacity_minutes: 480, work_days: [1, 2, 3, 4, 5] }])
    await fails(rpc(admin, 'admin_update_profile', [admin, { role: 'contributor' }]), undefined, /active admin/)
  })

  it('hides everything from anonymous and inactive users', async () => {
    await fails(t.asAnon(`select * from public.tasks`), '42501')
    await fails(t.asAnon(`select public.create_task('{}'::jsonb)`), '42501')
    expect(await t.as(gone, `select * from public.profiles`)).toHaveLength(0)
    await fails(newTask(gone, [gone]), '42501', /not active/)
  })
})

describe('creating tasks', () => {
  it('creates a confirmed personal task with an accepted owner and an audit entry', async () => {
    const id = await newTask(spandan, [spandan], { custom_fields: [{ id: 'f1', label: 'Blocked By', type: 'text', value: 'Awaiting FCC mapping' }] })
    const row = await task(id)
    expect(row).toMatchObject({ approval_state: 'confirmed', work_status: 'scheduled', created_by: spandan, requester_id: null, version: 1 })
    expect(await assignments(id)).toEqual({ [spandan]: 'accepted' })
    expect(await activityTypes(id)).toEqual(['created'])
  })

  it('validates time, owners and custom fields', async () => {
    await fails(rpc(spandan, 'create_task', [{ title: 'x', start_at: at(16), end_at: at(14), owner_ids: [spandan] }]), undefined, /later than/)
    await fails(rpc(spandan, 'create_task', [{ title: 'x', start_at: at(14), end_at: at(16), owner_ids: [] }]), undefined, /at least one owner/)
    await fails(rpc(spandan, 'create_task', [{ title: ' ', start_at: at(14), end_at: at(16), owner_ids: [spandan] }]), undefined, /title/)
    await fails(newTask(spandan, [gone]), undefined, /not active/)
    const pinned = [1, 2, 3].map((i) => ({ id: `p${i}`, label: `F${i}`, type: 'text', value: '', pinned: true }))
    await fails(newTask(spandan, [spandan], { custom_fields: pinned }), '23514')
    await fails(newTask(spandan, [spandan], { custom_fields: [{ id: 'a', label: 'Bad', type: 'formula', value: '' }] }), '23514')
    await fails(newTask(spandan, [spandan], { custom_fields: [{ id: 'a', label: 'A', type: 'text', value: '' }, { id: 'a', label: 'B', type: 'text', value: '' }] }), '23514')
  })

  it('links follow-ups to the original task and logs it on the parent', async () => {
    const parent = await newTask(spandan, [spandan])
    const child = await newTask(spandan, [spandan], { parent_task_id: parent, start_at: at(10, 0, 3), end_at: at(12, 0, 3) })
    expect((await task(child)).parent_task_id).toBe(parent)
    expect(await activityTypes(parent)).toContain('follow_up_created')
  })
})

describe('request and approval workflow', () => {
  it('confirms a multi-owner request only after every requested owner accepts', async () => {
    const id = await newTask(rupam, [spandan, mandya])
    expect(await task(id)).toMatchObject({ approval_state: 'awaiting_approval', requester_id: rupam })
    expect(await assignments(id)).toEqual({ [spandan]: 'pending', [mandya]: 'pending' })

    expect(await rpc(spandan, 'respond_assignment', [id, 'accept', null, null, null])).toBe('awaiting_approval')
    expect(await rpc(mandya, 'respond_assignment', [id, 'accept', null, null, null])).toBe('confirmed')
    expect((await activityTypes(id)).sort()).toEqual(['request_created', 'assignment_accepted', 'assignment_accepted', 'request_confirmed'].sort())
    await fails(rpc(mandya, 'respond_assignment', [id, 'decline', null, null, null]), undefined, /already responded/)
  })

  it('sends a declined request back for revision and re-asks everyone when the time changes', async () => {
    const id = await newTask(rupam, [spandan, mandya])
    await rpc(spandan, 'respond_assignment', [id, 'accept', null, null, null])
    expect(await rpc(mandya, 'respond_assignment', [id, 'decline', 'On leave', null, null])).toBe('needs_revision')

    // An owner who is not the requester cannot move the proposal.
    await fails(rpc(spandan, 'update_task', [id, 1, { start_at: at(9), end_at: at(11) }]), '42501')

    await rpc(rupam, 'update_task', [id, 1, { start_at: at(10, 0, 4), end_at: at(12, 0, 4) }])
    expect(await task(id)).toMatchObject({ approval_state: 'awaiting_approval', version: 2 })
    expect(await assignments(id)).toEqual({ [spandan]: 'pending', [mandya]: 'pending' })
    expect(await activityTypes(id)).toContain('proposal_updated')
  })

  it('records suggested times for the requester', async () => {
    const id = await newTask(rupam, [mandya])
    expect(await rpc(mandya, 'respond_assignment', [id, 'suggest', 'Tomorrow works', at(9, 0, 3), at(11, 0, 3)])).toBe('needs_revision')
    const rows = await t.as<{ metadata: { start_at: string }; note: string }>(
      rupam,
      `select metadata, note from public.task_activities where task_id = $1 and activity_type = 'time_suggested'`,
      [id],
    )
    expect(rows[0].note).toBe('Tomorrow works')
    expect(new Date(rows[0].metadata.start_at).toISOString()).toBe(new Date(at(9, 0, 3)).toISOString())
    const other = await newTask(rupam, [mandya])
    await fails(rpc(mandya, 'respond_assignment', [other, 'suggest', null, at(11), at(9)]), undefined, /later than/)
  })

  it('keeps a confirmed task confirmed when a new owner is added; only the new owner is pending', async () => {
    const id = await newTask(spandan, [spandan])
    await rpc(spandan, 'set_task_owners', [id, 1, [spandan, mandya]])
    expect(await task(id)).toMatchObject({ approval_state: 'confirmed', version: 2, requester_id: spandan })
    expect(await assignments(id)).toEqual({ [spandan]: 'accepted', [mandya]: 'pending' })
    expect(await rpc(mandya, 'respond_assignment', [id, 'accept', null, null, null])).toBe('confirmed')
    expect((await activityTypes(id)).sort()).toEqual(['created', 'owners_changed', 'assignment_accepted'].sort())
  })

  it('prevents people from answering assignments that are not theirs', async () => {
    const id = await newTask(rupam, [mandya])
    await fails(rpc(priya, 'respond_assignment', [id, 'accept', null, null, null]), '42501')
  })

  it('does not allow duplicate assignments', async () => {
    const id = await newTask(spandan, [spandan, spandan])
    expect(Object.keys(await assignments(id))).toHaveLength(1)
    await fails(t.db.query(`insert into public.task_assignments (task_id, user_id) values ($1, $2)`, [id, spandan]), '23505')
  })
})

describe('progress, status and completion', () => {
  it('starts work when progress moves off zero and completes explicitly', async () => {
    const id = await newTask(spandan, [spandan])
    expect(await rpc(spandan, 'update_task', [id, 1, { progress_percent: 40 }])).toBe(2)
    expect(await task(id)).toMatchObject({ work_status: 'in_progress', progress_percent: 40, completed_at: null })

    await rpc(spandan, 'update_task', [id, 2, { work_status: 'completed' }])
    const done = await task(id)
    expect(done).toMatchObject({ work_status: 'completed', progress_percent: 100 })
    expect(done.completed_at).not.toBeNull()

    await rpc(spandan, 'update_task', [id, 3, { work_status: 'in_progress', progress_percent: 90 }])
    expect(await task(id)).toMatchObject({ work_status: 'in_progress', completed_at: null, progress_percent: 90 })
    // Entries written by one call can share a timestamp, so compare as a multiset.
    expect((await activityTypes(id)).sort()).toEqual(
      ['created', 'status_changed', 'progress', 'completed', 'progress', 'status_changed', 'progress'].sort(),
    )
  })

  it('requires a reason for pending and keeps progress', async () => {
    const id = await newTask(spandan, [spandan])
    await rpc(spandan, 'update_task', [id, 1, { progress_percent: 60 }])
    await fails(rpc(spandan, 'update_task', [id, 2, { work_status: 'pending' }]), undefined, /reason/)
    await rpc(spandan, 'update_task', [id, 2, { work_status: 'pending', pending_reason: 'External dependency — Awaiting FCC mapping' }])
    expect(await task(id)).toMatchObject({ work_status: 'pending', progress_percent: 60, pending_reason: 'External dependency — Awaiting FCC mapping' })
    await rpc(spandan, 'update_task', [id, 3, { work_status: 'in_progress' }])
    expect((await task(id)).pending_reason).toBeNull()
  })

  it('records custom field changes in the history', async () => {
    const id = await newTask(spandan, [spandan], { custom_fields: [{ id: 'f1', label: 'Reviewer', type: 'text', value: 'Mandya' }] })
    await rpc(spandan, 'update_task', [
      id,
      1,
      {
        custom_fields: [
          { id: 'f1', label: 'Reviewer', type: 'text', value: 'Rupam' },
          { id: 'f2', label: 'Expected Resolution', type: 'date', value: '2026-11-02', pinned: true },
        ],
      },
    ])
    const rows = await t.as<{ metadata: { added: string[]; changed: { label: string; to: string }[] } }>(
      spandan,
      `select metadata from public.task_activities where task_id = $1 and activity_type = 'custom_fields'`,
      [id],
    )
    expect(rows[0].metadata.added).toEqual(['Expected Resolution'])
    expect(rows[0].metadata.changed[0]).toMatchObject({ label: 'Reviewer', to: 'Rupam' })
  })
})

describe('concurrency', () => {
  it('rejects a write based on a stale version instead of overwriting', async () => {
    const id = await newTask(spandan, [spandan, mandya])
    await rpc(mandya, 'respond_assignment', [id, 'accept', null, null, null])
    // Both open version 1; Spandan saves first.
    await rpc(spandan, 'update_task', [id, 1, { progress_percent: 50 }])
    await fails(rpc(mandya, 'update_task', [id, 1, { progress_percent: 20 }]), 'PT409')
    expect((await task(id)).progress_percent).toBe(50)
    await fails(rpc(spandan, 'set_task_owners', [id, 1, [spandan]]), 'PT409')
  })
})

describe('row level security', () => {
  let personal: string
  let request: string
  beforeAll(async () => {
    personal = await newTask(spandan, [spandan])
    request = await newTask(rupam, [mandya])
  })

  it('lets contributors and admins see the team calendar', async () => {
    const ids = (await t.as<{ id: string }>(priya, `select id from public.tasks`)).map((r) => r.id)
    expect(ids).toEqual(expect.arrayContaining([personal, request]))
    expect(await t.as(admin, `select id from public.tasks where id = $1`, [personal])).toHaveLength(1)
  })

  it('limits requesters to their own requests', async () => {
    const ids = (await t.as<{ id: string }>(rupam, `select id from public.tasks`)).map((r) => r.id)
    expect(ids).toContain(request)
    expect(ids).not.toContain(personal)
    expect(await t.as(rupam, `select * from public.task_activities where task_id = $1`, [personal])).toHaveLength(0)
    expect(await t.as(rupam, `select * from public.task_assignments where task_id = $1`, [personal])).toHaveLength(0)
    await fails(rpc(rupam, 'update_task', [personal, 1, { title: 'hijacked' }]), 'PT404')
    await fails(rpc(rupam, 'add_bookmark', [personal, 'hi']), 'PT404')
  })

  it('blocks direct table writes for every role', async () => {
    await fails(t.as(spandan, `update public.tasks set title = 'x' where id = $1`, [personal]), '42501')
    await fails(t.as(admin, `delete from public.tasks where id = $1`, [personal]), '42501')
    await fails(t.as(spandan, `insert into public.task_assignments (task_id, user_id, approval_status) values ($1, $2, 'accepted')`, [request, spandan]), '42501')
    await fails(t.as(spandan, `update public.task_assignments set approval_status = 'accepted' where task_id = $1`, [request]), '42501')
  })

  it('keeps the audit trail tamper-proof', async () => {
    await fails(t.as(spandan, `delete from public.task_activities where task_id = $1`, [personal]), '42501')
    await fails(t.as(spandan, `update public.task_activities set note = 'x' where task_id = $1`, [personal]), '42501')
    await fails(
      t.as(spandan, `insert into public.task_activities (task_id, actor_id, activity_type) values ($1, $2, 'completed')`, [personal, spandan]),
      '42501',
    )
    await fails(t.as(spandan, `select public._log($1, 'completed')`, [personal]), '42501')
  })

  it('only lets owners, requesters and admins edit a task', async () => {
    await fails(rpc(mandya, 'update_task', [personal, 1, { progress_percent: 10 }]), '42501')
    await fails(rpc(priya, 'set_task_owners', [personal, 1, [priya]]), '42501')
    expect(await rpc(admin, 'update_task', [personal, 1, { progress_percent: 10 }])).toBe(2)
    // A pending (not yet accepted) owner cannot edit either.
    await fails(rpc(mandya, 'update_task', [request, 1, { progress_percent: 10 }]), '42501')
  })

  it('lets owners and requesters add progress notes, but not bystanders', async () => {
    await rpc(spandan, 'add_bookmark', [personal, 'Initial validation started'])
    await rpc(mandya, 'add_bookmark', [request, 'Will look at this tomorrow'])
    await fails(rpc(priya, 'add_bookmark', [personal, 'drive-by']), '42501')
    await fails(rpc(spandan, 'add_bookmark', [personal, ' ']), undefined, /between 1 and 500/)
    const rows = await t.as<{ is_bookmark: boolean; actor_id: string }>(
      priya,
      `select is_bookmark, actor_id from public.task_activities where task_id = $1 and is_bookmark`,
      [personal],
    )
    expect(rows).toEqual([{ is_bookmark: true, actor_id: spandan }])
  })

  it('only lets the creator or an admin delete', async () => {
    const id = await newTask(spandan, [spandan, mandya])
    await rpc(mandya, 'respond_assignment', [id, 'accept', null, null, null])
    await fails(rpc(mandya, 'delete_task', [id]), '42501')
    await rpc(spandan, 'delete_task', [id])
    expect(await task(id)).toBeUndefined()
    expect((await t.db.query(`select 1 from public.task_activities where task_id = $1`, [id])).rows).toHaveLength(0)
  })
})

describe('deleting people', () => {
  it('only lets admins delete, never themselves, and previews the impact first', async () => {
    const leaver = await t.addUser('Leaver')
    const solo = await newTask(leaver, [leaver])
    const shared = await newTask(spandan, [spandan, leaver])
    await rpc(leaver, 'respond_assignment', [shared, 'accept', null, null, null])
    const request = await newTask(rupam, [mandya, leaver])
    await rpc(mandya, 'respond_assignment', [request, 'accept', null, null, null])
    const raised = await newTask(leaver, [mandya])

    await fails(rpc(spandan, 'admin_delete_user', [leaver, false]), '42501')
    await fails(rpc(admin, 'admin_delete_user', [admin, false]), undefined, /own account/)

    const preview = await rpc<{ sole_tasks: number; shared_tasks: number; raised_tasks: number }>(admin, 'admin_delete_user', [leaver, true])
    expect(preview).toEqual({ sole_tasks: 1, shared_tasks: 2, raised_tasks: 1 })
    expect(await task(solo)).toBeDefined() // dry run changed nothing

    await rpc(admin, 'admin_delete_user', [leaver, false])
    expect(await task(solo)).toBeUndefined()
    expect(await assignments(shared)).toEqual({ [spandan]: 'accepted' })
    // The request was only waiting on the person who left, so it is now confirmed.
    expect(await task(request)).toMatchObject({ approval_state: 'confirmed' })
    expect(await task(raised)).toMatchObject({ created_by: null, requester_id: null })
    expect((await t.db.query(`select 1 from auth.users where id = $1`, [leaver])).rows).toHaveLength(0)
    expect((await t.db.query(`select 1 from public.profiles where user_id = $1`, [leaver])).rows).toHaveLength(0)
    await fails(rpc(admin, 'admin_delete_user', [leaver, false]), 'PT404')
  })
})

describe('admins assign directly', () => {
  it('confirms an admin-created task for several people with no approval', async () => {
    const id = await newTask(admin, [admin, spandan, mandya])
    expect(await task(id)).toMatchObject({ approval_state: 'confirmed', requester_id: admin })
    expect(await assignments(id)).toEqual({ [admin]: 'accepted', [spandan]: 'accepted', [mandya]: 'accepted' })
    expect(await activityTypes(id)).toEqual(['created'])
  })

  it('still asks when a non-admin creates a task for others', async () => {
    const id = await newTask(spandan, [spandan, mandya])
    expect(await task(id)).toMatchObject({ approval_state: 'awaiting_approval' })
    expect(await assignments(id)).toEqual({ [spandan]: 'accepted', [mandya]: 'pending' })
  })

  it('accepts owners an admin adds later, but not ones a non-admin adds', async () => {
    const byAdmin = await newTask(admin, [admin])
    await rpc(admin, 'set_task_owners', [byAdmin, 1, [admin, mandya]])
    expect(await assignments(byAdmin)).toEqual({ [admin]: 'accepted', [mandya]: 'accepted' })

    const bySpandan = await newTask(spandan, [spandan])
    await rpc(spandan, 'set_task_owners', [bySpandan, 1, [spandan, mandya]])
    expect(await assignments(bySpandan)).toEqual({ [spandan]: 'accepted', [mandya]: 'pending' })
  })
})

describe('repeating an existing event', () => {
  const later = [3, 4].map((day) => ({ start_at: at(10, 0, day), end_at: at(11, 0, day) }))
  const original = (user: string, owners: string[]) =>
    rpc<string>(user, 'create_task', [{ title: 'Standup', description: 'Notes', start_at: at(10, 0, 2), end_at: at(11, 0, 2), owner_ids: owners, priority: 'high' }])

  it('links the original and copies its details to each later date', async () => {
    const id = await original(spandan, [spandan])
    const ids = await rpc<string[]>(spandan, 'repeat_task', [id, 1, JSON.stringify(later)])
    expect(ids).toHaveLength(2)
    const first = await task(id)
    const copies = await Promise.all(ids.map(task))
    expect(first.series_id).toBeTruthy()
    expect(first.version).toBe(2)
    for (const c of copies) {
      expect(c.series_id).toBe(first.series_id)
      expect(c.title).toBe('Standup')
      expect(c.description).toBe('Notes')
      expect(c.priority).toBe('high')
    }
    expect(new Date(copies[1].start_at as string).toISOString()).toBe(new Date(later[1].start_at).toISOString())
  })

  it('asks other owners to accept, unless an admin repeats it', async () => {
    const mine = await original(spandan, [spandan, mandya])
    const [copy] = await rpc<string[]>(spandan, 'repeat_task', [mine, 1, JSON.stringify(later)])
    expect(await assignments(copy)).toEqual({ [spandan]: 'accepted', [mandya]: 'pending' })

    const theirs = await original(admin, [admin, mandya])
    const [direct] = await rpc<string[]>(admin, 'repeat_task', [theirs, 1, JSON.stringify(later)])
    expect(await assignments(direct)).toEqual({ [admin]: 'accepted', [mandya]: 'accepted' })
  })

  it('refuses stale versions, repeats of a series, earlier dates and outsiders, leaving nothing behind', async () => {
    const id = await original(spandan, [spandan])
    await fails(rpc(spandan, 'repeat_task', [id, 9, JSON.stringify(later)]), 'PT409')
    await fails(rpc(mandya, 'repeat_task', [id, 1, JSON.stringify(later)]))
    await fails(
      rpc(spandan, 'repeat_task', [id, 1, JSON.stringify([later[0], { start_at: at(10, 0, 1), end_at: at(11, 0, 1) }])]),
      undefined,
      /after the event/,
    )
    expect((await task(id)).series_id).toBeNull()
    await rpc(spandan, 'repeat_task', [id, 1, JSON.stringify(later)])
    await fails(rpc(spandan, 'repeat_task', [id, 2, JSON.stringify(later)]), undefined, /already repeats/)
    await fails(t.asAnon(`select public.repeat_task(gen_random_uuid(), 1, '[]'::jsonb)`), '42501')
  })
})

describe('tickets without a time', () => {
  const ticket = (user: string, owners: string[]) =>
    rpc<string>(user, 'create_ticket', [{ title: 'Churn deck', priority: 'high', owner_ids: owners }])

  it('starts unscheduled, off every calendar, with everyone asked', async () => {
    const id = await ticket(rupam, [spandan, mandya])
    const row = await task(id)
    expect(row).toMatchObject({ unscheduled: true, approval_state: 'awaiting_approval', priority: 'high', requester_id: rupam })
    expect(await assignments(id)).toEqual({ [spandan]: 'pending', [mandya]: 'pending' })
  })

  it('lets an assignee set the time, which accepts it; the others then accept that time', async () => {
    const id = await ticket(rupam, [spandan, mandya])
    await fails(rpc(spandan, 'respond_assignment', [id, 'accept', null, null, null]), undefined, /Choose a date and time/)
    await fails(rpc(rupam, 'update_task', [id, 1, { start_at: at(9), end_at: at(10) }]), '42501')
    await fails(rpc(priya, 'schedule_ticket', [id, at(9), at(10), null]), '42501')
    await rpc(spandan, 'schedule_ticket', [id, at(9), at(10), 'Tomorrow morning'])
    const row = await task(id)
    expect(row.unscheduled).toBe(false)
    expect(new Date(row.start_at as string).toISOString()).toBe(new Date(at(9)).toISOString())
    expect(await assignments(id)).toEqual({ [spandan]: 'accepted', [mandya]: 'pending' })
    expect(await activityTypes(id)).toEqual(expect.arrayContaining(['ticket_scheduled', 'assignment_accepted']))
    await fails(rpc(mandya, 'schedule_ticket', [id, at(11), at(12), null]), 'PT409')
    await rpc(mandya, 'respond_assignment', [id, 'accept', null, null, null])
    expect((await task(id)).approval_state).toBe('confirmed')
  })

  it('puts an admin ticket straight on every assignee calendar once it has a time', async () => {
    const id = await ticket(admin, [spandan, mandya])
    expect(await assignments(id)).toEqual({ [spandan]: 'pending', [mandya]: 'pending' })
    await rpc(mandya, 'schedule_ticket', [id, at(13), at(14), null])
    expect(await assignments(id)).toEqual({ [spandan]: 'accepted', [mandya]: 'accepted' })
    expect((await task(id)).approval_state).toBe('confirmed')
  })

  it('keeps owners an admin adds pending until there is a time, and allows declining', async () => {
    const id = await ticket(admin, [spandan])
    await rpc(admin, 'set_task_owners', [id, 1, [spandan, mandya]])
    expect(await assignments(id)).toEqual({ [spandan]: 'pending', [mandya]: 'pending' })
    await rpc(spandan, 'respond_assignment', [id, 'decline', 'No capacity', null, null])
    expect(await assignments(id)).toMatchObject({ [spandan]: 'declined' })
  })

  it('needs a title and real people, and is closed to outsiders', async () => {
    await fails(rpc(rupam, 'create_ticket', [{ title: ' ', owner_ids: [spandan] }]), undefined, /title/)
    await fails(rpc(rupam, 'create_ticket', [{ title: 'x', owner_ids: [] }]), undefined, /at least one/)
    await fails(t.asAnon(`select public.create_ticket('{}'::jsonb)`), '42501')
  })
})

describe('moving this and following dates of a series', () => {
  const dates = [2, 3, 4, 5].map((day) => ({ start_at: at(10, 0, day), end_at: at(11, 0, day) }))
  const series = (user: string, owners: string[]) =>
    rpc<string[]>(user, 'create_task_series', [{ title: 'Weekly review', owner_ids: owners, occurrences: dates }])
  const times = async (ids: string[]) =>
    (await Promise.all(ids.map(task))).map((r) => [new Date(r.start_at as string).toISOString(), new Date(r.end_at as string).toISOString()])

  it('moves the chosen date and every later one by the same change, leaving earlier ones', async () => {
    const ids = await series(spandan, [spandan])
    // The third date moves from 10–11 to 12–1:30.
    const n = await rpc<number>(spandan, 'reschedule_following', [ids[2], 1, at(12, 0, 4), at(13, 30, 4), 'Asia/Kolkata'])
    expect(n).toBe(2)
    expect(await times(ids)).toEqual([
      [at(10, 0, 2), at(11, 0, 2)],
      [at(10, 0, 3), at(11, 0, 3)],
      [at(12, 0, 4), at(13, 30, 4)],
      [at(12, 0, 5), at(13, 30, 5)],
    ].map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]))
    expect(await activityTypes(ids[3])).toContain('rescheduled')
  })

  it('keeps the wall-clock time across a daylight-saving change', async () => {
    // New York: 9 AM on Fri 30 Oct is 13:00Z; after the change on 1 Nov, 9 AM is 14:00Z.
    const ny = [30, 31].map((d) => ({ start_at: `2026-10-${d}T13:00:00Z`, end_at: `2026-10-${d}T14:00:00Z` }))
    ny.push({ start_at: '2026-11-02T14:00:00Z', end_at: '2026-11-02T15:00:00Z' })
    const ids = await rpc<string[]>(spandan, 'create_task_series', [{ title: 'NY sync', owner_ids: [spandan], occurrences: ny }])
    await rpc(spandan, 'reschedule_following', [ids[0], 1, '2026-10-30T14:00:00Z', '2026-10-30T15:00:00Z', 'America/New_York'])
    const after = await times(ids)
    expect(after[2]).toEqual([new Date('2026-11-02T15:00:00Z').toISOString(), new Date('2026-11-02T16:00:00Z').toISOString()])
  })

  it('refuses stale versions and tasks that do not repeat, and changes nothing then', async () => {
    const ids = await series(spandan, [spandan])
    await fails(rpc(spandan, 'reschedule_following', [ids[1], 7, at(12, 0, 3), at(13, 0, 3), 'UTC']), 'PT409')
    expect(new Date((await task(ids[2])).start_at as string).toISOString()).toBe(new Date(at(10, 0, 4)).toISOString())
    const single = await newTask(spandan, [spandan])
    await fails(rpc(spandan, 'reschedule_following', [single, 1, at(12), at(13), 'UTC']), undefined, /does not repeat/)
    await fails(rpc(mandya, 'reschedule_following', [ids[0], 1, at(12), at(13), 'UTC']))
  })
})

describe('recurring series', () => {
  const occurrences = [2, 3, 4].map((day) => ({ start_at: at(10, 0, day), end_at: at(11, 0, day) }))
  const series = (user: string, owners: string[]) =>
    rpc<string[]>(user, 'create_task_series', [{ title: 'Daily sync', owner_ids: owners, occurrences }])

  it('creates one linked task per date', async () => {
    const ids = await series(spandan, [spandan])
    expect(ids).toHaveLength(3)
    const rows = await Promise.all(ids.map(task))
    expect(new Set(rows.map((r) => r.series_id)).size).toBe(1)
    expect(rows[0].series_id).not.toBeNull()
    expect(rows.every((r) => r.approval_state === 'confirmed')).toBe(true)
  })

  it('rejects too few or too many dates, atomically', async () => {
    await fails(rpc(spandan, 'create_task_series', [{ title: 'x', owner_ids: [spandan], occurrences: occurrences.slice(0, 1) }]), undefined, /at least two/)
    const before = (await t.db.query<{ n: number }>(`select count(*)::int as n from public.tasks where title = 'Atomic'`)).rows[0].n
    await fails(
      rpc(spandan, 'create_task_series', [
        { title: 'Atomic', owner_ids: [spandan], occurrences: [occurrences[0], { start_at: at(11), end_at: at(10) }] },
      ]),
      undefined,
      /later than/,
    )
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from public.tasks where title = 'Atomic'`)).rows[0].n).toBe(before)
  })

  it('needs acceptance from a non-admin, and one answer can cover the whole series', async () => {
    const ids = await series(rupam, [mandya])
    expect(await task(ids[0])).toMatchObject({ approval_state: 'awaiting_approval' })
    const { series_id } = await task(ids[0])
    await rpc(mandya, 'respond_assignment', [ids[0], 'accept', null, null, null])
    expect(await rpc(mandya, 'respond_series', [series_id, 'accept', null])).toBe(2)
    expect((await Promise.all(ids.map(task))).every((r) => r.approval_state === 'confirmed')).toBe(true)
    await fails(rpc(priya, 'respond_series', [series_id, 'maybe', null]), undefined, /Unknown/)
  })

  it('is confirmed immediately when an admin creates it', async () => {
    const ids = await series(admin, [spandan, mandya])
    expect((await Promise.all(ids.map(task))).every((r) => r.approval_state === 'confirmed')).toBe(true)
    expect(await assignments(ids[0])).toEqual({ [spandan]: 'accepted', [mandya]: 'accepted' })
  })

  it('only lets the creator or an admin delete a series', async () => {
    const ids = await series(spandan, [spandan])
    const { series_id } = await task(ids[0])
    await fails(rpc(mandya, 'delete_task_series', [series_id]), '42501')
    expect(await rpc(admin, 'delete_task_series', [series_id])).toBe(3)
    expect(await task(ids[1])).toBeUndefined()
  })

  it('keeps the internal insert function private', async () => {
    await fails(t.as(spandan, `select public._insert_task('{}'::jsonb, null)`), '42501')
    await fails(t.asAnon(`select public.create_task_series('{}'::jsonb)`), '42501')
  })
})
