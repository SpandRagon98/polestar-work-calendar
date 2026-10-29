import { useCallback, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, RefreshCw } from 'lucide-react'
import type { Task } from '../lib/types'
import { fetchTask, toApiError, updateTask } from '../lib/api'
import { onCalendar } from '../lib/permissions'
import { displayState } from '../lib/status'
import { daysBetween, formatHours, minutesByLocalDay } from '../lib/time'
import { computeUtilization, isConfirmedFor, overlaps } from '../lib/utilization'
import { useApp, useNow } from '../context'
import { useTasks, type VisibleRange } from '../hooks/useTasks'
import { useShell, TopBar } from './AppShell'
import { CalendarView, type CalendarHandle, type CalendarViewName } from './CalendarView'
import { CreateTaskDialog, type CreateDraft } from './CreateTaskDialog'
import { EMPTY_FILTERS, FiltersPopover, type Filters } from './FiltersPopover'
import { OwnerSelector } from './OwnerSelector'
import { TaskDrawer } from './TaskDrawer'
import { pctLabel, UtilizationIndicator } from './UtilizationIndicator'
import { useFeedback } from './ui/feedback'
import { Button, Segmented, cx } from './ui/primitives'

type Scope = 'mine' | 'team'

export function CalendarPage() {
  const { me, profiles, people, zone, isMobile } = useApp()
  const shell = useShell()
  const { toast } = useFeedback()
  const now = useNow()
  const cal = useRef<CalendarHandle>(null)

  const [range, setRange] = useState<VisibleRange | null>(null)
  const [title, setTitle] = useState('')
  const [view, setView] = useState<CalendarViewName>(isMobile ? 'timeGridDay' : 'timeGridWeek')
  const [scope, setScope] = useState<Scope>(me.role === 'admin' ? 'team' : 'mine')
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [openId, setOpenId] = useState<string | null>(null)
  const [outsideTask, setOutsideTask] = useState<Task | null>(null)
  const [draft, setDraft] = useState<CreateDraft | null>(null)

  const { tasks, loading, error, reload, refreshTask } = useTasks(range, true, shell.notif.poke)
  const all = useMemo(() => [...tasks.values()], [tasks])

  // ── Derived data ──────────────────────────────────────────────────────────
  const dates = useMemo(() => {
    if (!range) return []
    const s = DateTime.fromJSDate(range.start).setZone(zone).toISODate()!
    const e = DateTime.fromJSDate(range.end).setZone(zone).toISODate()!
    return daysBetween(s, e)
  }, [range, zone])

  const categories = useMemo(
    () => [...new Set(all.map((t) => t.category).filter((c): c is string => !!c))].sort(),
    [all],
  )

  // Tickets stay off calendars until someone accepts them (they live on the Tickets page).
  const visibleTasks = useMemo(
    () =>
      all.filter((t) => {
        if (!onCalendar(t, me.user_id, scope)) return false
        if (
          scope === 'team' &&
          ownerFilter.length &&
          !t.assignments.some((a) => a.approval_status === 'accepted' && ownerFilter.includes(a.user_id))
        )
          return false
        if (filters.states.length && !filters.states.includes(displayState(t, me.user_id))) return false
        if (filters.priorities.length && !filters.priorities.includes(t.priority)) return false
        if (filters.categories.length && !filters.categories.includes(t.category ?? '')) return false
        return true
      }),
    [all, scope, ownerFilter, filters, me.user_id],
  )

  const focus = (scope === 'team' && ownerFilter.length === 1 ? people.get(ownerFilter[0]) : undefined) ?? me

  const today = DateTime.now().setZone(zone).toISODate()!
  const summaryDate = view === 'timeGridDay' ? dates[0] : dates.includes(today) ? today : dates[0]
  const summary = useMemo(() => {
    if (!summaryDate) return null
    const dayTasks = all.filter(
      (t) => isConfirmedFor(t, focus.user_id) && minutesByLocalDay(t.start_at, t.end_at, focus.timezone || zone).has(summaryDate),
    )
    const u = computeUtilization(all, focus, [summaryDate], zone)
    return {
      scheduled: dayTasks.length,
      completed: dayTasks.filter((t) => t.work_status === 'completed').length,
      pending: dayTasks.filter((t) => t.work_status === 'pending').length,
      planned: u.plannedMinutes,
      percent: u.percent,
      label: summaryDate === today ? 'Today' : DateTime.fromISO(summaryDate).toFormat('ccc d LLL'),
    }
  }, [all, focus, summaryDate, today, zone])

  const drawerTask = openId ? (tasks.get(openId) ?? (outsideTask?.id === openId ? outsideTask : null)) : null

  // ── Actions ───────────────────────────────────────────────────────────────
  const refresh = useCallback(
    async (id: string) => {
      const t = await refreshTask(id)
      setOutsideTask((o) => (o?.id === id ? t : o))
      if (!t) setOpenId((cur) => (cur === id ? null : cur))
      void shell.notif.reload()
      return t
    },
    [refreshTask, shell.notif],
  )

  const openTask = useCallback(
    async (id: string) => {
      let task: Task | null | undefined = tasks.get(id)
      if (!task) task = await fetchTask(id).catch(() => null)
      if (!task) return toast('That task is no longer available.', 'info')
      if (!tasks.has(id)) {
        setOutsideTask(task)
        cal.current?.gotoDate(task.start_at)
      }
      setOpenId(id)
    },
    [tasks, toast],
  )

  const newTaskAt = (start: Date, end: Date) => {
    setOpenId(null)
    setDraft({ start: start.toISOString(), end: end.toISOString() })
  }

  const newTaskNow = () => {
    const base = DateTime.now().setZone(zone)
    const start = base.minute < 30 ? base.set({ minute: 30, second: 0, millisecond: 0 }) : base.plus({ hours: 1 }).startOf('hour')
    newTaskAt(start.toJSDate(), start.plus({ hours: 1 }).toJSDate())
  }

  const followUp = (t: Task) => {
    const start = DateTime.fromISO(t.start_at).plus({ days: 1 })
    const minutes = (new Date(t.end_at).getTime() - new Date(t.start_at).getTime()) / 60000
    setDraft({
      start: start.toUTC().toISO()!,
      end: start.plus({ minutes }).toUTC().toISO()!,
      title: `Follow-up: ${t.title}`.slice(0, 200),
      ownerIds: t.assignments.filter((a) => a.approval_status === 'accepted').map((a) => a.user_id),
      priority: t.priority,
      category: t.category ?? undefined,
      customFields: t.custom_fields,
      parentTask: { id: t.id, title: t.title },
    })
  }

  const reschedule = async (task: Task, start: Date, end: Date) => {
    try {
      await updateTask(task.id, task.version, { start_at: start.toISOString(), end_at: end.toISOString() })
      const fresh = await refresh(task.id)
      const clash = fresh
        ? all.filter(
            (o) =>
              o.id !== fresh.id &&
              overlaps(o, fresh) &&
              fresh.assignments.some((a) => isConfirmedFor(fresh, a.user_id) && isConfirmedFor(o, a.user_id)),
          )
        : []
      toast(clash.length ? `Rescheduled — overlaps “${clash[0].title}”.` : 'Rescheduled.', clash.length ? 'info' : 'success')
    } catch (e) {
      const err = toApiError(e)
      if (err.isConflict) {
        toast('This task was changed by someone else, so the move was undone. Showing the latest version.', 'error')
        await refresh(task.id)
      } else {
        toast(err.message, 'error')
      }
      throw err
    }
  }

  const changeView = (v: CalendarViewName) => {
    setView(v)
    cal.current?.changeView(v)
  }

  const exportVisible = () => shell.openExport({ from: dates[0] ?? today, to: dates[dates.length - 1] ?? today })

  return (
    <>
      <div className={cx('flex min-h-0 flex-1 flex-col', !isMobile && drawerTask && 'xl:pr-[440px]')}>
        <TopBar
          title="Work Calendar"
          actions={
            <>
              {dates.length ? (
                <UtilizationIndicator tasks={all} focus={focus} team={profiles} dates={dates} showTeam={scope === 'team'} compact={isMobile} />
              ) : null}
              {!isMobile ? (
                <>
                  <Button variant="secondary" className="h-10" onClick={exportVisible}>
                    <FileSpreadsheet size={16} /> Export
                  </Button>
                  <Button variant="primary" className="h-10" onClick={newTaskNow}>
                    <Plus size={16} /> Add task
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        {/* Calendar toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2.5 px-4 pt-4 pb-3 md:px-6">
          <div className="flex items-center gap-1">
            <Button size="sm" className="mr-1 h-9 rounded-xl px-3.5" onClick={() => cal.current?.today()}>
              Today
            </Button>
            <Button size="icon" variant="ghost" aria-label="Previous" onClick={() => cal.current?.prev()}>
              <ChevronLeft size={18} />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Next" onClick={() => cal.current?.next()}>
              <ChevronRight size={18} />
            </Button>
          </div>
          <h2 className="min-w-0 font-display text-lg font-bold whitespace-nowrap text-ink md:text-xl" aria-live="polite">
            {title}
          </h2>
          {summary && !isMobile ? (
            <div className="hidden items-center gap-1.5 text-xs text-ash xl:flex" aria-label="Daily summary">
              <span className="ml-1 font-semibold text-ink">{summary.label}</span>
              <SummaryChip>{summary.scheduled} scheduled</SummaryChip>
              <SummaryChip tone="text-st-completed">{summary.completed} done</SummaryChip>
              {summary.pending ? <SummaryChip tone="text-st-pending">{summary.pending} pending</SummaryChip> : null}
              <SummaryChip>
                {formatHours(summary.planned)} · {pctLabel(summary.percent)}
              </SummaryChip>
            </div>
          ) : null}
          <span className="hidden flex-1 md:block" />
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            {!isMobile ? (
              <Segmented
                label="View"
                value={view}
                onChange={changeView}
                options={[
                  { value: 'timeGridDay', label: 'Day' },
                  { value: 'timeGridWeek', label: 'Week' },
                ]}
              />
            ) : null}
            <Segmented
              label="Calendar"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'mine', label: 'My calendar' },
                { value: 'team', label: 'Team' },
              ]}
            />
            {scope === 'team' ? (
              <OwnerSelector
                variant="filter"
                value={ownerFilter}
                onChange={setOwnerFilter}
                people={profiles}
                meId={me.user_id}
                allowEmpty
                label="Filter by owner"
              />
            ) : null}
            <FiltersPopover value={filters} onChange={setFilters} categories={categories} />
          </div>
        </div>

        {/* Calendar */}
        <main
          className="relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-2xl border border-line bg-ivory md:mx-6 md:mb-6"
          style={{ boxShadow: 'var(--shadow-card)', contain: 'layout paint' }}
        >
          {error ? (
            <div
              role="alert"
              className="absolute inset-x-4 top-4 z-10 flex items-center gap-3 rounded-xl border border-st-pending/20 bg-white px-4 py-3 text-sm text-st-pending shadow"
            >
              <span className="flex-1">Couldn’t load tasks: {error}</span>
              <Button size="sm" onClick={() => void reload()}>
                <RefreshCw size={14} /> Retry
              </Button>
            </div>
          ) : null}
          {loading && all.length === 0 ? (
            <div className="pointer-events-none absolute top-3 right-4 z-10 flex items-center gap-2 rounded-full bg-white/90 px-3 py-1 text-xs text-ash shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-apricot" /> Loading tasks…
            </div>
          ) : null}
          {!loading && !error && visibleTasks.length === 0 ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center px-4">
              <p className="rounded-full bg-white/95 px-4 py-2 text-center text-xs text-ash shadow">
                {all.length === 0
                  ? isMobile
                    ? 'Nothing scheduled. Tap + or long-press a time to add a task.'
                    : 'Nothing scheduled. Drag across the calendar or click a time slot to add a task.'
                  : 'No accepted tasks match this view.'}
              </p>
            </div>
          ) : null}
          <CalendarView
            ref={cal}
            tasks={visibleTasks}
            me={me}
            people={people}
            zone={zone}
            initialView={view}
            isMobile={isMobile}
            now={now}
            onRangeChange={(info) => {
              setRange({ start: info.start, end: info.end })
              setTitle(info.title)
              setView(info.view)
            }}
            onSelectRange={newTaskAt}
            onOpenTask={(id) => void openTask(id)}
            onReschedule={reschedule}
          />
        </main>
      </div>

      {isMobile ? (
        <button
          type="button"
          aria-label="Add task"
          onClick={newTaskNow}
          className="fixed right-5 bottom-6 z-20 flex h-14 w-14 items-center justify-center rounded-2xl bg-maroon text-white transition-transform active:scale-95"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <Plus size={24} />
        </button>
      ) : null}

      {drawerTask ? (
        <TaskDrawer
          key={drawerTask.id}
          task={drawerTask}
          onClose={() => setOpenId(null)}
          refreshTask={refresh}
          onCreateFollowUp={followUp}
          onOpenTask={(id) => void openTask(id)}
        />
      ) : null}

      <CreateTaskDialog
        draft={draft}
        categories={categories}
        onClose={() => setDraft(null)}
        onCreated={async (id) => {
          setDraft(null)
          await refresh(id)
        }}
      />
    </>
  )
}

function SummaryChip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return <span className={cx('rounded-full bg-white px-2 py-0.5 font-medium ring-1 ring-line', tone)}>{children}</span>
}
