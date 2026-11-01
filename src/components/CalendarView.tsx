import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput, EventMountArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import type { Profile, Task } from '../lib/types'
import { canReschedule } from '../lib/permissions'
import { barToTimes, dayRowSelection, isMultiDay, shiftDate, spanDates, stretchToDate } from '../lib/time'
import { EventContent } from './EventContent'
import { motionLevel } from '../lib/motion'

export type CalendarViewName = 'timeGridDay' | 'timeGridWeek'

export interface CalendarHandle {
  prev(): void
  next(): void
  today(): void
  gotoDate(d: Date | string): void
  changeView(v: CalendarViewName): void
}

interface Props {
  tasks: Task[]
  me: Profile
  people: Map<string, Profile>
  zone: string
  initialView: CalendarViewName
  isMobile: boolean
  now: Date
  onRangeChange: (info: { start: Date; end: Date; title: string; view: CalendarViewName }) => void
  onSelectRange: (start: Date, end: Date) => void
  onOpenTask: (id: string) => void
  /** Persist a drag/resize. Reject to make the calendar snap back. */
  onReschedule: (task: Task, start: Date, end: Date) => Promise<void>
}

type MoveArg = Pick<EventDropArg, 'event' | 'revert'>

/**
 * Save a drag or resize; if the save fails the event snaps back to where it was.
 * Multi-day bars change days only: the event keeps its start and end times of day.
 */
export async function persistMove(arg: MoveArg, save: Props['onReschedule'], zone = 'UTC'): Promise<boolean> {
  const task = arg.event.extendedProps.task as Task | undefined
  const { start, end } = arg.event
  if (!task || !start || !end) {
    arg.revert()
    return false
  }
  try {
    if (arg.event.allDay) {
      const t = barToTimes(task.start_at, task.end_at, zone, arg.event.startStr.slice(0, 10), arg.event.endStr.slice(0, 10))
      await save(task, new Date(t.start_at), new Date(t.end_at))
    } else {
      await save(task, start, end)
    }
    return true
  } catch {
    arg.revert()
    return false
  }
}

/**
 * Left or right edge of a timed event: drag it sideways onto another day to make
 * the event span those days. Native listeners stop FullCalendar treating the press
 * as a move of the whole event; the columns in range are tinted while dragging.
 */
function SpanHandle({ side, date, onDone }: { side: 'left' | 'right'; date: string; onDone: (date: string) => void }) {
  const el = useRef<HTMLSpanElement>(null)
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    const node = el.current
    if (!node) return
    const stop = (e: Event) => e.stopPropagation()
    const columnAt = (x: number, y: number) =>
      document
        .elementsFromPoint(x, y)
        .find((n) => n.matches('.fc-timegrid-col[data-date]'))
        ?.getAttribute('data-date') ?? null
    const paint = (hover: string | null) => {
      document.querySelectorAll<HTMLElement>('.fc-timegrid-col[data-date]').forEach((c) => {
        const d = c.dataset.date!
        const inRange = hover !== null && d >= (hover < date ? hover : date) && d <= (hover > date ? hover : date)
        c.classList.toggle('pw-span-preview', inRange)
      })
    }
    const onDown = (e: PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      node.setPointerCapture(e.pointerId)
      let hover: string | null = date
      const onMove = (m: PointerEvent) => {
        const next = columnAt(m.clientX, m.clientY)
        if (next && next !== hover) {
          hover = next
          paint(hover)
        }
      }
      const finish = (u: PointerEvent) => {
        node.removeEventListener('pointermove', onMove)
        node.removeEventListener('pointerup', finish)
        node.removeEventListener('pointercancel', finish)
        paint(null)
        if (u.type === 'pointerup' && hover && hover !== date) done.current(hover)
      }
      node.addEventListener('pointermove', onMove)
      node.addEventListener('pointerup', finish)
      node.addEventListener('pointercancel', finish)
    }
    node.addEventListener('pointerdown', onDown)
    node.addEventListener('mousedown', stop)
    node.addEventListener('touchstart', stop)
    node.addEventListener('click', stop)
    return () => {
      node.removeEventListener('pointerdown', onDown)
      node.removeEventListener('mousedown', stop)
      node.removeEventListener('touchstart', stop)
      node.removeEventListener('click', stop)
    }
  }, [date])

  return <span ref={el} aria-hidden title="Drag sideways to span more days" className={`pw-span-handle pw-span-handle-${side}`} />
}

export const CalendarView = forwardRef<CalendarHandle, Props>(function CalendarView(props, ref) {
  const { tasks, me, people, zone, initialView, isMobile, now } = props
  const fc = useRef<FullCalendar>(null)
  const box = useRef<HTMLDivElement>(null)

  // The grid only re-measures on window resize; also follow the container (sidebar
  // toggle, drawer). Re-measure once the size settles rather than on every frame of
  // an animation — the browser reflows the grid's percentage columns in between.
  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = true
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false
        return
      }
      clearTimeout(timer)
      timer = setTimeout(() => fc.current?.getApi().updateSize(), 90)
    })
    ro.observe(el)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
    }
  }, [])
  // Handlers change every render; FullCalendar keeps the first ones it sees.
  const latest = useRef(props)
  latest.current = props

  // ── Motion ──────────────────────────────────────────────────────────────
  // Navigation glides in the direction of travel; events added while you're
  // looking (yours or a teammate's, via Realtime) fade into place. Both use the
  // Web Animations API with transform/opacity only, so they run on the compositor.
  const navDir = useRef<'next' | 'prev' | 'fade' | null>(null)
  const lastNav = useRef(0)
  const knownIds = useRef(new Set<string>())
  // Glides and fade-ins move the whole grid: only with full motion.
  const reduced = () => motionLevel() !== 'full'

  const animateNav = () => {
    const dir = navDir.current
    navDir.current = null
    lastNav.current = performance.now()
    const view = box.current?.querySelector<HTMLElement>('.fc-view-harness')
    if (!dir || !view || reduced() || !view.animate) return
    const x = dir === 'next' ? 16 : dir === 'prev' ? -16 : 0
    view.animate(
      [
        { opacity: 0.4, transform: `translateX(${x}px)` },
        { opacity: 1, transform: 'translateX(0)' },
      ],
      { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
  }

  const go = (dir: 'next' | 'prev' | 'fade', fn: () => void) => {
    navDir.current = dir
    fn()
  }

  useImperativeHandle(ref, () => ({
    prev: () => go('prev', () => fc.current?.getApi().prev()),
    next: () => go('next', () => fc.current?.getApi().next()),
    today: () => go('fade', () => fc.current?.getApi().today()),
    gotoDate: (d) => go('fade', () => fc.current?.getApi().gotoDate(d)),
    changeView: (v) => go('fade', () => fc.current?.getApi().changeView(v)),
  }))

  const events = useMemo<EventInput[]>(
    () =>
      tasks.map((t) => {
        // Multi-day events are bars in the top row, resized by their left and right ends.
        const multi = isMultiDay(t.start_at, t.end_at, zone)
        const span = multi ? spanDates(t.start_at, t.end_at, zone) : null
        return {
          id: t.id,
          title: t.title,
          allDay: multi,
          start: span ? span.first : t.start_at,
          end: span ? shiftDate(span.last, 1) : t.end_at,
          editable: canReschedule(t, me),
          classNames: canReschedule(t, me) ? ['pw-event', 'pw-movable'] : ['pw-event'],
          extendedProps: { task: t },
        }
      }),
    [tasks, me, zone],
  )

  const onMove = (arg: EventDropArg | EventResizeDoneArg) => persistMove(arg, latest.current.onReschedule, latest.current.zone)

  const stretch = (task: Task, side: 'left' | 'right', date: string) => {
    const t = stretchToDate(task.start_at, task.end_at, latest.current.zone, side, date)
    latest.current.onReschedule(task, new Date(t.start_at), new Date(t.end_at)).catch(() => undefined) // already reported
  }

  return (
    <div ref={box} className="h-full">
    <FullCalendar
      ref={fc}
      plugins={[timeGridPlugin, interactionPlugin, luxonPlugin]}
      initialView={initialView}
      timeZone={zone}
      headerToolbar={false}
      height="100%"
      firstDay={1}
      allDaySlot
      allDayText="Days"
      dayMaxEventRows={3}
      nowIndicator
      slotDuration="00:30:00"
      snapDuration="00:30:00"
      scrollTime="08:00:00"
      scrollTimeReset={false}
      slotLabelFormat={{ hour: 'numeric', meridiem: 'short' }}
      titleFormat={isMobile ? { weekday: 'short', month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' }}
      dayHeaderFormat={isMobile ? { weekday: 'short', day: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' }}
      eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
      selectable
      selectMirror
      unselectAuto
      longPressDelay={350}
      eventLongPressDelay={350}
      selectLongPressDelay={350}
      eventResizableFromStart
      eventAllow={(span, moving) => !moving || span.allDay === moving.allDay}
      eventDurationEditable
      eventMinHeight={22}
      slotEventOverlap={false}
      events={events}
      now={now}
      datesSet={(arg) => {
        animateNav()
        latest.current.onRangeChange({
          start: arg.start,
          end: arg.end,
          title: arg.view.title,
          view: arg.view.type as CalendarViewName,
        })
      }}
      select={(arg: DateSelectArg) => {
        // A single click selects one 30-minute slot, which is the default task length.
        // Dragging across days in the top row sets up a multi-day event.
        const range = arg.allDay ? dayRowSelection(arg.startStr.slice(0, 10), arg.endStr.slice(0, 10), latest.current.zone) : arg
        latest.current.onSelectRange(range.start, range.end)
        arg.view.calendar.unselect()
      }}
      eventClick={(arg: EventClickArg) => {
        arg.jsEvent.preventDefault()
        latest.current.onOpenTask(arg.event.id)
      }}
      eventDrop={onMove}
      eventResize={onMove}
      eventDidMount={(arg: EventMountArg) => {
        const task = arg.event.extendedProps.task as Task | undefined
        if (!task) return
        const el = arg.el
        // A task that just appeared (not on a page change or first load) fades in.
        const isNew = knownIds.current.size > 0 && !knownIds.current.has(task.id)
        knownIds.current.add(task.id)
        if (isNew && performance.now() - lastNav.current > 700 && !reduced() && el.animate) {
          el.animate(
            [
              { opacity: 0, transform: 'scale(0.96)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          )
        }
        el.tabIndex = 0
        el.setAttribute('role', 'button')
        el.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            latest.current.onOpenTask(arg.event.id)
          }
        }
      }}
      eventContent={(arg) => {
        const task = arg.event.extendedProps.task as Task | undefined
        // The selection preview ("mirror") is not a task yet.
        if (!task) {
          return (
            <div className="pw-event-body pw-st-scheduled h-full px-1.5 pt-1 text-[11px] font-semibold">
              New task{arg.timeText ? ` · ${arg.timeText}` : ''}
            </div>
          )
        }
        const stretchable = !arg.event.allDay && !isMobile && arg.view.type === 'timeGridWeek' && canReschedule(task, me)
        const date = spanDates(task.start_at, task.end_at, zone)
        return (
          <EventContent
            task={task}
            meId={me.user_id}
            zone={zone}
            people={people}
            now={now}
            bar={arg.event.allDay}
            handles={
              stretchable ? (
                <>
                  <SpanHandle side="left" date={date.first} onDone={(d) => stretch(task, 'left', d)} />
                  <SpanHandle side="right" date={date.last} onDone={(d) => stretch(task, 'right', d)} />
                </>
              ) : null
            }
          />
        )
      }}
    />
    </div>
  )
})
