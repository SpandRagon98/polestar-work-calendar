import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import type { CustomField, Priority, Task, TaskKind } from '../lib/types'
import { createTask, createTaskSeries, fetchOverlapping, toApiError } from '../lib/api'
import { validateFields } from '../lib/customFields'
import { buildOccurrences, MAX_OCCURRENCES, occurrenceDates, type RepeatPattern } from '../lib/recurrence'
import { dailySlot, durationMinutes, formatLength, fromLocalInputs, isMultiDay, shiftDate, toLocalInputs } from '../lib/time'
import { overlaps } from '../lib/utilization'
import { useApp } from '../context'

export interface CreateDraft {
  start: string // ISO
  end: string // ISO
  title?: string
  ownerIds?: string[]
  description?: string
  priority?: Priority
  category?: string
  customFields?: CustomField[]
  parentTask?: Pick<Task, 'id' | 'title'>
  kind?: TaskKind
}

/** Form state, validation, conflict warnings and submit — shared by the task dialog and the ticket page. */
export function useTaskForm(draft: CreateDraft, defaultOwners: string[]) {
  const { me, people, zone } = useApp()
  const s = toLocalInputs(draft.start, zone)
  const e = toLocalInputs(draft.end, zone)
  const [title, setTitle] = useState(draft.title ?? '')
  const [startDate, setStartDateRaw] = useState(s.date)
  const [startTime, setStartTime] = useState(s.time)
  const [endDate, setEndDate] = useState(e.date)
  const [endTime, setEndTime] = useState(e.time)
  const [owners, setOwners] = useState<string[]>(draft.ownerIds?.length ? draft.ownerIds : defaultOwners)
  const [description, setDescription] = useState(draft.description ?? '')
  const [priority, setPriority] = useState<Priority>(draft.priority ?? 'medium')
  const [category, setCategory] = useState(draft.category ?? '')
  const [fields, setFields] = useState<CustomField[]>(draft.customFields ?? [])
  const [kind, setKind] = useState<TaskKind>(draft.kind ?? 'task')
  const [points, setPoints] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Task[]>([])
  const [repeat, setRepeatRaw] = useState(false)
  const [repeatPattern, setRepeatPattern] = useState<RepeatPattern>('daily')
  const [repeatUntil, setRepeatUntil] = useState('')

  const startIso = fromLocalInputs(startDate, startTime, zone)
  const endIso = fromLocalInputs(endDate, endTime, zone)
  const timeInvalid = !startIso || !endIso || new Date(endIso) <= new Date(startIso)
  const minutes = timeInvalid ? 0 : durationMinutes(startIso!, endIso!)
  const lengthLabel = timeInvalid ? '' : formatLength(startIso!, endIso!, zone)
  const others = owners.filter((o) => o !== me.user_id)
  // Admins assign directly; anyone else needs each other owner to accept.
  const isRequest = others.length > 0 && me.role !== 'admin'
  const directAssign = others.length > 0 && me.role === 'admin'

  const setRepeat = (on: boolean) => {
    setRepeatRaw(on)
    if (on && (!repeatUntil || repeatUntil <= startDate)) setRepeatUntil(shiftDate(startDate, repeatPattern === 'weekly' ? 28 : 6))
  }
  const repeatDates = useMemo(
    () => (repeat ? occurrenceDates(startDate, repeatUntil, repeatPattern) : []),
    [repeat, startDate, repeatUntil, repeatPattern],
  )
  const repeatError = !repeat
    ? null
    : !timeInvalid && (dailySlot(startIso!, endIso!, zone) || isMultiDay(startIso!, endIso!, zone))
      ? 'Repeating works for events within one day. Shorten the event, or turn off Repeat.'
      : repeatDates.length > MAX_OCCURRENCES
        ? `That’s more than ${MAX_OCCURRENCES} events. Choose an earlier end date.`
        : repeatDates.length < 2
          ? 'Choose an end date that gives at least two events.'
          : null

  /** Moving a same-day task's date moves its end date with it. */
  const setStartDate = (v: string) => {
    if (endDate === startDate) setEndDate(v)
    setStartDateRaw(v)
  }

  /** Set the end from the start plus a duration. */
  const setDuration = (mins: number) => {
    const start = DateTime.fromISO(`${startDate}T${startTime}`, { zone })
    if (!start.isValid) return
    const end = start.plus({ minutes: mins })
    setEndDate(end.toISODate()!)
    setEndTime(end.toFormat('HH:mm'))
  }

  // Warn about overlapping confirmed commitments (debounced).
  useEffect(() => {
    if (timeInvalid || owners.length === 0) {
      setConflicts([])
      return
    }
    const id = setTimeout(() => {
      fetchOverlapping(owners, startIso!, endIso!)
        .then((rows) => setConflicts(rows.filter((t) => overlaps({ start_at: startIso!, end_at: endIso! }, t, zone))))
        .catch(() => setConflicts([]))
    }, 350)
    return () => clearTimeout(id)
  }, [owners, startIso, endIso, timeInvalid, zone])

  const conflictText = useMemo(() => {
    const byPerson = new Map<string, string[]>()
    for (const t of conflicts) {
      for (const a of t.assignments) {
        if (!owners.includes(a.user_id) || a.approval_status !== 'accepted') continue
        byPerson.set(a.user_id, [...(byPerson.get(a.user_id) ?? []), t.title])
      }
    }
    return [...byPerson].map(
      ([uid, titles]) => `${uid === me.user_id ? 'You' : (people.get(uid)?.name ?? 'Someone')}: ${titles.join(', ')}`,
    )
  }, [conflicts, owners, people, me.user_id])

  /** Returns the new task id, or null when validation or saving failed (see `error`). */
  async function submit(): Promise<string | null> {
    setError(null)
    if (!title.trim()) return fail('Give it a title.')
    if (timeInvalid) return fail('End time must be later than start time.')
    if (owners.length === 0) return fail('Choose at least one person.')
    const fieldErr = validateFields(fields)
    if (fieldErr) return fail(fieldErr)
    if (repeatError) return fail(repeatError)
    setBusy(true)
    try {
      const input = {
        title: title.trim(),
        description: description.trim() || undefined,
        start_at: startIso!,
        end_at: endIso!,
        priority,
        category: category.trim() || undefined,
        custom_fields: fields,
        owner_ids: owners,
        kind,
        points,
      }
      if (repeat) {
        const ids = await createTaskSeries(
          input,
          buildOccurrences({ startDate, startTime, endDate, endTime, until: repeatUntil, pattern: repeatPattern, zone }),
        )
        return ids[0]
      }
      return await createTask({ ...input, parent_task_id: draft.parentTask?.id })
    } catch (err) {
      const message = toApiError(err).message
      return fail(
        /create_task_series/.test(message)
          ? 'Repeating events need a one-time database update: run supabase/migrations/20261101000000_admin_direct_and_series.sql in the Supabase SQL Editor.'
          : message,
      )
    } finally {
      setBusy(false)
    }
  }

  function fail(msg: string): null {
    setError(msg)
    return null
  }

  return {
    title, setTitle,
    kind, setKind, points, setPoints,
    startDate, setStartDate, startTime, setStartTime,
    endDate, setEndDate, endTime, setEndTime,
    setDuration, minutes, lengthLabel, timeInvalid,
    owners, setOwners, others, isRequest, directAssign,
    repeat, setRepeat, repeatPattern, setRepeatPattern, repeatUntil, setRepeatUntil, repeatDates, repeatError,
    description, setDescription,
    priority, setPriority,
    category, setCategory,
    fields, setFields,
    conflictText,
    busy, error, submit,
  }
}

export type TaskForm = ReturnType<typeof useTaskForm>
