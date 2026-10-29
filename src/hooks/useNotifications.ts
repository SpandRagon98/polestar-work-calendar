import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchMyRequests, fetchPendingForMe, fetchRequestUpdates, type RequestUpdate } from '../lib/api'
import type { Task } from '../lib/types'

const SEEN_KEY = 'pwc.notifications.seen'

function readSeen(userId: string): string {
  try {
    return localStorage.getItem(`${SEEN_KEY}.${userId}`) ?? ''
  } catch {
    return ''
  }
}

/** Something that arrived while the app was open. */
export type Notice = { kind: 'ticket'; task: Task } | { kind: 'update'; update: RequestUpdate }

/**
 * In-app notifications, derived from existing data — no extra table:
 *  • my pending assignments (tickets I need to answer),
 *  • requests I raised and their state,
 *  • recent responses to my requests.
 * Realtime keeps them current; `onNotice` fires for items that arrive after the
 * first load (new tickets for me, responses to my tickets).
 */
export function useNotifications(userId: string | undefined, onNotice?: (n: Notice) => void) {
  const [pending, setPending] = useState<Task[]>([])
  const [requests, setRequests] = useState<Task[]>([])
  const [updates, setUpdates] = useState<RequestUpdate[]>([])
  const [seenAt, setSeenAt] = useState('')
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const known = useRef<{ tickets: Set<string>; updates: Set<string> } | null>(null)
  const notify = useRef(onNotice)
  notify.current = onNotice

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [p, r, u] = await Promise.all([
        fetchPendingForMe(userId),
        fetchMyRequests(userId),
        fetchRequestUpdates(userId),
      ])
      const others = u.filter((x) => x.actor_id !== userId)
      // Announce what is new since the previous load (never on the first one).
      if (known.current) {
        for (const t of p) if (!known.current.tickets.has(t.id)) notify.current?.({ kind: 'ticket', task: t })
        for (const x of others) if (!known.current.updates.has(x.id)) notify.current?.({ kind: 'update', update: x })
      }
      known.current = {
        tickets: new Set([...(known.current?.tickets ?? []), ...p.map((t) => t.id)]),
        updates: new Set([...(known.current?.updates ?? []), ...others.map((x) => x.id)]),
      }
      setPending(p)
      setRequests(r)
      setUpdates(others)
    } catch {
      // Notifications are secondary; the calendar surfaces real errors.
    } finally {
      setLoading(false)
    }
  }, [userId])

  /** Debounced reload, used when Realtime reports a change. */
  const poke = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(), 600)
  }, [load])

  useEffect(() => {
    if (!userId) return
    known.current = null
    setSeenAt(readSeen(userId))
    void load()
    const channel = supabase
      .channel(`notifications-${userId}`)
      // A ticket raised for me (or a change to my assignment).
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_assignments', filter: `user_id=eq.${userId}` },
        () => poke(),
      )
      // Responses to tickets I raised touch the task row.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `requester_id=eq.${userId}` },
        () => poke(),
      )
      .subscribe()
    return () => {
      clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [userId, load, poke])

  const seenMs = seenAt ? new Date(seenAt).getTime() : 0
  const unseenUpdates = updates.filter((u) => new Date(u.created_at).getTime() > seenMs).length

  const markSeen = useCallback(() => {
    if (!userId) return
    const now = new Date().toISOString()
    setSeenAt(now)
    try {
      localStorage.setItem(`${SEEN_KEY}.${userId}`, now)
    } catch {
      /* private mode: badge just resets per session */
    }
  }, [userId])

  return {
    pending,
    requests,
    updates,
    loading,
    badge: pending.length + unseenUpdates,
    seenAt,
    reload: load,
    poke,
    markSeen,
  }
}
