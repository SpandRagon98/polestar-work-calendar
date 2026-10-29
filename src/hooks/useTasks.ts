import { useCallback, useEffect, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { supabase } from '../lib/supabase'
import { fetchTask, fetchTasksInRange, toApiError } from '../lib/api'
import type { Task } from '../lib/types'

export interface VisibleRange {
  start: Date
  end: Date
}

/** Events crossing the edges of the visible range are still fetched. */
const BUFFER_DAYS = 1

function buffered(range: VisibleRange) {
  return {
    from: DateTime.fromJSDate(range.start).minus({ days: BUFFER_DAYS }).toJSDate(),
    to: DateTime.fromJSDate(range.end).plus({ days: BUFFER_DAYS }).toJSDate(),
  }
}

/**
 * Tasks for the visible calendar range, kept live with one Realtime subscription
 * on `tasks` (rows are filtered per user by RLS). Every write function bumps the
 * task row, so assignment, approval and bookmark changes arrive here too.
 */
export function useTasks(range: VisibleRange | null, enabled: boolean, onRemoteChange?: () => void) {
  const [tasks, setTasks] = useState<Map<string, Task>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const loadSeq = useRef(0)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const remoteRef = useRef(onRemoteChange)
  remoteRef.current = onRemoteChange

  const rangeKey = range ? `${range.start.toISOString()}_${range.end.toISOString()}` : ''

  const load = useCallback(async () => {
    const r = rangeRef.current
    if (!r || !enabled) return
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const { from, to } = buffered(r)
      const rows = await fetchTasksInRange(from, to)
      if (seq !== loadSeq.current) return
      setTasks(new Map(rows.map((t) => [t.id, t])))
      setError(null)
    } catch (e) {
      if (seq === loadSeq.current) setError(toApiError(e).message)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    void load()
  }, [load, rangeKey])

  const upsert = useCallback((task: Task) => {
    setTasks((prev) => {
      const r = rangeRef.current
      const next = new Map(prev)
      const current = prev.get(task.id)
      // Never replace newer data with an older response.
      if (current && current.version > task.version) return prev
      if (r) {
        const { from, to } = buffered(r)
        const inRange = new Date(task.start_at) < to && new Date(task.end_at) > from
        if (!inRange) {
          next.delete(task.id)
          return next
        }
      }
      next.set(task.id, task)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setTasks((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }, [])

  /** Re-read one task from the database (after a write or a Realtime event). */
  const refreshTask = useCallback(
    async (id: string): Promise<Task | null> => {
      const t = await fetchTask(id)
      if (t) upsert(t)
      else remove(id)
      return t
    },
    [upsert, remove],
  )

  // Realtime
  useEffect(() => {
    if (!enabled) return
    let subscribedOnce = false
    const schedule = (id: string) => {
      const existing = timers.current.get(id)
      if (existing) clearTimeout(existing)
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id)
          refreshTask(id).catch(() => undefined)
        }, 250),
      )
      remoteRef.current?.()
    }
    const channel = supabase
      .channel('tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id
          if (id) remove(id)
          remoteRef.current?.()
        } else {
          const id = (payload.new as { id?: string }).id
          if (id) schedule(id)
        }
      })
      .subscribe((status) => {
        // After a dropped connection, reload so missed changes are not lost.
        if (status === 'SUBSCRIBED') {
          if (subscribedOnce) void load()
          subscribedOnce = true
        }
      })
    const pending = timers.current
    return () => {
      pending.forEach(clearTimeout)
      pending.clear()
      void supabase.removeChannel(channel)
    }
  }, [enabled, refreshTask, remove, load])

  return { tasks, loading, error, reload: load, refreshTask, upsert, remove }
}
