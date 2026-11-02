import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, CheckSquare } from 'lucide-react'
import type { Task } from '../lib/types'
import { formatTimeRange } from '../lib/time'

export interface PeekHandle {
  /** Show the card for `task` next to `el` (after a short pause, unless a card is already open). */
  show: (task: Task, el: HTMLElement) => void
  /** Hide it; `now` skips the grace period that lets the pointer move between events. */
  hide: (now?: boolean) => void
}

const WIDTH = 280
const SHOW_DELAY = 280
const MAX_SHOWN = 8

/**
 * The points of an event or task, shown while the pointer rests on it in the calendar.
 * Keeps its own state, so hovering never re-renders the calendar.
 */
export const EventPeek = forwardRef<PeekHandle, { zone: string }>(function EventPeek({ zone }, ref) {
  const [peek, setPeek] = useState<{ task: Task; rect: DOMRect } | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const showTimer = useRef<number>(undefined)
  const hideTimer = useRef<number>(undefined)
  const open = useRef(false)
  open.current = !!peek

  useImperativeHandle(ref, () => ({
    show(task, el) {
      if (!window.matchMedia?.('(hover: hover)').matches) return
      window.clearTimeout(hideTimer.current)
      window.clearTimeout(showTimer.current)
      const go = () => setPeek({ task, rect: el.getBoundingClientRect() })
      if (open.current) go()
      else showTimer.current = window.setTimeout(go, SHOW_DELAY)
    },
    hide(now) {
      window.clearTimeout(showTimer.current)
      window.clearTimeout(hideTimer.current)
      if (now) setPeek(null)
      else hideTimer.current = window.setTimeout(() => setPeek(null), 120)
    },
  }))

  useEffect(
    () => () => {
      window.clearTimeout(showTimer.current)
      window.clearTimeout(hideTimer.current)
    },
    [],
  )

  // Scrolling moves the event away from the card.
  useEffect(() => {
    if (!peek) return
    const close = () => setPeek(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [peek])

  // Beside the event (right, else left, else below), kept inside the window.
  useLayoutEffect(() => {
    if (!peek || !card.current) return setPos(null)
    const { rect } = peek
    const h = card.current.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = rect.right + 10
    let top = rect.top
    if (left + WIDTH > vw - 8) left = rect.left - 10 - WIDTH
    if (left < 8) {
      left = Math.min(Math.max(8, rect.left), vw - WIDTH - 8)
      top = rect.bottom + 8
    }
    top = Math.min(Math.max(8, top), vh - h - 8)
    setPos({ left, top })
  }, [peek])

  if (!peek) return null
  const { task } = peek
  const points = task.points ?? []
  const isEvent = task.kind === 'event'

  return createPortal(
    <div
      ref={card}
      role="tooltip"
      className="pointer-events-none fixed z-[70] rounded-2xl border border-line bg-surface p-3.5"
      style={{
        width: WIDTH,
        left: pos?.left ?? -9999,
        top: pos?.top ?? 0,
        boxShadow: 'var(--shadow-pop)',
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div key={task.id} className={pos ? 'anim-pop' : undefined}>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ash">
          {isEvent ? <CalendarDays size={12} className="text-st-event" /> : <CheckSquare size={12} className="text-stone" />}
          {isEvent ? 'Event' : 'Task'} · {formatTimeRange(task.start_at, task.end_at, zone)}
        </p>
        <p className="mt-1 text-sm leading-snug font-semibold text-ink">{task.title}</p>
        <ul className="mt-2 space-y-1">
          {points.slice(0, MAX_SHOWN).map((p, i) => (
            <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink">
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-maroon" aria-hidden />
              <span className="min-w-0 break-words">{p}</span>
            </li>
          ))}
        </ul>
        {points.length > MAX_SHOWN ? <p className="mt-1.5 pl-3.5 text-xs text-stone">+{points.length - MAX_SHOWN} more — click to see all</p> : null}
      </div>
    </div>,
    document.body,
  )
})
