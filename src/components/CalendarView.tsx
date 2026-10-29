import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import luxonPlugin from '@fullcalendar/luxon3'
import type { DateSelectArg, EventClickArg, EventDropArg, EventInput, EventMountArg } from '@fullcalendar/core'
import type { EventResizeDoneArg } from '@fullcalendar/interaction'
import type { Profile, Task } from '../lib/types'
import { canReschedule } from '../lib/permissions'
import { displayState, STATE_LABEL } from '../lib/status'
import { formatTimeRange } from '../lib/time'
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

/** Save a drag or resize; if the save fails the event snaps back to where it was. */
export async function persistMove(arg: MoveArg, save: Props['onReschedule']): Promise<boolean> {
  const task = arg.event.extendedProps.task as Task | undefined
  const { start, end } = arg.event
  if (!task || !start || !end) {
    arg.revert()
    return false
  }
  try {
    await save(task, start, end)
    return true
  } catch {
    arg.revert()
    return false
  }
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
      tasks.map((t) => ({
        id: t.id,
        title: t.title,
        start: t.start_at,
        end: t.end_at,
        editable: canReschedule(t, me),
        classNames: ['pw-event'],
        extendedProps: { task: t },
      })),
    [tasks, me],
  )

  const onMove = (arg: EventDropArg | EventResizeDoneArg) => persistMove(arg, latest.current.onReschedule)

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
      allDaySlot={false}
      nowIndicator
      slotDuration="00:30:00"
      snapDuration="00:15:00"
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
      eventResizableFromStart={false}
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
        let end = arg.end
        // A single click selects one 30-minute slot; default new tasks to an hour.
        if (end.getTime() - arg.start.getTime() <= 30 * 60000) end = new Date(arg.start.getTime() + 60 * 60000)
        latest.current.onSelectRange(arg.start, end)
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
        el.setAttribute(
          'aria-label',
          `${task.title}, ${formatTimeRange(task.start_at, task.end_at, latest.current.zone)}, ${
            STATE_LABEL[displayState(task, latest.current.me.user_id)]
          }, ${task.progress_percent}% complete`,
        )
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
              New task · {arg.timeText}
            </div>
          )
        }
        return <EventContent task={task} meId={me.user_id} zone={zone} people={people} now={now} />
      }}
    />
    </div>
  )
})
