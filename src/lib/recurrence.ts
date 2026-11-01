import { DateTime } from 'luxon'
import { fromLocalInputs } from './time'

export type RepeatPattern = 'daily' | 'weekdays' | 'weekly'

export const REPEAT_LABEL: Record<RepeatPattern, string> = {
  daily: 'Every day',
  weekdays: 'Mon–Fri',
  weekly: 'Every week',
}

export const MAX_OCCURRENCES = 120

export interface RepeatInput {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  until: string
  pattern: RepeatPattern
  zone: string
}

/** The start date of every occurrence, from startDate through `until` inclusive. */
export function occurrenceDates(startDate: string, until: string, pattern: RepeatPattern): string[] {
  const dates: string[] = []
  const stop = DateTime.fromISO(until)
  const first = DateTime.fromISO(startDate)
  if (!stop.isValid || !first.isValid) return dates
  const step = pattern === 'weekly' ? 7 : 1
  // One past the limit is enough for callers to see it was exceeded.
  for (let d = first; d <= stop && dates.length <= MAX_OCCURRENCES; d = d.plus({ days: step })) {
    if (pattern !== 'weekdays' || d.weekday <= 5) dates.push(d.toISODate()!)
  }
  return dates
}

/**
 * One start/end pair per occurrence. Built from local dates and times, so 10 AM
 * stays 10 AM across a daylight-saving change.
 */
export function buildOccurrences(input: RepeatInput): { start_at: string; end_at: string }[] {
  const { startDate, startTime, endDate, endTime, until, pattern, zone } = input
  const dayOffset = Math.round(DateTime.fromISO(endDate).diff(DateTime.fromISO(startDate), 'days').days)
  return occurrenceDates(startDate, until, pattern).flatMap((date) => {
    const start_at = fromLocalInputs(date, startTime, zone)
    const end_at = fromLocalInputs(DateTime.fromISO(date).plus({ days: dayOffset }).toISODate()!, endTime, zone)
    return start_at && end_at ? [{ start_at, end_at }] : []
  })
}
