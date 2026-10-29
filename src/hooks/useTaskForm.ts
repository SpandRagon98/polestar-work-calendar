import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import type { CustomField, Priority, Task } from '../lib/types'
import { createTask, fetchOverlapping, toApiError } from '../lib/api'
import { validateFields } from '../lib/customFields'
import { durationMinutes, fromLocalInputs, toLocalInputs } from '../lib/time'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Task[]>([])

  const startIso = fromLocalInputs(startDate, startTime, zone)
  const endIso = fromLocalInputs(endDate, endTime, zone)
  const timeInvalid = !startIso || !endIso || new Date(endIso) <= new Date(startIso)
  const minutes = timeInvalid ? 0 : durationMinutes(startIso!, endIso!)
  const others = owners.filter((o) => o !== me.user_id)
  const isRequest = others.length > 0

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
        .then(setConflicts)
        .catch(() => setConflicts([]))
    }, 350)
    return () => clearTimeout(id)
  }, [owners, startIso, endIso, timeInvalid])

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
    setBusy(true)
    try {
      return await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        start_at: startIso!,
        end_at: endIso!,
        priority,
        category: category.trim() || undefined,
        custom_fields: fields,
        owner_ids: owners,
        parent_task_id: draft.parentTask?.id,
      })
    } catch (err) {
      return fail(toApiError(err).message)
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
    startDate, setStartDate, startTime, setStartTime,
    endDate, setEndDate, endTime, setEndTime,
    setDuration, minutes, timeInvalid,
    owners, setOwners, others, isRequest,
    description, setDescription,
    priority, setPriority,
    category, setCategory,
    fields, setFields,
    conflictText,
    busy, error, submit,
  }
}

export type TaskForm = ReturnType<typeof useTaskForm>
