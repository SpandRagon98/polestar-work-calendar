import { DateTime } from 'luxon'
import type { Profile, Task } from './types'
import { minutesByLocalDay } from './time'

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
    for (const [date, minutes] of minutesByLocalDay(t.start_at, t.end_at, zone)) {
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
    conflicts: findConflicts(mine).filter(([a]) =>
      [...minutesByLocalDay(a.start_at, a.end_at, zone).keys()].some((d) => dateSet.has(d)),
    ),
  }
}

/**
 * Overlapping commitments are never merged — both keep their full duration —
 * but each overlapping pair is reported so the user can resolve it.
 */
export function findConflicts(tasks: Task[]): Array<[Task, Task]> {
  const ms = (iso: string) => new Date(iso).getTime()
  const sorted = [...tasks].sort((a, b) => ms(a.start_at) - ms(b.start_at))
  const out: Array<[Task, Task]> = []
  for (let i = 0; i < sorted.length; i++) {
    const aEnd = ms(sorted[i].end_at)
    for (let j = i + 1; j < sorted.length; j++) {
      if (ms(sorted[j].start_at) >= aEnd) break
      out.push([sorted[i], sorted[j]])
    }
  }
  return out
}

export function overlaps(a: { start_at: string; end_at: string }, b: { start_at: string; end_at: string }): boolean {
  const ms = (iso: string) => new Date(iso).getTime()
  return ms(a.start_at) < ms(b.end_at) && ms(b.start_at) < ms(a.end_at)
}

export type UtilizationLevel = 'idle' | 'healthy' | 'high' | 'over'

export function utilizationLevel(percent: number | null): UtilizationLevel {
  if (percent === null || percent === 0) return 'idle'
  if (percent > 100) return 'over'
  if (percent >= 85) return 'high'
  return 'healthy'
}
