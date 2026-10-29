import { useRef, useState } from 'react'
import { Bell, BellRing, CheckCheck, Hourglass, Send } from 'lucide-react'
import type { Task } from '../lib/types'
import type { RequestUpdate } from '../lib/api'
import { ACTIVITY_LABEL } from '../lib/activity'
import { desktopAlertState, disableDesktopAlerts, enableDesktopAlerts, type DesktopAlertState } from '../lib/desktopAlerts'
import { APPROVAL_STATE_LABEL } from '../lib/status'
import { formatRelative, formatTimeRange } from '../lib/time'
import { useApp } from '../context'
import { Avatar, Button, EmptyState, cx, useDismiss, usePresence } from './ui/primitives'

interface Props {
  pending: Task[]
  requests: Task[]
  updates: RequestUpdate[]
  badge: number
  seenAt: string
  onOpenTask: (task: Task | string) => void
  onOpen: () => void
  onMarkSeen: () => void
}

type Tab = 'respond' | 'requests'

export function NotificationsPopover({ pending, requests, updates, badge, seenAt, onOpenTask, onOpen, onMarkSeen }: Props) {
  const { people, zone } = useApp()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('respond')
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => {
    setOpen(false)
    onMarkSeen()
  })
  const seenMs = seenAt ? new Date(seenAt).getTime() : 0
  const panel = usePresence(open)

  const toggle = () => {
    if (!open) {
      onOpen()
      setTab(pending.length || !updates.length ? 'respond' : 'requests')
    } else onMarkSeen()
    setOpen(!open)
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="icon" className="relative h-10 w-10" aria-label={`Notifications${badge ? `, ${badge} new` : ''}`} onClick={toggle}>
        <Bell size={17} />
        {badge ? <Badge n={badge} /> : null}
      </Button>
      {panel.mounted ? (
        <div
          className={cx(
            'absolute right-0 z-50 mt-2 w-[380px] max-w-[calc(100vw-1.5rem)] origin-top-right rounded-2xl border border-line bg-ivory',
            panel.closing ? 'anim-pop-out pointer-events-none' : 'anim-pop',
          )}
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <div className="flex gap-1 border-b border-line p-2">
            <TabButton active={tab === 'respond'} onClick={() => setTab('respond')}>
              Needs your response {pending.length ? <span className="chip bg-st-awaiting text-white">{pending.length}</span> : null}
            </TabButton>
            <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
              My requests
            </TabButton>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {tab === 'respond' ? (
              pending.length === 0 ? (
                <EmptyState icon={<CheckCheck size={18} />} title="You’re all caught up">
                  Assignment requests from teammates will appear here.
                </EmptyState>
              ) : (
                pending.map((t) => {
                  const from = people.get(t.requester_id ?? t.created_by ?? '')
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onOpenTask(t)
                      }}
                      className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left hover:bg-canvas"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-st-awaiting/10 text-st-awaiting">
                        <Hourglass size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{t.title}</span>
                        <span className="block text-xs text-ash">{formatTimeRange(t.start_at, t.end_at, zone)}</span>
                        <span className="block text-xs text-stone">From {from?.name ?? 'a teammate'} · tap to accept, decline or suggest a time</span>
                      </span>
                    </button>
                  )
                })
              )
            ) : (
              <>
                {updates.length ? (
                  <div className="mb-2">
                    <p className="section-title px-2 pt-1 pb-1.5">Latest responses</p>
                    {updates.slice(0, 8).map((u) => {
                      const who = people.get(u.actor_id ?? '')
                      const unread = new Date(u.created_at).getTime() > seenMs
                      return (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setOpen(false)
                            onOpenTask(u.task_id)
                          }}
                          className="flex w-full items-start gap-2.5 rounded-xl p-2 text-left hover:bg-canvas"
                        >
                          {who ? <Avatar id={who.user_id} name={who.name} size={26} /> : <span className="h-[26px] w-[26px]" />}
                          <span className="min-w-0 flex-1 text-xs">
                            <span className="block">
                              <b>{u.activity_type.startsWith('request_') ? '' : `${who?.name ?? 'Someone'} · `}</b>
                              {ACTIVITY_LABEL[u.activity_type]}
                            </span>
                            <span className="block truncate text-ash">{u.tasks.title}</span>
                            {u.note ? <span className="block truncate text-stone">“{u.note}”</span> : null}
                          </span>
                          <span className="shrink-0 text-[10.5px] text-stone">{formatRelative(u.created_at, zone)}</span>
                          {unread ? <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-ember" aria-label="New" /> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
                <p className="section-title px-2 pt-1 pb-1.5">Requests you raised</p>
                {requests.length === 0 ? (
                  <EmptyState icon={<Send size={18} />} title="No requests yet">
                    Create a task and add a teammate as owner to request their time.
                  </EmptyState>
                ) : (
                  requests.map((t) => {
                    const accepted = t.assignments.filter((a) => a.approval_status === 'accepted').length
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setOpen(false)
                          onOpenTask(t)
                        }}
                        className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-canvas"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{t.title}</span>
                          <span className="block text-xs text-ash">{formatTimeRange(t.start_at, t.end_at, zone)}</span>
                        </span>
                        <span
                          className={cx(
                            'chip',
                            t.approval_state === 'confirmed'
                              ? 'bg-st-completed/10 text-st-completed'
                              : t.approval_state === 'needs_revision'
                                ? 'bg-st-pending/10 text-st-pending'
                                : 'bg-st-awaiting/10 text-st-awaiting',
                          )}
                        >
                          {t.approval_state === 'awaiting_approval'
                            ? `${accepted}/${t.assignments.length} accepted`
                            : APPROVAL_STATE_LABEL[t.approval_state]}
                        </span>
                      </button>
                    )
                  })
                )}
              </>
            )}
          </div>
          <DesktopAlertsRow />
        </div>
      ) : null}
    </div>
  )
}

/** Opt in to OS notifications for new tickets while the app is in a background tab. */
function DesktopAlertsRow() {
  const [state, setState] = useState<DesktopAlertState>(desktopAlertState)
  if (state === 'unsupported') return null
  return (
    <div className="flex items-center gap-2.5 border-t border-line px-4 py-3 text-xs">
      <BellRing size={14} className="shrink-0 text-ash" />
      <span className="flex-1 text-ash">
        {state === 'blocked' ? 'Desktop alerts are blocked in your browser settings.' : 'Desktop alerts for new tickets'}
      </span>
      {state === 'on' ? (
        <Button size="sm" variant="ghost" onClick={() => setState(disableDesktopAlerts())}>
          Turn off
        </Button>
      ) : state === 'off' ? (
        <Button size="sm" variant="soft" onClick={() => void enableDesktopAlerts().then(setState)}>
          Turn on
        </Button>
      ) : null}
    </div>
  )
}

function Badge({ n }: { n: number }) {
  return (
    <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ember px-1 text-[10px] font-bold text-white ring-2 ring-ivory">
      {n > 9 ? '9+' : n}
    </span>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-semibold',
        active ? 'bg-canvas text-ink' : 'text-ash hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
