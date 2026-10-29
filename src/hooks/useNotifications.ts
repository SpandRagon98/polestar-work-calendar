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

/**
 * In-app notifications, derived from existing data — no extra table:
 *  • my pending assignments (approvals I owe),
 *  • requests I raised and their state,
 *  • recent responses to my requests.
 */
export function useNotifications(userId: string | undefined) {
  const [pending, setPending] = useState<Task[]>([])
  const [requests, setRequests] = useState<Task[]>([])
  const [updates, setUpdates] = useState<RequestUpdate[]>([])
  const [seenAt, setSeenAt] = useState('')
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const load = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    try {
      const [p, r, u] = await Promise.all([
        fetchPendingForMe(userId),
        fetchMyRequests(userId),
        fetchRequestUpdates(userId),
      ])
      setPending(p)
      setRequests(r)
      setUpdates(u.filter((x) => x.actor_id !== userId))
    } catch {
      // Notifications are secondary; the calendar surfaces real errors.
    } finally {
      setLoading(false)
    }
  }, [userId])

  /** Debounced reload, used when Realtime reports a task change. */
  const poke = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void load(), 800)
  }, [load])

  useEffect(() => {
    if (!userId) return
    setSeenAt(readSeen(userId))
    void load()
    const channel = supabase
      .channel(`assignments-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_assignments', filter: `user_id=eq.${userId}` },
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
