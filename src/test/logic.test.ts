import { describe, expect, it } from 'vitest'
import { MANDYA, RUPAM, SPANDAN, makeTask, people, profile } from './fixtures'
import { computeUtilization, findConflicts, isConfirmedFor, percentOf, utilizationLevel } from '../lib/utilization'
import { daysBetween, fromLocalInputs, minutesByLocalDay, toLocalInputs } from '../lib/time'
import { displayState, formatPendingReason, needsUpdate, parsePendingReason, progressColor } from '../lib/status'
import { createField, displayValue, moveField, togglePin, validateFields, exportValue } from '../lib/customFields'
import { canDelete, canEdit, canReschedule, isMyTask } from '../lib/permissions'
import { ApiError, normalizeTask, toApiError } from '../lib/api'

const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']

describe('date and time calculations', () => {
  it('converts local inputs to UTC and back in the user time zone', () => {
    expect(fromLocalInputs('2026-11-02', '14:00', 'Asia/Kolkata')).toBe('2026-11-02T08:30:00.000Z')
    expect(toLocalInputs('2026-11-02T08:30:00Z', 'Asia/Kolkata')).toEqual({ date: '2026-11-02', time: '14:00' })
    expect(toLocalInputs('2026-11-02T08:30:00Z', 'America/New_York')).toEqual({ date: '2026-11-02', time: '03:30' })
    expect(fromLocalInputs('2026-11-02', 'nope', 'UTC')).toBeNull()
  })

  it('splits multi-day tasks into minutes per local day', () => {
    // 22:00 Mon → 02:00 Wed IST
    const m = minutesByLocalDay('2026-11-02T16:30:00Z', '2026-11-03T20:30:00Z', 'Asia/Kolkata')
    expect([...m]).toEqual([
      ['2026-11-02', 120],
      ['2026-11-03', 1440],
      ['2026-11-04', 120],
    ])
  })

  it('uses the local calendar day, not the UTC day', () => {
    // 01:00–03:00 UTC Tuesday is 06:30–08:30 IST Tuesday but 20:00–22:00 Monday in New York
    expect([...minutesByLocalDay('2026-11-03T01:00:00Z', '2026-11-03T03:00:00Z', 'America/New_York')]).toEqual([['2026-11-02', 120]])
  })

  it('handles daylight-saving transitions', () => {
    // US DST ends 2026-11-01 02:00 → 01:00; midnight to midnight is 25 hours.
    const m = minutesByLocalDay('2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z', 'America/New_York')
    expect(m.get('2026-11-01')).toBe(25 * 60)
  })

  it('lists days in a range', () => {
    expect(daysBetween('2026-11-02', '2026-11-05')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
  })
})

describe('multi-owner utilization', () => {
  const brightspeed = makeTask({ title: 'Brightspeed Data Validation', owners: [[SPANDAN, 'accepted'], [MANDYA, 'accepted']] })

  it('gives every accepted owner the full duration', () => {
    const s = computeUtilization([brightspeed], people.spandan, ['2026-11-02'])
    const m = computeUtilization([brightspeed], people.mandya, ['2026-11-02'])
    expect(s.plannedMinutes).toBe(120)
    expect(m.plannedMinutes).toBe(120)
    expect(s.plannedMinutes + m.plannedMinutes).toBe(240) // 4 person-hours
    expect(s.percent).toBe(25)
  })

  it('computes 6h of 8h as 75%', () => {
    const tasks = [
      makeTask({ start_at: '2026-11-02T03:30:00Z', end_at: '2026-11-02T06:30:00Z' }), // 09:00–12:00 IST
      makeTask({ start_at: '2026-11-02T08:30:00Z', end_at: '2026-11-02T11:30:00Z' }), // 14:00–17:00 IST
    ]
    expect(computeUtilization(tasks, people.spandan, ['2026-11-02']).percent).toBe(75)
  })

  it('counts only accepted owners on confirmed, non-cancelled tasks', () => {
    const request = makeTask({ approval_state: 'awaiting_approval', owners: [[SPANDAN, 'accepted'], [MANDYA, 'pending']] })
    const lateAdd = makeTask({ owners: [[SPANDAN, 'accepted'], [MANDYA, 'pending']] })
    const cancelled = makeTask({ work_status: 'cancelled' })
    expect(isConfirmedFor(request, SPANDAN)).toBe(false)
    expect(isConfirmedFor(lateAdd, SPANDAN)).toBe(true)
    expect(isConfirmedFor(lateAdd, MANDYA)).toBe(false)
    expect(isConfirmedFor(cancelled, SPANDAN)).toBe(false)
    expect(computeUtilization([request, lateAdd, cancelled], people.mandya, ['2026-11-02']).plannedMinutes).toBe(0)
  })

  it('never merges overlapping work — both count and a conflict is reported', () => {
    const a = makeTask({ title: 'A' })
    const b = makeTask({ title: 'B', start_at: '2026-11-02T09:30:00Z', end_at: '2026-11-02T11:30:00Z' })
    const u = computeUtilization([a, b], people.spandan, ['2026-11-02'])
    expect(u.plannedMinutes).toBe(240)
    expect(u.conflicts.map(([x, y]) => [x.title, y.title])).toEqual([['A', 'B']])
    expect(findConflicts([a, makeTask({ start_at: a.end_at, end_at: '2026-11-02T12:00:00Z' })])).toHaveLength(0)
  })

  it('gives weekends no capacity and flags over-capacity days', () => {
    const long = makeTask({ start_at: '2026-11-02T02:30:00Z', end_at: '2026-11-02T12:30:00Z' }) // 10h Monday
    const sat = makeTask({ start_at: '2026-11-07T04:30:00Z', end_at: '2026-11-07T06:30:00Z' })
    const u = computeUtilization([long, sat], people.spandan, WEEK)
    expect(u.availableMinutes).toBe(5 * 480)
    expect(u.days[0].percent).toBe(125)
    expect(u.days[5]).toMatchObject({ availableMinutes: 0, plannedMinutes: 120, percent: Infinity })
    expect(u.overCapacityDays).toEqual(['2026-11-02', '2026-11-07'])
    expect(utilizationLevel(125)).toBe('over')
    expect(percentOf(0, 0)).toBeNull()
  })

  it('respects custom capacity and working days', () => {
    const partTime = profile(MANDYA, 'Mandya', { capacity_minutes: 240, work_days: [1, 2, 3] })
    const u = computeUtilization([makeTask({ owners: [[MANDYA, 'accepted']] })], partTime, WEEK)
    expect(u.availableMinutes).toBe(3 * 240)
    expect(u.days[0].percent).toBe(50)
  })
})

describe('progress, status and completion logic', () => {
  it('flags incomplete tasks after their end time but never completes them', () => {
    const t = makeTask({ work_status: 'in_progress', progress_percent: 80 })
    expect(needsUpdate(t, new Date('2026-11-02T10:00:00Z'))).toBe(false)
    expect(needsUpdate(t, new Date('2026-11-02T11:00:00Z'))).toBe(true)
    expect(t.work_status).toBe('in_progress')
    for (const work_status of ['completed', 'pending', 'cancelled'] as const) {
      expect(needsUpdate(makeTask({ work_status }), new Date('2026-12-01T00:00:00Z'))).toBe(false)
    }
    expect(needsUpdate(makeTask({ approval_state: 'awaiting_approval' }), new Date('2026-12-01T00:00:00Z'))).toBe(false)
  })

  it('shows tentative requests as awaiting approval for the people asked', () => {
    expect(displayState(makeTask({ approval_state: 'awaiting_approval' }), SPANDAN)).toBe('awaiting')
    expect(displayState(makeTask({ approval_state: 'needs_revision' }), RUPAM)).toBe('needs_revision')
    const lateAdd = makeTask({ work_status: 'in_progress', owners: [[SPANDAN, 'accepted'], [MANDYA, 'pending']] })
    expect(displayState(lateAdd, MANDYA)).toBe('awaiting')
    expect(displayState(lateAdd, SPANDAN)).toBe('in_progress')
  })

  it('round-trips pending reasons', () => {
    const v = formatPendingReason('Technical blocker', 'Source table locked')
    expect(v).toBe('Technical blocker — Source table locked')
    expect(parsePendingReason(v)).toEqual({ reason: 'Technical blocker', note: 'Source table locked' })
    expect(parsePendingReason('free text')).toEqual({ reason: 'Other', note: 'free text' })
  })

  it('moves the progress colour from amber toward green', () => {
    expect(progressColor(0)).toBe('rgb(224, 138, 46)')
    expect(progressColor(100)).toBe('rgb(47, 143, 91)')
  })
})

describe('custom fields', () => {
  it('adds, renames, reorders, pins and removes fields', () => {
    let f = [createField('text', 'Blocked By'), createField('date', 'Expected Resolution'), createField('person', 'Reviewer')]
    f[0].value = 'Awaiting FCC mapping'
    f = moveField(f, f[2].id, -1)
    expect(f.map((x) => x.label)).toEqual(['Blocked By', 'Reviewer', 'Expected Resolution'])
    f = togglePin(f, f[0].id)
    f = togglePin(f, f[1].id)
    const third = togglePin(f, f[2].id)
    expect(third.filter((x) => x.pinned)).toHaveLength(2) // max two pins
    expect(validateFields(f)).toBeNull()
  })

  it('validates names, duplicates, numbers and links', () => {
    const num = { ...createField('number', 'Rows'), value: 'abc' }
    expect(validateFields([num])).toMatch(/number/)
    expect(validateFields([{ ...createField('url', 'Link'), value: 'javascript:alert(1)' }])).toMatch(/http/)
    expect(validateFields([createField('text', 'A'), createField('text', 'a')])).toMatch(/Two fields/)
    expect(validateFields([{ ...createField('text', 'x'), label: '  ' }])).toMatch(/name/)
  })

  it('treats a person field as a reference, not an assignment', () => {
    const reviewer = { ...createField('person', 'Reviewer'), value: MANDYA }
    const map = new Map([[MANDYA, people.mandya]])
    expect(displayValue(reviewer, map)).toBe('Mandya')
    const t = makeTask({ custom_fields: [reviewer] })
    expect(t.assignments.map((a) => a.user_id)).toEqual([SPANDAN])
    expect(isConfirmedFor(t, MANDYA)).toBe(false)
  })

  it('exports typed values', () => {
    expect(exportValue({ ...createField('number', 'n'), value: '42' })).toBe(42)
    expect(exportValue({ ...createField('checkbox', 'c'), value: 'true' })).toBe(true)
    expect(exportValue({ ...createField('date', 'd'), value: '2026-11-02' })).toEqual(new Date('2026-11-02T00:00:00Z'))
  })
})

describe('permission hints (mirror database rules)', () => {
  const me = (id: string, role: 'admin' | 'contributor' | 'requester' = 'contributor') => ({ user_id: id, role })
  it('matches who may edit and reschedule', () => {
    const own = makeTask()
    expect(canEdit(own, me(SPANDAN))).toBe(true)
    expect(canEdit(own, me(MANDYA))).toBe(false)
    expect(canEdit(own, me('x', 'admin'))).toBe(true)

    const request = makeTask({ approval_state: 'awaiting_approval', created_by: RUPAM, requester_id: RUPAM, owners: [[SPANDAN, 'accepted'], [MANDYA, 'pending']] })
    expect(canReschedule(request, me(SPANDAN))).toBe(false)
    expect(canReschedule(request, me(RUPAM, 'requester'))).toBe(true)
    expect(canEdit(request, me(MANDYA))).toBe(false)
    expect(canDelete(request, me(SPANDAN))).toBe(false)
    expect(isMyTask(request, MANDYA)).toBe(true)
  })
})

describe('API helpers', () => {
  it('recognises version conflicts and permission errors', () => {
    expect(toApiError({ message: 'changed', code: 'PT409' }).isConflict).toBe(true)
    expect(toApiError({ message: 'nope', code: '42501' }).isForbidden).toBe(true)
    expect(toApiError(new TypeError('Failed to fetch')).code).toBe('network')
    expect(toApiError(new ApiError('x', 'y'))).toBeInstanceOf(ApiError)
  })

  it('normalises task rows with embedded assignments and bookmark counts', () => {
    const { assignments, bookmark_count, ...row } = makeTask()
    void assignments
    void bookmark_count
    const t = normalizeTask({ ...row, task_assignments: [{ user_id: SPANDAN, approval_status: 'accepted', responded_at: null }], bookmarks: [{ count: 3 }] })
    expect(t.bookmark_count).toBe(3)
    expect(t.assignments).toHaveLength(1)
  })
})
