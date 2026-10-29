import { useEffect, useState } from 'react'
import { AlertTriangle, CalendarClock, Check, Hourglass, X } from 'lucide-react'
import type { Activity, Profile, Task } from '../lib/types'
import { fetchOverlapping, type AssignmentResponse } from '../lib/api'
import { myAssignment } from '../lib/status'
import { formatTimeRange, fromLocalInputs, toLocalInputs } from '../lib/time'
import { Avatar, Button } from './ui/primitives'

interface Props {
  task: Task
  me: Profile
  zone: string
  people: Map<string, Profile>
  activities: Activity[]
  onRespond: (response: AssignmentResponse, opts?: { note?: string; start_at?: string; end_at?: string }) => Promise<void>
  onUseTime: (start: string, end: string) => Promise<void>
  onRemoveOwner: (userId: string) => Promise<void>
}

/** Accept / decline / suggest for owners; the response overview for requesters. */
export function ApprovalControls(props: Props) {
  const { task, me } = props
  const mine = myAssignment(task, me.user_id)
  const isRequester = task.requester_id === me.user_id || task.created_by === me.user_id
  return (
    <>
      {mine?.approval_status === 'pending' ? <RespondCard {...props} /> : null}
      {isRequester && task.approval_state !== 'confirmed' ? <RequestStatusCard {...props} /> : null}
    </>
  )
}

function RespondCard({ task, me, zone, people, onRespond }: Props) {
  const [mode, setMode] = useState<'idle' | 'decline' | 'suggest'>('idle')
  const [busy, setBusy] = useState<AssignmentResponse | null>(null)
  const [note, setNote] = useState('')
  const start = toLocalInputs(task.start_at, zone)
  const end = toLocalInputs(task.end_at, zone)
  const [sDate, setSDate] = useState(start.date)
  const [sTime, setSTime] = useState(start.time)
  const [eTime, setETime] = useState(end.time)
  const [conflicts, setConflicts] = useState<Task[]>([])
  const requester = people.get(task.requester_id ?? task.created_by ?? '')?.name ?? 'Someone'

  useEffect(() => {
    let alive = true
    fetchOverlapping([me.user_id], task.start_at, task.end_at, task.id)
      .then((rows) => alive && setConflicts(rows))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [me.user_id, task.start_at, task.end_at, task.id])

  async function run(response: AssignmentResponse) {
    setBusy(response)
    try {
      if (response === 'suggest') {
        const s = fromLocalInputs(sDate, sTime, zone)
        const e = fromLocalInputs(sDate, eTime, zone)
        await onRespond('suggest', { note, start_at: s ?? undefined, end_at: e ?? undefined })
      } else {
        await onRespond(response, { note })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-st-awaiting/25 bg-st-awaiting/[0.06] p-4">
      <div className="flex items-start gap-2.5">
        <Hourglass size={18} className="mt-0.5 shrink-0 text-st-awaiting" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{requester} asked you to take this on</p>
          <p className="mt-0.5 text-xs text-ash">{formatTimeRange(task.start_at, task.end_at, zone)}</p>
        </div>
      </div>
      {conflicts.length ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-white/70 px-3 py-2 text-xs text-st-pending">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          Overlaps with {conflicts.map((c) => `“${c.title}”`).join(', ')} on your calendar.
        </p>
      ) : null}
      {mode === 'idle' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={busy === 'accept'} onClick={() => run('accept')}>
            <Check size={14} /> Accept
          </Button>
          <Button size="sm" onClick={() => setMode('suggest')}>
            <CalendarClock size={14} /> Suggest time
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('decline')}>
            <X size={14} /> Decline
          </Button>
        </div>
      ) : (
        <div className="anim-pop mt-3 space-y-2">
          {mode === 'suggest' ? (
            <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
              <input type="date" aria-label="Suggested date" className="field h-9" value={sDate} onChange={(e) => setSDate(e.target.value)} />
              <input type="time" aria-label="Suggested start" className="field h-9 w-[104px]" value={sTime} onChange={(e) => setSTime(e.target.value)} />
              <input type="time" aria-label="Suggested end" className="field h-9 w-[104px]" value={eTime} onChange={(e) => setETime(e.target.value)} />
            </div>
          ) : null}
          <input
            className="field h-9"
            placeholder={mode === 'decline' ? 'Reason (optional)' : 'Note for the requester (optional)'}
            aria-label="Note"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
              Back
            </Button>
            {mode === 'decline' ? (
              <Button size="sm" variant="danger" loading={busy === 'decline'} onClick={() => run('decline')}>
                Decline request
              </Button>
            ) : (
              <Button size="sm" variant="primary" loading={busy === 'suggest'} onClick={() => run('suggest')}>
                Send suggestion
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function RequestStatusCard({ task, me, zone, people, activities, onUseTime, onRemoveOwner }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const others = task.assignments.filter((a) => a.user_id !== me.user_id)
  const latestSuggestion = (userId: string) =>
    activities.find((a) => a.activity_type === 'time_suggested' && a.actor_id === userId)
  const latestDecline = (userId: string) =>
    activities.find((a) => a.activity_type === 'assignment_declined' && a.actor_id === userId)
  const accepted = others.filter((a) => a.approval_status === 'accepted').length

  return (
    <section className="rounded-2xl border border-st-awaiting/25 bg-st-awaiting/[0.06] p-4">
      <p className="text-sm font-semibold text-ink">
        {task.approval_state === 'needs_revision' ? 'Your request needs revision' : 'Waiting for owners to respond'}
      </p>
      <p className="mt-0.5 text-xs text-ash">
        {accepted} of {others.length} accepted. The task is confirmed once everyone accepts.
      </p>
      <ul className="mt-3 space-y-2">
        {others.map((a) => {
          const person = people.get(a.user_id)
          const suggestion = a.approval_status === 'suggested' ? latestSuggestion(a.user_id) : undefined
          const decline = a.approval_status === 'declined' ? latestDecline(a.user_id) : undefined
          const sStart = suggestion?.metadata.start_at as string | undefined
          const sEnd = suggestion?.metadata.end_at as string | undefined
          return (
            <li key={a.user_id} className="rounded-xl bg-white/80 px-3 py-2">
              <div className="flex items-center gap-2">
                <Avatar id={a.user_id} name={person?.name ?? '?'} size={22} />
                <span className="flex-1 truncate text-sm font-medium">{person?.name ?? 'Unknown'}</span>
                <StatusPill status={a.approval_status} />
              </div>
              {suggestion && sStart && sEnd ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ash">
                  <span>
                    Suggests <b className="text-ink">{formatTimeRange(sStart, sEnd, zone)}</b>
                    {suggestion.note ? ` — “${suggestion.note}”` : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="soft"
                    loading={busy === a.user_id}
                    onClick={async () => {
                      setBusy(a.user_id)
                      try {
                        await onUseTime(sStart, sEnd)
                      } finally {
                        setBusy(null)
                      }
                    }}
                  >
                    Use this time
                  </Button>
                </div>
              ) : null}
              {a.approval_status === 'declined' ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ash">
                  {decline?.note ? <span className="flex-1">“{decline.note}”</span> : <span className="flex-1">Declined</span>}
                  {others.length > 1 ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `rm-${a.user_id}`}
                      onClick={async () => {
                        setBusy(`rm-${a.user_id}`)
                        try {
                          await onRemoveOwner(a.user_id)
                        } finally {
                          setBusy(null)
                        }
                      }}
                    >
                      Remove from request
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {task.approval_state === 'needs_revision' ? (
        <p className="mt-3 text-xs text-ash">Change the time or owners below and everyone will be asked again.</p>
      ) : null}
    </section>
  )
}

export function StatusPill({ status }: { status: Task['assignments'][number]['approval_status'] }) {
  const map = {
    accepted: ['Accepted', 'bg-st-completed/10 text-st-completed'],
    pending: ['Awaiting', 'bg-st-awaiting/10 text-st-awaiting'],
    declined: ['Declined', 'bg-st-pending/10 text-st-pending'],
    suggested: ['New time', 'bg-apricot/15 text-[#9a5a14]'],
  } as const
  const [label, cls] = map[status]
  return <span className={`chip ${cls}`}>{label}</span>
}
