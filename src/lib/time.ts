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
