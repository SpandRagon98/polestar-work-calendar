import { DateTime } from 'luxon'
import type { Profile, Task } from './types'
import { isMultiDay, minutesByLocalDay, taskSessions } from './time'

/**
 * Work that counts toward utilization: a confirmed (not tentative) task that is not
 * cancelled, where this user's own assignment is accepted. Every accepted owner
 * receives the full scheduled duration.
 */
export function isConfirmedFor(task: Task, userId: string): boolean {
  if (task.approval_state !== 'confirmed' || task.work_status === 'cancelled') return false
  return task.assignments.some((a) => a.user_id === userId && a.approval_status === 'accepted')
}

export function availableMinutes(profile: Pick<Profile, 'capacity_minutes' | 'work_days'>, isoDate: string): number {
  const weekday = DateTime.fromISO(isoDate).weekday // 1 = Monday … 7 = Sunday
  return profile.work_days.includes(weekday) ? profile.capacity_minutes : 0
}

/**
 * Planned minutes per local day for one person. A daily slot counts its time on
 * each day. A continuous multi-day block runs around the clock on paper, so each
 * day counts at most that person's capacity (none on non-working days).
 */
export function plannedByDay(
  task: Pick<Task, 'start_at' | 'end_at'>,
  profile: Pick<Profile, 'capacity_minutes' | 'work_days'>,
  zone: string,
): Map<string, number> {
  const sessions = taskSessions(task.start_at, task.end_at, zone)
  if (sessions.length > 1) {
    const out = new Map<string, number>()
    for (const x of sessions) {
      for (const [date, m] of minutesByLocalDay(x.start_at, x.end_at, zone)) out.set(date, (out.get(date) ?? 0) + m)
    }
    return out
  }
  const minutes = minutesByLocalDay(task.start_at, task.end_at, zone)
  if (!isMultiDay(task.start_at, task.end_at, zone)) return minutes
  return new Map([...minutes].map(([date, m]) => [date, Math.min(m, availableMinutes(profile, date))]))
}

export interface DayUtilization {
  date: string
  plannedMinutes: number
  availableMinutes: number
  /** null when the day has no capacity (e.g. weekends) */
  percent: number | null
  taskIds: string[]
}

export interface Utilization {
  userId: string
  days: DayUtilization[]
  plannedMinutes: number
  availableMinutes: number
  percent: number | null
  overCapacityDays: string[]
  conflicts: Array<[Task, Task]>
}

export function percentOf(planned: number, available: number): number | null {
  if (available <= 0) return planned > 0 ? Infinity : null
  return Math.round((planned / available) * 1000) / 10
}

/** Utilization of one user over the given local dates (in that user's time zone). */
export function computeUtilization(
  tasks: Task[],
  profile: Pick<Profile, 'user_id' | 'capacity_minutes' | 'work_days' | 'timezone'>,
  dates: string[],
  fallbackZone = 'UTC',
): Utilization {
  const zone = profile.timezone || fallbackZone
  const mine = tasks.filter((t) => isConfirmedFor(t, profile.user_id))
  const perDay = new Map<string, { minutes: number; taskIds: string[] }>()
  for (const t of mine) {
    for (const [date, minutes] of plannedByDay(t, profile, zone)) {
      const entry = perDay.get(date) ?? { minutes: 0, taskIds: [] }
      entry.minutes += minutes
      entry.taskIds.push(t.id)
      perDay.set(date, entry)
    }
  }
  const days = dates.map<DayUtilization>((date) => {
    const planned = perDay.get(date)?.minutes ?? 0
    const available = availableMinutes(profile, date)
    return {
      date,
      plannedMinutes: planned,
      availableMinutes: available,
      percent: percentOf(planned, available),
      taskIds: perDay.get(date)?.taskIds ?? [],
    }
  })
  const plannedMinutes = days.reduce((s, d) => s + d.plannedMinutes, 0)
  const available = days.reduce((s, d) => s + d.availableMinutes, 0)
  const dateSet = new Set(dates)
  return {
    userId: profile.user_id,
    days,
    plannedMinutes,
    availableMinutes: available,
    percent: percentOf(plannedMinutes, available),
    overCapacityDays: days.filter((d) => d.plannedMinutes > d.availableMinutes).map((d) => d.date),
    conflicts: findConflicts(mine, zone).filter(([a]) => [...plannedByDay(a, profile, zone).keys()].some((d) => dateSet.has(d))),
  }
}

/**
 * Overlapping commitments are never merged — both keep their full duration —
 * but each overlapping pair is reported so the user can resolve it.
 */
export function findConflicts(tasks: Task[], zone = 'UTC'): Array<[Task, Task]> {
  const ms = (iso: string) => new Date(iso).getTime()
  const sorted = [...tasks].sort((a, b) => ms(a.start_at) - ms(b.start_at))
  const out: Array<[Task, Task]> = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (overlaps(sorted[i], sorted[j], zone)) out.push([sorted[i], sorted[j]])
    }
  }
  return out
}

/** Whether two events actually coincide: a daily slot only occupies its time on each day. */
export function overlaps(a: { start_at: string; end_at: string }, b: { start_at: string; end_at: string }, zone = 'UTC'): boolean {
  const ms = (iso: string) => new Date(iso).getTime()
  const bs = taskSessions(b.start_at, b.end_at, zone)
  return taskSessions(a.start_at, a.end_at, zone).some((x) =>
    bs.some((y) => ms(x.start_at) < ms(y.end_at) && ms(y.start_at) < ms(x.end_at)),
  )
}

export type UtilizationLevel = 'idle' | 'healthy' | 'high' | 'over'

export function utilizationLevel(percent: number | null): UtilizationLevel {
  if (percent === null || percent === 0) return 'idle'
  if (percent > 100) return 'over'
  if (percent >= 85) return 'high'
  return 'healthy'
}
