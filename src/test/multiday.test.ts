import { describe, expect, it, vi } from 'vitest'
import { people, makeTask } from './fixtures'
import { barToTimes, dayRowSelection, isMultiDay, spanDates, stretchToDate, withDates } from '../lib/time'
import { buildOccurrences, occurrenceDates } from '../lib/recurrence'
import { computeUtilization, plannedByDay } from '../lib/utilization'
import { persistMove } from '../components/CalendarView'

const IST = 'Asia/Kolkata'
// Monday 2 Nov 2026, 2–4 PM IST
const start = '2026-11-02T08:30:00Z'
const end = '2026-11-02T10:30:00Z'

describe('multi-day events', () => {
  it('tells a true multi-day event from a same-day or short overnight one', () => {
    expect(isMultiDay(start, end, IST)).toBe(false)
    expect(isMultiDay('2026-11-02T08:30:00Z', '2026-11-04T10:30:00Z', IST)).toBe(true)
    // 10 PM – 2 AM stays on the time grid.
    expect(isMultiDay('2026-11-02T16:30:00Z', '2026-11-02T20:30:00Z', IST)).toBe(false)
    // Ending exactly at midnight belongs to the day before.
    expect(spanDates('2026-11-02T08:30:00Z', '2026-11-02T18:30:00Z', IST)).toEqual({ first: '2026-11-02', last: '2026-11-02' })
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

  it('turns a drag across the top row into a 9–6 multi-day range', () => {
    const r = dayRowSelection('2026-11-02', '2026-11-05', IST)
    expect(r.start.toISOString()).toBe('2026-11-02T03:30:00.000Z')
    expect(r.end.toISOString()).toBe('2026-11-04T12:30:00.000Z')
    const one = dayRowSelection('2026-11-02', '2026-11-03', IST)
    expect(one.end.getTime() - one.start.getTime()).toBe(30 * 60000)
  })

  it('counts each day at most at capacity, and nothing on non-working days', () => {
    // Friday 6 Nov 9 AM IST → Monday 9 Nov 6 PM IST
    const t = makeTask({ start_at: '2026-11-06T03:30:00Z', end_at: '2026-11-09T12:30:00Z' })
    expect([...plannedByDay(t, people.spandan, IST)]).toEqual([
      ['2026-11-06', 480],
      ['2026-11-07', 0],
      ['2026-11-08', 0],
      ['2026-11-09', 480],
    ])
    const u = computeUtilization([t], people.spandan, ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09'])
    expect(u.plannedMinutes).toBe(960)
    expect(u.overCapacityDays).toEqual([])
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
