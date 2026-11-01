import { describe, expect, it, vi } from 'vitest'
import { people, makeTask } from './fixtures'
import { barToTimes, dailySlot, dayRowSelection, formatLength, formatTimeRange, isMultiDay, scheduledMinutes, shiftSlot, spanDates, stretchToDate, taskSessions, withDates } from '../lib/time'
import { buildOccurrences, occurrenceDates } from '../lib/recurrence'
import { computeUtilization, findConflicts, overlaps, plannedByDay } from '../lib/utilization'
import { persistMove } from '../components/CalendarView'

const IST = 'Asia/Kolkata'
// Monday 2 Nov 2026, 2–4 PM IST
const start = '2026-11-02T08:30:00Z'
const end = '2026-11-02T10:30:00Z'

describe('multi-day events', () => {
  it('reads an event spanning days as the same time slot on each day', () => {
    // Mon 7 PM → Wed 8 PM IST
    const start7 = '2026-11-02T13:30:00Z'
    const end8 = '2026-11-04T14:30:00Z'
    expect(dailySlot(start7, end8, IST)).toEqual({ days: 3, windowMinutes: 60 })
    expect(taskSessions(start7, end8, IST)).toEqual([
      { start_at: '2026-11-02T13:30:00.000Z', end_at: '2026-11-02T14:30:00.000Z' },
      { start_at: '2026-11-03T13:30:00.000Z', end_at: '2026-11-03T14:30:00.000Z' },
      { start_at: '2026-11-04T13:30:00.000Z', end_at: '2026-11-04T14:30:00.000Z' },
    ])
    expect(scheduledMinutes(start7, end8, IST)).toBe(180)
    expect(formatLength(start7, end8, IST)).toBe('1h a day · 3 days')
    expect(formatTimeRange(start7, end8, IST)).toBe('Mon 2 Nov – Wed 4 Nov, 7:00 PM – 8:00 PM daily')
    expect(isMultiDay(start7, end8, IST)).toBe(false)
  })

  it('leaves same-day and short overnight events alone', () => {
    expect(dailySlot(start, end, IST)).toBeNull()
    expect(taskSessions(start, end, IST)).toEqual([{ start_at: start, end_at: end }])
    expect(formatLength(start, end, IST)).toBe('2h')
    // 10 PM – 2 AM
    expect(dailySlot('2026-11-02T16:30:00Z', '2026-11-02T20:30:00Z', IST)).toBeNull()
    // Ending exactly at midnight belongs to the day before.
    expect(spanDates('2026-11-02T08:30:00Z', '2026-11-02T18:30:00Z', IST)).toEqual({ first: '2026-11-02', last: '2026-11-02' })
  })

  it('treats a block lasting most of each day as continuous', () => {
    // Mon 2 PM → Wed 1 PM can't be a daily slot.
    expect(dailySlot('2026-11-02T08:30:00Z', '2026-11-04T07:30:00Z', IST)).toBeNull()
    expect(isMultiDay('2026-11-02T08:30:00Z', '2026-11-04T07:30:00Z', IST)).toBe(true)
  })

  it('keeps the same local time across a daylight-saving change', () => {
    // Sat 31 Oct → Sun 1 Nov, 10–11 AM in New York; clocks change on the Sunday.
    expect(taskSessions('2026-10-31T14:00:00Z', '2026-11-01T16:00:00Z', 'America/New_York')).toEqual([
      { start_at: '2026-10-31T14:00:00.000Z', end_at: '2026-10-31T15:00:00.000Z' },
      { start_at: '2026-11-01T15:00:00.000Z', end_at: '2026-11-01T16:00:00.000Z' },
    ])
  })

  it('moves or resizes every day when one day is dragged', () => {
    const s7 = '2026-11-02T13:30:00Z'
    const e8 = '2026-11-04T14:30:00Z'
    const hour = 3600000
    expect(shiftSlot(s7, e8, IST, { delta: { days: 1, milliseconds: hour } })).toEqual({
      start_at: '2026-11-03T14:30:00.000Z',
      end_at: '2026-11-05T15:30:00.000Z',
    })
    const grown = shiftSlot(s7, e8, IST, { endDelta: { milliseconds: hour } })
    expect(dailySlot(grown.start_at, grown.end_at, IST)).toEqual({ days: 3, windowMinutes: 120 })
  })

  it('saves a drag of one day as a change to the whole event', async () => {
    const task = makeTask({ start_at: '2026-11-02T13:30:00Z', end_at: '2026-11-04T14:30:00Z' })
    const event = { start: new Date(), end: new Date(), extendedProps: { task, slotDate: '2026-11-03' } }
    const save = vi.fn(async () => undefined)
    await persistMove({ event, revert: vi.fn(), delta: { days: 1, milliseconds: 0 } } as never, save, IST)
    expect(save).toHaveBeenCalledWith(task, new Date('2026-11-03T13:30:00Z'), new Date('2026-11-05T14:30:00Z'))
  })

  it('stretches the right edge to a later day, keeping the times of day', () => {
    const t = stretchToDate(start, end, IST, 'right', '2026-11-04')
    expect(t).toEqual({ start_at: '2026-11-02T08:30:00.000Z', end_at: '2026-11-04T10:30:00.000Z' })
  })

  it('stretches the left edge to an earlier day', () => {
    const t = stretchToDate(start, end, IST, 'left', '2026-10-30')
    expect(t).toEqual({ start_at: '2026-10-30T08:30:00.000Z', end_at: '2026-11-02T10:30:00.000Z' })
  })

  it('never lets the edges cross', () => {
    expect(stretchToDate(start, end, IST, 'right', '2026-10-30')).toEqual({ start_at: '2026-11-02T08:30:00.000Z', end_at: '2026-11-02T10:30:00.000Z' })
    expect(stretchToDate(start, end, IST, 'left', '2026-11-09')).toEqual({ start_at: '2026-11-02T08:30:00.000Z', end_at: '2026-11-02T10:30:00.000Z' })
  })

  it('keeps a valid length when shrinking to one day would end before it starts', () => {
    // Mon 2 PM → Wed 1 PM, shrunk to Monday only.
    const t = withDates('2026-11-02T08:30:00Z', '2026-11-04T07:30:00Z', IST, '2026-11-02', '2026-11-02')
    expect(t).toEqual({ start_at: '2026-11-02T08:30:00.000Z', end_at: '2026-11-02T09:30:00.000Z' })
  })

  it('maps a bar drag back to real times', () => {
    // Bar Mon–Wed moved to Tue–Thu: FullCalendar reports an exclusive end date.
    const t = barToTimes('2026-11-02T08:30:00Z', '2026-11-04T10:30:00Z', IST, '2026-11-03', '2026-11-06')
    expect(t).toEqual({ start_at: '2026-11-03T08:30:00.000Z', end_at: '2026-11-05T10:30:00.000Z' })
  })

  it('saves a bar resize as real times, and reverts if saving fails', async () => {
    const task = makeTask({ start_at: '2026-11-02T08:30:00Z', end_at: '2026-11-04T10:30:00Z' })
    const event = { allDay: true, startStr: '2026-11-02', endStr: '2026-11-07', start: new Date(), end: new Date(), extendedProps: { task } }
    const save = vi.fn(async () => undefined)
    const revert = vi.fn()
    expect(await persistMove({ event, revert } as never, save, IST)).toBe(true)
    expect(save).toHaveBeenCalledWith(task, new Date('2026-11-02T08:30:00Z'), new Date('2026-11-06T10:30:00Z'))
    const failing = vi.fn(async () => {
      throw new Error('nope')
    })
    expect(await persistMove({ event, revert } as never, failing, IST)).toBe(false)
    expect(revert).toHaveBeenCalledTimes(1)
  })

  it('turns a drag across the top row into 9–5 on each day', () => {
    const r = dayRowSelection('2026-11-02', '2026-11-05', IST)
    expect(r.start.toISOString()).toBe('2026-11-02T03:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-11-04T11:30:00.000Z')
    const one = dayRowSelection('2026-11-02', '2026-11-03', IST)
    expect(one.end.getTime() - one.start.getTime()).toBe(30 * 60000)
  })

  it('counts a daily slot at its own hours on each day', () => {
    // Mon–Wed, 7–8 PM IST
    const t = makeTask({ start_at: '2026-11-02T13:30:00Z', end_at: '2026-11-04T14:30:00Z' })
    expect([...plannedByDay(t, people.spandan, IST)]).toEqual([
      ['2026-11-02', 60],
      ['2026-11-03', 60],
      ['2026-11-04', 60],
    ])
    const u = computeUtilization([t], people.spandan, ['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(u.plannedMinutes).toBe(180)
    expect(u.overCapacityDays).toEqual([])
  })

  it('only conflicts where a daily slot actually coincides', () => {
    const slot = makeTask({ start_at: '2026-11-02T13:30:00Z', end_at: '2026-11-04T14:30:00Z' }) // 7–8 PM, Mon–Wed
    const morning = makeTask({ start_at: '2026-11-03T04:30:00Z', end_at: '2026-11-03T05:30:00Z' }) // Tue 10 AM
    const evening = makeTask({ start_at: '2026-11-03T14:00:00Z', end_at: '2026-11-03T15:00:00Z' }) // Tue 7:30 PM
    expect(overlaps(slot, morning, IST)).toBe(false)
    expect(overlaps(slot, evening, IST)).toBe(true)
    expect(findConflicts([slot, morning, evening], IST).map(([a, b]) => [a.id, b.id])).toEqual([[slot.id, evening.id]])
  })

  it('caps a continuous block at capacity, with nothing on non-working days', () => {
    // Friday 2 PM IST → Monday 1 PM IST
    const t = makeTask({ start_at: '2026-11-06T08:30:00Z', end_at: '2026-11-09T07:30:00Z' })
    expect([...plannedByDay(t, people.spandan, IST)]).toEqual([
      ['2026-11-06', 480],
      ['2026-11-07', 0],
      ['2026-11-08', 0],
      ['2026-11-09', 480],
    ])
  })

  it('does not cap a long single-day task', () => {
    const t = makeTask({ start_at: '2026-11-02T02:30:00Z', end_at: '2026-11-02T12:30:00Z' })
    expect(plannedByDay(t, people.spandan, IST).get('2026-11-02')).toBe(600)
  })
})

describe('recurring events', () => {
  it('lists every day, weekdays only, or the same weekday', () => {
    expect(occurrenceDates('2026-11-06', '2026-11-10', 'daily')).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'])
    expect(occurrenceDates('2026-11-06', '2026-11-10', 'weekdays')).toEqual(['2026-11-06', '2026-11-09', '2026-11-10'])
    expect(occurrenceDates('2026-11-02', '2026-11-16', 'weekly')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16'])
  })

  it('stops counting just past the limit and handles a bad end date', () => {
    expect(occurrenceDates('2026-01-01', '2036-01-01', 'daily')).toHaveLength(121)
    expect(occurrenceDates('2026-11-02', '', 'daily')).toEqual([])
    expect(occurrenceDates('2026-11-05', '2026-11-02', 'daily')).toEqual([])
  })

  it('keeps the same local time on each date, across daylight saving', () => {
    // US clocks change on 1 Nov 2026.
    const occ = buildOccurrences({
      startDate: '2026-10-31',
      startTime: '10:00',
      endDate: '2026-10-31',
      endTime: '11:00',
      until: '2026-11-01',
      pattern: 'daily',
      zone: 'America/New_York',
    })
    expect(occ).toEqual([
      { start_at: '2026-10-31T14:00:00.000Z', end_at: '2026-10-31T15:00:00.000Z' },
      { start_at: '2026-11-01T15:00:00.000Z', end_at: '2026-11-01T16:00:00.000Z' },
    ])
  })
})
