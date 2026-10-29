import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { Check, ChevronRight, Flag, Inbox, Plus, Search, Send, Ticket as TicketIcon } from 'lucide-react'
import type { Task } from '../lib/types'
import { supabase } from '../lib/supabase'
import {
  fetchAllTickets,
  fetchMyRequests,
  fetchPendingForMe,
  fetchTask,
  fetchTicketsAssignedTo,
  respondToAssignment,
  toApiError,
} from '../lib/api'
import { acceptedCount, TICKET_STATUS_LABEL, TICKET_STATUS_STYLE, ticketStatus, type TicketStatus } from '../lib/tickets'
import { formatRelative, formatTimeRange } from '../lib/time'
import { useApp } from '../context'
import { useShell, TopBar } from './AppShell'
import { CreateTaskDialog, type CreateDraft } from './CreateTaskDialog'
import { TaskDrawer } from './TaskDrawer'
import { useFeedback } from './ui/feedback'
import { Avatar, Button, EmptyState, Segmented, cx } from './ui/primitives'

type Tab = 'respond' | 'raised' | 'assigned' | 'all'

const ROW_GRID = 'grid-cols-[minmax(0,1fr)_9.5rem_8.5rem_11rem_10rem_1.25rem] items-center gap-4'
type StatusFilter = 'all' | 'open' | 'active' | 'done'

const STATUS_GROUP: Record<Exclude<StatusFilter, 'all'>, TicketStatus[]> = {
  open: ['awaiting', 'needs_revision'],
  active: ['accepted', 'in_progress', 'on_hold'],
  done: ['completed', 'cancelled'],
}

export function TicketsPage({ openId, initialTab }: { openId?: string; initialTab?: string }) {
  const { me, people, zone, isMobile } = useApp()
  const shell = useShell()
  const { toast } = useFeedback()
  const isRequester = me.role === 'requester'

  const tabs: { value: Tab; label: string }[] = isRequester
    ? [{ value: 'raised', label: 'My tickets' }]
    : [
        { value: 'respond', label: `To respond${shell.notif.pending.length ? ` · ${shell.notif.pending.length}` : ''}` },
        { value: 'raised', label: 'Raised by me' },
        { value: 'assigned', label: 'Assigned to me' },
        ...(me.role === 'admin' ? [{ value: 'all' as const, label: 'All tickets' }] : []),
      ]

  const [tab, setTab] = useState<Tab>(() => {
    if (initialTab && tabs.some((t) => t.value === initialTab)) return initialTab as Tab
    if (isRequester) return 'raised'
    return shell.notif.pending.length ? 'respond' : 'raised'
  })
  const [rows, setRows] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [open, setOpen] = useState<Task | null>(null)
  const [draft, setDraft] = useState<CreateDraft | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    setLoading(true)
    try {
      const data =
        tab === 'respond'
          ? await fetchPendingForMe(me.user_id)
          : tab === 'raised'
            ? await fetchMyRequests(me.user_id, 100)
            : tab === 'assigned'
              ? await fetchTicketsAssignedTo(me.user_id)
              : await fetchAllTickets()
      if (n !== seq.current) return
      setRows(data)
      setError(null)
    } catch (e) {
      if (n === seq.current) setError(toApiError(e).message)
    } finally {
      if (n === seq.current) setLoading(false)
    }
  }, [tab, me.user_id])

  useEffect(() => {
    void load()
  }, [load])

  // Live: any visible task change refreshes the list (RLS limits what arrives).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const channel = supabase
      .channel('tickets-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        clearTimeout(timer)
        timer = setTimeout(() => void load(), 500)
      })
      .subscribe()
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [load])

  // Deep link: #/tickets?open=<id>
  useEffect(() => {
    if (!openId) return
    fetchTask(openId)
      .then((t) => (t ? setOpen(t) : toast('That ticket is no longer available.', 'info')))
      .catch(() => undefined)
  }, [openId, toast])

  const refresh = useCallback(
    async (id: string) => {
      const t = await fetchTask(id)
      setOpen((cur) => (cur?.id === id ? t : cur))
      setRows((prev) => (t ? prev.map((r) => (r.id === id ? t : r)) : prev.filter((r) => r.id !== id)))
      void shell.notif.reload()
      void load()
      return t
    },
    [shell.notif, load],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((t) => {
      if (status !== 'all' && !STATUS_GROUP[status].includes(ticketStatus(t))) return false
      if (!q) return true
      const names = t.assignments.map((a) => people.get(a.user_id)?.name ?? '').join(' ')
      return `${t.title} ${t.category ?? ''} ${people.get(t.requester_id ?? '')?.name ?? ''} ${names}`.toLowerCase().includes(q)
    })
  }, [rows, query, status, people])

  async function quickAccept(t: Task) {
    setAccepting(t.id)
    try {
      await respondToAssignment(t.id, 'accept')
      toast(`Accepted — “${t.title}” is on your calendar.`)
      await refresh(t.id)
    } catch (e) {
      toast(toApiError(e).message, 'error')
    } finally {
      setAccepting(null)
    }
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

  return (
    <>
      <div className={cx('flex min-h-0 flex-1 flex-col', !isMobile && open && 'xl:pr-[440px]')}>
        <TopBar
          title="Tickets"
          actions={
            <Button variant="primary" className="h-10" onClick={() => shell.navigate('new-ticket')} aria-label="New ticket">
              <Plus size={16} />
              <span className="hidden sm:inline">New ticket</span>
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold text-ink">{isRequester ? 'Your tickets' : 'Tickets'}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ash">
                {isRequester
                  ? 'Raise work for the team and follow it from request to completion.'
                  : 'Work requested by teammates. Accepted tickets are added to your calendar; nothing lands there until you say yes.'}
              </p>
            </div>

            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
              {tabs.length > 1 ? (
                <div className="-mx-1 overflow-x-auto px-1 pb-1 lg:pb-0">
                  <Segmented label="Ticket list" value={tab} onChange={setTab} options={tabs} />
                </div>
              ) : null}
              <span className="hidden flex-1 lg:block" />
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
                  <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone" />
                  <input
                    className="field h-10 pl-9"
                    placeholder="Search tickets"
                    aria-label="Search tickets"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <select aria-label="Status" className="field h-10 w-auto pr-8" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="active">Accepted & active</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>

            <section className="card @container overflow-hidden" aria-busy={loading}>
              {filtered.length > 0 || loading ? (
                <div className={cx(ROW_GRID, 'hidden border-b border-line bg-canvas/60 px-5 py-2.5 text-[11px] font-semibold tracking-wide text-stone uppercase @4xl:grid')}>
                  <span>Ticket</span>
                  <span>Requested by</span>
                  <span>Assignees</span>
                  <span>Proposed time</span>
                  <span>Status</span>
                  <span />
                </div>
              ) : null}

              {error ? (
                <div className="flex items-center gap-3 px-5 py-4 text-sm text-st-pending">
                  <span className="flex-1">Couldn’t load tickets: {error}</span>
                  <Button size="sm" onClick={() => void load()}>
                    Retry
                  </Button>
                </div>
              ) : loading && rows.length === 0 ? (
                <div className="space-y-px">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-5 py-4">
                      <div className="skeleton h-4 flex-1 rounded-md" />
                      <div className="skeleton h-4 w-24 rounded-md" />
                      <div className="skeleton h-4 w-28 rounded-md" />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon={tab === 'respond' ? <Check size={18} /> : tab === 'raised' ? <Send size={18} /> : <Inbox size={18} />}
                  title={
                    rows.length && (query || status !== 'all')
                      ? 'No tickets match'
                      : tab === 'respond'
                        ? 'You’re all caught up'
                        : tab === 'raised'
                          ? 'No tickets yet'
                          : 'Nothing here yet'
                  }
                >
                  {rows.length && (query || status !== 'all') ? (
                    'Try another search or status.'
                  ) : tab === 'raised' ? (
                    <Button variant="soft" size="sm" className="mt-2" onClick={() => shell.navigate('new-ticket')}>
                      <Plus size={14} /> Raise a ticket
                    </Button>
                  ) : tab === 'respond' ? (
                    'New requests from teammates will appear here.'
                  ) : null}
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {filtered.map((t) => (
                    <TicketRow
                      key={t.id}
                      task={t}
                      active={open?.id === t.id}
                      showAccept={tab === 'respond'}
                      accepting={accepting === t.id}
                      onAccept={() => void quickAccept(t)}
                      onOpen={() => setOpen(t)}
                      zone={zone}
                    />
                  ))}
                </ul>
              )}
            </section>
            {filtered.length ? (
              <p className="mt-3 text-xs text-stone">
                {filtered.length} ticket{filtered.length === 1 ? '' : 's'}
                {loading ? ' · refreshing…' : ''}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <TaskDrawer
          key={open.id}
          task={open}
          onClose={() => {
            setOpen(null)
            if (openId) shell.navigate('tickets')
          }}
          refreshTask={refresh}
          onCreateFollowUp={followUp}
          onOpenTask={(id) =>
            void fetchTask(id).then((t) => (t ? setOpen(t) : toast('That task is no longer available.', 'info')))
          }
        />
      ) : null}

      <CreateTaskDialog
        draft={draft}
        categories={[]}
        onClose={() => setDraft(null)}
        onCreated={async () => {
          setDraft(null)
          await load()
        }}
      />
    </>
  )
}

function TicketRow({
  task,
  active,
  showAccept,
  accepting,
  onAccept,
  onOpen,
  zone,
}: {
  task: Task
  active: boolean
  showAccept: boolean
  accepting: boolean
  onAccept: () => void
  onOpen: () => void
  zone: string
}) {
  const { people } = useApp()
  const st = ticketStatus(task)
  const { accepted, total } = acceptedCount(task)
  const requester = people.get(task.requester_id ?? task.created_by ?? '')
  const when = formatTimeRange(task.start_at, task.end_at, zone)
  const statusChip = (
    <span className={cx('chip', TICKET_STATUS_STYLE[st])}>
      {st === 'awaiting' && total > 1 ? `${accepted}/${total} accepted` : TICKET_STATUS_LABEL[st]}
    </span>
  )
  const assignees = (
    <span className="flex -space-x-1.5">
      {task.assignments.slice(0, 4).map((a) => (
        <span key={a.user_id} className={cx('relative rounded-full', a.approval_status !== 'accepted' && 'opacity-60')}>
          <Avatar id={a.user_id} name={people.get(a.user_id)?.name ?? '?'} size={26} ring />
          {a.approval_status === 'declined' ? (
            <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-st-pending ring-2 ring-white" />
          ) : a.approval_status === 'accepted' ? (
            <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-st-completed ring-2 ring-white" />
          ) : null}
        </span>
      ))}
      {task.assignments.length > 4 ? (
        <span className="flex h-[26px] items-center rounded-full bg-canvas px-1.5 text-[10px] font-bold text-ash ring-2 ring-white">
          +{task.assignments.length - 4}
        </span>
      ) : null}
    </span>
  )
  const titleBlock = (
    <span className="block min-w-0">
      <span className="flex items-center gap-1.5">
        {task.priority === 'high' ? <Flag size={12} className="shrink-0 text-ember" aria-label="High priority" /> : null}
        <span className="truncate text-sm font-semibold text-ink">{task.title}</span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-stone">
        {task.category ? `${task.category} · ` : ''}raised {formatRelative(task.created_at, zone)}
      </span>
    </span>
  )
  const actions = showAccept ? (
    <span className="flex items-center gap-1.5">
      <Button size="sm" variant="primary" loading={accepting} onClick={onAccept}>
        {!accepting ? <Check size={13} /> : null} Accept
      </Button>
      <Button size="sm" variant="secondary" onClick={onOpen}>
        Review
      </Button>
    </span>
  ) : null

  return (
    <li className={cx('group relative transition-colors duration-150', active ? 'bg-peach-50/70' : 'hover:bg-canvas/70')}>
      {/* Narrow list: stacked card */}
      <div className="@4xl:hidden">
        <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-4 pt-3.5 pb-3 text-left">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-peach-50 text-maroon">
            <TicketIcon size={15} />
          </span>
          <span className="min-w-0 flex-1">
            {titleBlock}
            <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-ash">
              {statusChip}
              <span>{when}</span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1.5">
            {assignees}
            {requester ? <span className="text-[11px] text-stone">by {requester.name}</span> : null}
          </span>
        </button>
        {actions ? <div className="px-4 pb-3.5 pl-[3.75rem]">{actions}</div> : null}
      </div>

      {/* Wide list: table row */}
      <div className="hidden @4xl:block">
        <button type="button" onClick={onOpen} className={cx(ROW_GRID, 'grid w-full px-5 py-3.5 text-left')}>
          {titleBlock}
          <span className="flex min-w-0 items-center gap-2">
            {requester ? <Avatar id={requester.user_id} name={requester.name} size={24} /> : null}
            <span className="truncate text-sm text-ink">{requester?.name ?? '—'}</span>
          </span>
          {assignees}
          <span className="text-xs leading-snug text-ash">{when}</span>
          <span className={cx('flex', showAccept && 'invisible')}>{statusChip}</span>
          <ChevronRight size={16} className="text-stone transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>
        {actions ? <div className="absolute top-1/2 right-12 -translate-y-1/2">{actions}</div> : null}
      </div>
    </li>
  )
}
