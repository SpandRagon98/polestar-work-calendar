import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  CopyPlus,
  Flag,
  GitBranch,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  RotateCcw,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Activity, Priority, Task, TaskPatch, WorkStatus } from '../lib/types'
import {
  addBookmark,
  deleteTask,
  fetchActivities,
  respondToAssignment,
  setTaskOwners,
  toApiError,
  updateTask,
  type AssignmentResponse,
} from '../lib/api'
import { canAddNote, canDelete, canEdit, canReschedule } from '../lib/permissions'
import {
  PENDING_REASONS,
  PRIORITY_LABEL,
  STATE_LABEL,
  displayState,
  formatPendingReason,
  needsUpdate,
  parsePendingReason,
} from '../lib/status'
import { validateFields } from '../lib/customFields'
import { durationMinutes, formatDuration, formatRelative, formatTimeRange, fromLocalInputs, toLocalInputs } from '../lib/time'
import { useApp, useNow } from '../context'
import { ApprovalControls, StatusPill } from './ApprovalControls'
import { BookmarkList } from './BookmarkList'
import { CustomFieldEditor } from './CustomFieldEditor'
import { OwnerSelector } from './OwnerSelector'
import { ProgressControl } from './ProgressControl'
import { useFeedback } from './ui/feedback'
import { Avatar, Button, Popover, Segmented, cx, useAnimatedClose } from './ui/primitives'

interface Props {
  task: Task
  onClose: () => void
  refreshTask: (id: string) => Promise<Task | null>
  onCreateFollowUp: (task: Task) => void
  onOpenTask: (id: string) => void
}

const STATE_CHIP: Record<string, string> = {
  scheduled: 'bg-st-scheduled/12 text-[#5f5a57]',
  in_progress: 'bg-st-progress/12 text-[#9a5512]',
  completed: 'bg-st-completed/12 text-st-completed',
  pending: 'bg-st-pending/10 text-st-pending',
  cancelled: 'bg-line text-stone',
  awaiting: 'bg-st-awaiting/12 text-st-awaiting',
  needs_revision: 'bg-st-awaiting/12 text-st-awaiting',
}

const PAGE = 40

export function TaskDrawer({ task, onClose: closeNow, refreshTask, onCreateFollowUp, onOpenTask }: Props) {
  const [closing, onClose] = useAnimatedClose(closeNow)
  const { me, people, profiles, zone, isMobile } = useApp()
  const { toast, confirm } = useFeedback()
  const now = useNow(30_000)
  const editable = canEdit(task, me)
  // Requesters follow progress; the people doing the work update it.
  const canWork = editable && me.role !== 'requester'
  const reschedulable = canReschedule(task, me)
  const state = displayState(task, me.user_id)
  const stale = needsUpdate(task, now)

  // ── Activity history (live) ───────────────────────────────────────────────
  const [activities, setActivities] = useState<Activity[]>([])
  const [actLoading, setActLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)

  const loadActivities = useCallback(async () => {
    try {
      const rows = await fetchActivities(task.id, { limit: PAGE })
      setActivities(rows)
      setHasMore(rows.length === PAGE)
    } catch (e) {
      toast(toApiError(e).message, 'error')
    } finally {
      setActLoading(false)
    }
  }, [task.id, toast])

  useEffect(() => {
    setActivities([])
    setActLoading(true)
    void loadActivities()
    const channel = supabase
      .channel(`activities-${task.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'task_activities', filter: `task_id=eq.${task.id}` },
        (payload) => {
          const row = payload.new as Activity
          setActivities((prev) => (prev.some((a) => a.id === row.id) ? prev : [row, ...prev]))
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [task.id, loadActivities])

  const loadOlder = async () => {
    const last = activities[activities.length - 1]
    if (!last) return
    const rows = await fetchActivities(task.id, { limit: PAGE, before: last.created_at })
    setActivities((prev) => [...prev, ...rows])
    setHasMore(rows.length === PAGE)
  }

  // ── Writes ────────────────────────────────────────────────────────────────
  /** Run a versioned write; on a concurrency conflict, show the latest data instead. */
  const mutate = useCallback(
    async (fn: (version: number) => Promise<unknown>, success?: string): Promise<boolean> => {
      try {
        await fn(task.version)
        await refreshTask(task.id)
        if (success) toast(success)
        return true
      } catch (e) {
        const err = toApiError(e)
        if (err.isConflict) {
          toast('Someone else just updated this task — showing the latest version. Please re-apply your change.', 'error')
          await refreshTask(task.id)
        } else {
          toast(err.message, 'error')
        }
        return false
      }
    },
    [task.id, task.version, refreshTask, toast],
  )

  const patch = (p: TaskPatch, success?: string) => mutate((v) => updateTask(task.id, v, p), success)

  const respond = async (response: AssignmentResponse, opts?: { note?: string; start_at?: string; end_at?: string }) => {
    const labels = { accept: 'Accepted — it’s on your calendar.', decline: 'Request declined.', suggest: 'Suggestion sent to the requester.' }
    await mutate(() => respondToAssignment(task.id, response, opts), labels[response])
  }

  // ── Local UI state ────────────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingTime, setEditingTime] = useState(false)
  const [editingOwners, setEditingOwners] = useState(false)
  const [ownerDraft, setOwnerDraft] = useState<string[]>([])
  const [pendingOpen, setPendingOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [title, setTitle] = useState(task.title)
  useEffect(() => setTitle(task.title), [task.title])

  // Custom fields are edited as a draft and saved together.
  const [fieldDraft, setFieldDraft] = useState(task.custom_fields)
  const [fieldBase, setFieldBase] = useState({ version: task.version, json: JSON.stringify(task.custom_fields) })
  const fieldsDirty = JSON.stringify(fieldDraft) !== fieldBase.json
  const fieldsStale = fieldsDirty && task.version !== fieldBase.version && JSON.stringify(task.custom_fields) !== fieldBase.json
  const lastTaskId = useRef(task.id)
  useEffect(() => {
    // Adopt server values when not editing (or when switching task).
    if (lastTaskId.current !== task.id || !fieldsDirty) {
      lastTaskId.current = task.id
      setFieldDraft(task.custom_fields)
      setFieldBase({ version: task.version, json: JSON.stringify(task.custom_fields) })
    }
  }, [task.id, task.version, task.custom_fields])

  const fieldError = fieldsDirty ? validateFields(fieldDraft) : null
  const saveFields = async () => {
    if (fieldError) return toast(fieldError, 'error')
    const ok = await mutate((v) => updateTask(task.id, v, { custom_fields: fieldDraft }), 'Fields saved.')
    if (ok) setFieldBase({ version: task.version + 1, json: JSON.stringify(fieldDraft) })
  }
  const discardFields = () => {
    setFieldDraft(task.custom_fields)
    setFieldBase({ version: task.version, json: JSON.stringify(task.custom_fields) })
  }

  const owners = task.assignments
  const ownerIds = owners.map((a) => a.user_id)
  const creator = people.get(task.created_by ?? '')
  const requester = task.requester_id ? people.get(task.requester_id) : undefined

  const setStatus = async (s: WorkStatus) => {
    if (s === 'pending') return setPendingOpen(true)
    if (s === 'completed') return patch({ work_status: 'completed' }, 'Marked completed.')
    if (s === 'cancelled') {
      const ok = await confirm({
        title: 'Cancel this task?',
        message: 'It stays on the calendar (struck through) and stops counting toward utilization.',
        confirmLabel: 'Cancel task',
        danger: true,
      })
      if (!ok) return
    }
    return patch({ work_status: s })
  }

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this task?',
      message: 'The task, its owners and its full history will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteTask(task.id)
      toast('Task deleted.')
      closeNow()
      await refreshTask(task.id)
    } catch (e) {
      toast(toApiError(e).message, 'error')
    }
  }

  // Escape closes the drawer unless a dialog or popover is handling it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"]')) return
      const target = e.target as HTMLElement | null
      if (target?.closest('[role="listbox"], [role="menu"]') || menuOpen || pendingOpen || editingTime || editingOwners) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, menuOpen, pendingOpen, editingTime, editingOwners])

  const minutes = durationMinutes(task.start_at, task.end_at)
  const statusOptions: { value: WorkStatus; label: string }[] = [
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'pending', label: 'Pending' },
    { value: 'completed', label: 'Completed' },
  ]

  const body = (
    <>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-line bg-ivory px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <span className={cx('chip', STATE_CHIP[state])}>{STATE_LABEL[state]}</span>
          {task.priority !== 'medium' ? (
            <span className={cx('chip', task.priority === 'high' ? 'bg-ember/10 text-ember' : 'bg-canvas text-ash')}>
              <Flag size={10} /> {PRIORITY_LABEL[task.priority]}
            </span>
          ) : null}
          {task.category ? <span className="chip bg-canvas text-ash">{task.category}</span> : null}
          <span className="flex-1" />
          <div className="relative">
            <Button variant="ghost" size="icon" aria-label="More actions" aria-haspopup="menu" onClick={() => setMenuOpen((o) => !o)}>
              <MoreHorizontal size={18} />
            </Button>
            <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="w-56 p-1.5">
              <div role="menu">
                {editable ? (
                  <MenuItem icon={<CopyPlus size={15} />} onClick={() => (setMenuOpen(false), onCreateFollowUp(task))}>
                    Create follow-up
                  </MenuItem>
                ) : null}
                {editable && task.work_status !== 'cancelled' ? (
                  <MenuItem icon={<Ban size={15} />} onClick={() => (setMenuOpen(false), void setStatus('cancelled'))}>
                    Cancel task
                  </MenuItem>
                ) : null}
                {editable && task.work_status === 'cancelled' ? (
                  <MenuItem icon={<RotateCcw size={15} />} onClick={() => (setMenuOpen(false), void patch({ work_status: 'scheduled' }))}>
                    Restore task
                  </MenuItem>
                ) : null}
                {canDelete(task, me) ? (
                  <MenuItem danger icon={<Trash2 size={15} />} onClick={() => (setMenuOpen(false), void remove())}>
                    Delete permanently
                  </MenuItem>
                ) : null}
                {!editable && !canDelete(task, me) ? <p className="px-3 py-2 text-xs text-stone">View only</p> : null}
              </div>
            </Popover>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close task details" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
        {editable ? (
          <input
            aria-label="Task title"
            className="mt-2 w-full rounded-lg bg-transparent px-1 -mx-1 font-display text-xl font-bold text-ink outline-none hover:bg-canvas focus:bg-white focus:ring-2 focus:ring-ember/15"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              const t = title.trim()
              if (!t) setTitle(task.title)
              else if (t !== task.title) void patch({ title: t })
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h2 className="mt-2 font-display text-xl font-bold text-ink">{task.title}</h2>
        )}
        <p className="mt-1 flex items-center gap-1.5 text-sm text-ash">
          <Clock size={14} className="text-stone" />
          {formatTimeRange(task.start_at, task.end_at, zone)}
          <span className="text-stone">· {formatDuration(minutes)}</span>
        </p>
      </div>

      <div className="space-y-6 px-5 py-5">
        {stale && canWork ? (
          <section className="rounded-2xl border border-st-pending/20 bg-st-pending/[0.05] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-st-pending">
              <AlertCircle size={16} /> Needs update
            </p>
            <p className="mt-0.5 text-xs text-ash">The scheduled time has passed. What happened with this task?</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => void patch({ work_status: 'completed' }, 'Marked completed.')}>
                <CheckCircle2 size={14} /> Mark completed
              </Button>
              {reschedulable ? (
                <Button size="sm" onClick={() => setEditingTime(true)}>
                  <CalendarClock size={14} /> Continue / reschedule
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setPendingOpen(true)}>
                <PauseCircle size={14} /> Mark pending
              </Button>
            </div>
          </section>
        ) : null}

        <ApprovalControls
          task={task}
          me={me}
          zone={zone}
          people={people}
          activities={activities}
          onRespond={respond}
          onUseTime={async (s, e) => {
            await patch({ start_at: s, end_at: e }, 'Time updated — owners will be asked again.')
          }}
          onRemoveOwner={async (uid) => {
            await mutate((v) => setTaskOwners(task.id, v, ownerIds.filter((x) => x !== uid)), 'Owner removed.')
          }}
        />

        {/* When */}
        {editingTime ? (
          <TimeEditor
            task={task}
            zone={zone}
            onCancel={() => setEditingTime(false)}
            onSave={async (s, e) => {
              const ok = await patch({ start_at: s, end_at: e }, 'Rescheduled.')
              if (ok) setEditingTime(false)
            }}
          />
        ) : reschedulable ? (
          <button
            type="button"
            onClick={() => setEditingTime(true)}
            className="flex w-full items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-left text-sm hover:border-stone"
          >
            <CalendarClock size={16} className="text-stone" />
            <span className="flex-1">Change date or time</span>
            <Pencil size={14} className="text-stone" />
          </button>
        ) : null}

        {/* Owners */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="section-title">Owners</h3>
            {editable && !editingOwners ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-semibold text-ember hover:underline"
                onClick={() => {
                  setOwnerDraft(ownerIds)
                  setEditingOwners(true)
                }}
              >
                <UserPlus size={13} /> Assign owners
              </button>
            ) : null}
          </div>
          {editingOwners ? (
            <div className="anim-pop space-y-2">
              <OwnerSelector value={ownerDraft} onChange={setOwnerDraft} people={profiles} meId={me.user_id} />
              <p className="text-[11px] text-stone">New owners must accept before the work counts on their calendar.</p>
              <div className="flex justify-end gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditingOwners(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    const ok = await mutate((v) => setTaskOwners(task.id, v, ownerDraft), 'Owners updated.')
                    if (ok) setEditingOwners(false)
                  }}
                >
                  Save owners
                </Button>
              </div>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {owners.map((a) => {
                const p = people.get(a.user_id)
                return (
                  <li key={a.user_id} className="flex items-center gap-2.5">
                    <Avatar id={a.user_id} name={p?.name ?? '?'} size={26} />
                    <span className={cx('flex-1 truncate text-sm', a.approval_status === 'declined' && 'text-stone line-through')}>
                      {p?.name ?? 'Unknown'}
                      {a.user_id === me.user_id ? <span className="text-stone"> (you)</span> : null}
                    </span>
                    {a.approval_status !== 'accepted' ? <StatusPill status={a.approval_status} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Progress & status */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="section-title">Progress</h3>
            <span className="font-display text-sm font-bold tabular-nums">{task.progress_percent}%</span>
          </div>
          <ProgressControl
            value={task.progress_percent}
            disabled={!canWork || task.work_status === 'cancelled'}
            onCommit={(v) => void patch({ progress_percent: v })}
          />
        </section>

        {canWork && task.work_status !== 'cancelled' ? (
          <section>
            <h3 className="section-title mb-2">Status</h3>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {statusOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={task.work_status === o.value}
                  onClick={() => task.work_status !== o.value && void setStatus(o.value)}
                  className={cx(
                    'rounded-xl border px-2 py-2 text-xs font-semibold transition-colors',
                    task.work_status === o.value
                      ? cx('border-transparent', STATE_CHIP[o.value])
                      : 'border-line bg-white text-ash hover:border-stone hover:text-ink',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {pendingOpen ? (
              <PendingForm
                initial={task.pending_reason}
                onCancel={() => setPendingOpen(false)}
                onSave={async (reason, note) => {
                  const ok = await patch({ work_status: 'pending', pending_reason: formatPendingReason(reason, note), note }, 'Marked pending.')
                  if (ok) setPendingOpen(false)
                }}
              />
            ) : null}
            {task.work_status === 'pending' && task.pending_reason && !pendingOpen ? (
              <div className="mt-2 flex items-start gap-2 rounded-xl bg-st-pending/[0.05] px-3 py-2 text-xs">
                <PauseCircle size={14} className="mt-px shrink-0 text-st-pending" />
                <span className="flex-1 text-ink">{task.pending_reason}</span>
                <button type="button" className="font-semibold text-ember hover:underline" onClick={() => setPendingOpen(true)}>
                  Edit
                </button>
              </div>
            ) : null}
            {task.work_status === 'pending' ? (
              <Button size="sm" variant="soft" className="mt-2" onClick={() => onCreateFollowUp(task)}>
                <CopyPlus size={14} /> Create follow-up on a new date
              </Button>
            ) : null}
          </section>
        ) : task.pending_reason ? (
          <p className="rounded-xl bg-st-pending/[0.05] px-3 py-2 text-xs text-ink">Pending: {task.pending_reason}</p>
        ) : null}

        {/* Details */}
        <section>
          <button
            type="button"
            className="flex w-full items-center justify-between"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((o) => !o)}
          >
            <h3 className="section-title">Details</h3>
            <ChevronDown size={16} className={cx('text-stone transition-transform', detailsOpen && 'rotate-180')} />
          </button>
          {!detailsOpen && task.description ? (
            <p className="mt-2 line-clamp-3 text-sm whitespace-pre-wrap text-ash">{task.description}</p>
          ) : null}
          {detailsOpen ? (
            <DetailsEditor task={task} editable={editable} onSave={(p) => void patch(p)} />
          ) : null}
        </section>

        {/* Custom fields */}
        <section>
          <h3 className="section-title mb-2">Custom fields</h3>
          {fieldsStale ? (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-apricot/40 bg-apricot/10 px-3 py-2 text-xs text-ink">
              <AlertCircle size={14} className="mt-px shrink-0 text-[#9a5a14]" />
              <span className="flex-1">Someone else changed these fields while you were editing. Saving would fail.</span>
              <button type="button" className="font-semibold text-ember hover:underline" onClick={discardFields}>
                Load latest
              </button>
            </div>
          ) : null}
          {task.custom_fields.length === 0 && !editable ? (
            <p className="text-xs text-stone">No custom fields.</p>
          ) : (
            <CustomFieldEditor fields={fieldDraft} onChange={setFieldDraft} people={profiles} disabled={!editable} />
          )}
          {fieldsDirty ? (
            <div className="anim-pop sticky bottom-2 mt-2 flex items-center gap-2 rounded-xl bg-ink px-3 py-2 text-xs text-white shadow-lg">
              <span className="flex-1">{fieldError ?? 'Unsaved field changes'}</span>
              <button type="button" className="font-semibold text-white/70 hover:text-white" onClick={discardFields}>
                Discard
              </button>
              <Button size="sm" variant="primary" className="bg-white! text-ink!" disabled={!!fieldError} onClick={() => void saveFields()}>
                Save fields
              </Button>
            </div>
          ) : null}
        </section>

        {/* Notes & history */}
        <section>
          <BookmarkList
            activities={activities}
            loading={actLoading}
            hasMore={hasMore}
            onLoadMore={() => void loadOlder()}
            people={people}
            zone={zone}
            canAdd={canAddNote(task, me)}
            onAdd={async (note) => {
              try {
                await addBookmark(task.id, note)
                await loadActivities()
                await refreshTask(task.id)
              } catch (e) {
                toast(toApiError(e).message, 'error')
                throw e
              }
            }}
          />
        </section>

        <footer className="space-y-1 border-t border-line pt-4 text-[11px] text-stone">
          {task.parent_task_id ? (
            <button type="button" className="flex items-center gap-1 font-medium text-ember hover:underline" onClick={() => onOpenTask(task.parent_task_id!)}>
              <GitBranch size={12} /> Follow-up of an earlier task — open original
            </button>
          ) : null}
          <p>
            Created by {creator?.name ?? 'Unknown'} · {formatRelative(task.created_at, zone)}
            {requester && requester.user_id !== task.created_by ? ` · Requested by ${requester.name}` : ''}
          </p>
          <p>
            Updated {formatRelative(task.updated_at, zone)}
            {task.completed_at ? ` · Completed ${formatRelative(task.completed_at, zone)}` : ''}
          </p>
        </footer>
      </div>
    </>
  )

  return (
    <>
      {isMobile ? <div className={cx('fixed inset-0 z-30 bg-ink/30', closing ? 'anim-fade-out' : 'anim-fade')} onClick={onClose} /> : null}
      <aside
        role="dialog"
        aria-label={`Task: ${task.title}`}
        className={cx(
          'fixed z-40 overflow-y-auto bg-ivory',
          isMobile ? 'inset-x-0 bottom-0 top-6 rounded-t-3xl' : 'top-0 right-0 bottom-0 w-[440px] border-l border-line',
          closing ? (isMobile ? 'anim-rise-out' : 'anim-slide-out') + ' pointer-events-none' : isMobile ? 'anim-rise' : 'anim-slide',
        )}
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        {isMobile ? <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" aria-hidden /> : null}
        {body}
      </aside>
    </>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-canvas',
        danger ? 'text-st-pending' : 'text-ink',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function TimeEditor({
  task,
  zone,
  onSave,
  onCancel,
}: {
  task: Task
  zone: string
  onSave: (start: string, end: string) => Promise<void>
  onCancel: () => void
}) {
  const s = toLocalInputs(task.start_at, zone)
  const e = toLocalInputs(task.end_at, zone)
  const [sd, setSd] = useState(s.date)
  const [st, setSt] = useState(s.time)
  const [ed, setEd] = useState(e.date)
  const [et, setEt] = useState(e.time)
  const [busy, setBusy] = useState(false)
  const start = fromLocalInputs(sd, st, zone)
  const end = fromLocalInputs(ed, et, zone)
  const invalid = !start || !end || new Date(end) <= new Date(start)
  return (
    <section className="anim-pop rounded-2xl border border-line bg-white p-3">
      <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-2 text-xs text-ash">
        <span>Start</span>
        <input type="date" aria-label="Start date" className="field h-9" value={sd} onChange={(x) => setSd(x.target.value)} />
        <input type="time" aria-label="Start time" className="field h-9 w-[110px]" value={st} onChange={(x) => setSt(x.target.value)} />
        <span>End</span>
        <input type="date" aria-label="End date" className="field h-9" value={ed} onChange={(x) => setEd(x.target.value)} />
        <input type="time" aria-label="End time" className="field h-9 w-[110px]" value={et} onChange={(x) => setEt(x.target.value)} />
      </div>
      {invalid ? <p className="mt-2 text-xs text-st-pending">End time must be later than start time.</p> : null}
      <div className="mt-3 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={invalid}
          onClick={async () => {
            if (!start || !end) return
            setBusy(true)
            try {
              await onSave(start, end)
            } finally {
              setBusy(false)
            }
          }}
        >
          Save time
        </Button>
      </div>
    </section>
  )
}

function PendingForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string | null
  onSave: (reason: string, note: string) => Promise<void>
  onCancel: () => void
}) {
  const parsed = parsePendingReason(initial)
  const [reason, setReason] = useState(parsed.reason)
  const [note, setNote] = useState(parsed.note)
  const [busy, setBusy] = useState(false)
  return (
    <div className="anim-pop mt-2 space-y-2 rounded-2xl border border-st-pending/20 bg-white p-3">
      <label className="label" htmlFor="pending-reason">
        Why is it pending?
      </label>
      <div className="flex flex-wrap gap-1.5" id="pending-reason" role="radiogroup" aria-label="Pending reason">
        {PENDING_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={cx(
              'rounded-full border px-2.5 py-1 text-xs font-medium',
              reason === r ? 'border-st-pending bg-st-pending/10 text-st-pending' : 'border-line text-ash hover:border-stone',
            )}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea
        className="field min-h-[60px]"
        placeholder="Add a short explanation (optional)"
        aria-label="Pending explanation"
        maxLength={400}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="text-[11px] text-stone">Progress is kept as is. The original event stays on the calendar.</p>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onSave(reason, note)
            } finally {
              setBusy(false)
            }
          }}
        >
          Mark pending
        </Button>
      </div>
    </div>
  )
}

function DetailsEditor({ task, editable, onSave }: { task: Task; editable: boolean; onSave: (p: TaskPatch) => void }) {
  const [description, setDescription] = useState(task.description ?? '')
  const [category, setCategory] = useState(task.category ?? '')
  useEffect(() => setDescription(task.description ?? ''), [task.description])
  useEffect(() => setCategory(task.category ?? ''), [task.category])
  const priorityOptions = useMemo(
    () => (['low', 'medium', 'high'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] })),
    [],
  )
  return (
    <div className="anim-pop mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="label mb-0">Priority</span>
        {editable ? (
          <Segmented size="sm" label="Priority" value={task.priority} options={priorityOptions} onChange={(p) => onSave({ priority: p })} />
        ) : (
          <span className="text-sm">{PRIORITY_LABEL[task.priority]}</span>
        )}
      </div>
      <div>
        <label className="label" htmlFor="detail-category">
          Project / category
        </label>
        <input
          id="detail-category"
          className="field h-9"
          disabled={!editable}
          maxLength={80}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          onBlur={() => category.trim() !== (task.category ?? '') && onSave({ category: category.trim() })}
        />
      </div>
      <div>
        <label className="label" htmlFor="detail-description">
          Description
        </label>
        <textarea
          id="detail-description"
          className="field min-h-[90px] resize-y"
          disabled={!editable}
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description.trim() !== (task.description ?? '') && onSave({ description: description.trim() })}
        />
      </div>
    </div>
  )
}
