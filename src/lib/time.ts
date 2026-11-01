import { DateTime } from 'luxon'

export const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function toZoned(iso: string | Date, zone: string): DateTime {
  const dt = typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso)
  return dt.setZone(zone)
}

/** Local date + time inputs (in `zone`) → UTC ISO string for the database. */
export function fromLocalInputs(date: string, time: string, zone: string): string | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone })
  return dt.isValid ? dt.toUTC().toISO() : null
}

export function toLocalInputs(iso: string, zone: string): { date: string; time: string } {
  const dt = toZoned(iso, zone)
  return { date: dt.toISODate() ?? '', time: dt.toFormat('HH:mm') }
}

/**
 * Split [start, end) into minutes per local calendar day (yyyy-mm-dd) in `zone`.
 * Multi-day and midnight-crossing tasks contribute to each day they touch.
 */
export function minutesByLocalDay(start: string | Date, end: string | Date, zone: string): Map<string, number> {
  const out = new Map<string, number>()
  let cur = toZoned(start, zone)
  const stop = toZoned(end, zone)
  while (cur < stop) {
    const nextMidnight = cur.startOf('day').plus({ days: 1 })
    const segEnd = nextMidnight < stop ? nextMidnight : stop
    const mins = Math.round(segEnd.diff(cur, 'minutes').minutes)
    const key = cur.toISODate()!
    out.set(key, (out.get(key) ?? 0) + mins)
    cur = segEnd
  }
  return out
}

/** Every local date from `start` up to but excluding `end`. */
export function daysBetween(startIso: string, endIsoExclusive: string): string[] {
  const days: string[] = []
  let d = DateTime.fromISO(startIso)
  const stop = DateTime.fromISO(endIsoExclusive)
  while (d < stop && days.length < 400) {
    days.push(d.toISODate()!)
    d = d.plus({ days: 1 })
  }
  return days
}

export function durationMinutes(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
}

export function formatHours(minutes: number): string {
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

export function formatTimeRange(start: string, end: string, zone: string): string {
  const s = toZoned(start, zone)
  const e = toZoned(end, zone)
  const slot = dailySlot(start, end, zone)
  if (slot) {
    const lastDay = s.plus({ days: slot.days - 1 })
    const slotEnd = s.plus({ minutes: slot.windowMinutes })
    return `${s.toFormat('ccc d LLL')} – ${lastDay.toFormat('ccc d LLL')}, ${s.toFormat('h:mm a')} – ${slotEnd.toFormat('h:mm a')} daily`
  }
  const sameDay = s.hasSame(e, 'day')
  const left = s.toFormat('ccc d LLL, h:mm a')
  const right = sameDay ? e.toFormat('h:mm a') : e.toFormat('ccc d LLL, h:mm a')
  return `${left} – ${right}`
}

export function formatRelative(iso: string, zone: string): string {
  const dt = toZoned(iso, zone)
  const now = DateTime.now().setZone(zone)
  if (dt.hasSame(now, 'day')) return dt.toFormat('h:mm a')
  if (dt.hasSame(now, 'year')) return dt.toFormat('d LLL, h:mm a')
  return dt.toFormat('d LLL yyyy, h:mm a')
}

export const shiftDate = (date: string, days: number) => DateTime.fromISO(date).plus({ days }).toISODate()!

/** First and last local calendar dates an event touches (an end at exactly midnight belongs to the day before). */
export function spanDates(start: string, end: string, zone: string): { first: string; last: string } {
  return {
    first: toZoned(start, zone).toISODate()!,
    last: toZoned(end, zone).minus({ milliseconds: 1 }).toISODate()!,
  }
}

/** Longest daily window; anything longer really is one continuous block. */
const MAX_DAILY_WINDOW = 16 * 60

/**
 * An event spanning days happens at the same time on each day: Mon 7 PM → Wed 8 PM
 * means 7–8 PM on Monday, Tuesday and Wednesday. Returns the number of days and
 * the daily length, or null for a same-day (or short overnight) event. Worked out
 * on the local clock, so daylight-saving changes don't disturb it.
 */
export function dailySlot(start: string, end: string, zone: string): { days: number; windowMinutes: number } | null {
  const s = toZoned(start, zone)
  const e = toZoned(end, zone)
  const dayDiff = Math.round(e.startOf('day').diff(s.startOf('day'), 'days').days)
  const total = dayDiff * 1440 + (e.hour * 60 + e.minute) - (s.hour * 60 + s.minute)
  const windowMinutes = ((total % 1440) + 1440) % 1440
  const extraDays = (total - windowMinutes) / 1440
  if (extraDays < 1 || windowMinutes === 0 || windowMinutes > MAX_DAILY_WINDOW) return null
  return { days: extraDays + 1, windowMinutes }
}

/** When the event actually happens: one session per day for a daily slot, otherwise just its start and end. */
export function taskSessions(start: string, end: string, zone: string): { start_at: string; end_at: string }[] {
  const slot = dailySlot(start, end, zone)
  if (!slot) return [{ start_at: start, end_at: end }]
  const s = toZoned(start, zone)
  return Array.from({ length: slot.days }, (_, i) => {
    const day = s.plus({ days: i })
    return { start_at: day.toUTC().toISO()!, end_at: day.plus({ minutes: slot.windowMinutes }).toUTC().toISO()! }
  })
}

/** Total scheduled minutes across all sessions. */
export function scheduledMinutes(start: string, end: string, zone: string): number {
  return taskSessions(start, end, zone).reduce((sum, x) => sum + durationMinutes(x.start_at, x.end_at), 0)
}

/** "1h a day · 3 days" for a daily slot, otherwise the plain length. */
export function formatLength(start: string, end: string, zone: string): string {
  const slot = dailySlot(start, end, zone)
  return slot ? `${formatDuration(slot.windowMinutes)} a day · ${slot.days} days` : formatDuration(durationMinutes(start, end))
}

/**
 * A continuous block across days (ending earlier in the day than a slot could, or
 * lasting most of each day), shown as a bar. Rare: most events spanning days are slots.
 */
export function isMultiDay(start: string, end: string, zone: string): boolean {
  const { first, last } = spanDates(start, end, zone)
  return first !== last && durationMinutes(start, end) >= 12 * 60 && !dailySlot(start, end, zone)
}

/** Shift a daily-slot event after a drag or resize of one of its days. */
export function shiftSlot(
  start: string,
  end: string,
  zone: string,
  moved: { delta?: { days: number; milliseconds: number }; startDelta?: { milliseconds: number }; endDelta?: { milliseconds: number } },
): { start_at: string; end_at: string } {
  const s = toZoned(start, zone)
  const e = toZoned(end, zone)
  const { delta, startDelta, endDelta } = moved
  // Resizing changes the time of every day; the days themselves change via the side handles.
  const newStart = s.plus({ days: delta?.days ?? 0, milliseconds: (delta?.milliseconds ?? 0) + (startDelta?.milliseconds ?? 0) })
  const newEnd = e.plus({ days: delta?.days ?? 0, milliseconds: (delta?.milliseconds ?? 0) + (endDelta?.milliseconds ?? 0) })
  return { start_at: newStart.toUTC().toISO()!, end_at: newEnd.toUTC().toISO()! }
}

/**
 * Move an event onto new first/last dates, keeping its start and end times of day.
 * If that would end before it starts (shrinking to one day), it keeps a sensible length.
 */
export function withDates(start: string, end: string, zone: string, first: string, last: string): { start_at: string; end_at: string } {
  const s = toZoned(start, zone)
  const e = toZoned(end, zone)
  const newStart = DateTime.fromISO(first, { zone }).set({ hour: s.hour, minute: s.minute })
  // An end at midnight really means "the end of the last day".
  const endsAtMidnight = e.hour === 0 && e.minute === 0
  let newEnd = DateTime.fromISO(endsAtMidnight ? shiftDate(last, 1) : last, { zone }).set({ hour: e.hour, minute: e.minute })
  if (newEnd <= newStart) newEnd = newStart.plus({ minutes: Math.min(durationMinutes(start, end), 60) })
  return { start_at: newStart.toUTC().toISO()!, end_at: newEnd.toUTC().toISO()! }
}

/** Stretch one edge of an event to another day; the opposite edge stays put and the edges can't cross. */
export function stretchToDate(
  start: string,
  end: string,
  zone: string,
  side: 'left' | 'right',
  date: string,
): { start_at: string; end_at: string } {
  const { first, last } = spanDates(start, end, zone)
  return side === 'right'
    ? withDates(start, end, zone, first, date < first ? first : date)
    : withDates(start, end, zone, date > last ? last : date, last)
}

/** Dragging across days in the top row of the calendar: 9–5 on each of those days, or a default slot for one day. */
export function dayRowSelection(startStr: string, endExclusiveStr: string, zone: string): { start: Date; end: Date } {
  const last = shiftDate(endExclusiveStr, -1)
  const start = DateTime.fromISO(startStr, { zone }).set({ hour: 9 })
  const end = last === startStr ? start.plus({ minutes: 30 }) : DateTime.fromISO(last, { zone }).set({ hour: 17 })
  return { start: start.toJSDate(), end: end.toJSDate() }
}

/** The bar's inclusive last date → the event's new times, after a drag or resize in the top row. */
export function barToTimes(start: string, end: string, zone: string, firstStr: string, endExclusiveStr: string) {
  return withDates(start, end, zone, firstStr, shiftDate(endExclusiveStr, -1))
}
