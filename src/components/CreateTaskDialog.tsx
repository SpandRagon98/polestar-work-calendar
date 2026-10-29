import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, ChevronDown, Hourglass, SlidersHorizontal } from 'lucide-react'
import type { CustomField, Priority, Task } from '../lib/types'
import { createTask, fetchOverlapping, toApiError } from '../lib/api'
import { validateFields } from '../lib/customFields'
import { PRIORITY_LABEL } from '../lib/status'
import { durationMinutes, formatDuration, fromLocalInputs, toLocalInputs } from '../lib/time'
import { useApp } from '../context'
import { CustomFieldEditor } from './CustomFieldEditor'
import { OwnerSelector } from './OwnerSelector'
import { useFeedback } from './ui/feedback'
import { Button, Dialog, Segmented, cx } from './ui/primitives'

export interface CreateDraft {
  start: string // ISO
  end: string // ISO
  title?: string
  ownerIds?: string[]
  description?: string
  priority?: Priority
  category?: string
  customFields?: CustomField[]
  parentTask?: Pick<Task, 'id' | 'title'>
}

interface Props {
  draft: CreateDraft | null
  categories: string[]
  onClose: () => void
  onCreated: (id: string) => void
}

export function CreateTaskDialog({ draft, categories, onClose, onCreated }: Props) {
  return draft ? <CreateTaskForm key={draft.start + (draft.parentTask?.id ?? '')} draft={draft} categories={categories} onClose={onClose} onCreated={onCreated} /> : null
}

function CreateTaskForm({ draft, categories, onClose, onCreated }: { draft: CreateDraft } & Omit<Props, 'draft'>) {
  const { me, profiles, people, zone } = useApp()
  const { toast } = useFeedback()
  const s = toLocalInputs(draft.start, zone)
  const e = toLocalInputs(draft.end, zone)
  const [title, setTitle] = useState(draft.title ?? '')
  const [startDate, setStartDate] = useState(s.date)
  const [startTime, setStartTime] = useState(s.time)
  const [endDate, setEndDate] = useState(e.date)
  const [endTime, setEndTime] = useState(e.time)
  const [owners, setOwners] = useState<string[]>(
    draft.ownerIds?.length ? draft.ownerIds : me.role === 'requester' ? [] : [me.user_id],
  )
  const [more, setMore] = useState(Boolean(draft.description || draft.customFields?.length || draft.category))
  const [description, setDescription] = useState(draft.description ?? '')
  const [priority, setPriority] = useState<Priority>(draft.priority ?? 'medium')
  const [category, setCategory] = useState(draft.category ?? '')
  const [fields, setFields] = useState<CustomField[]>(draft.customFields ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Task[]>([])

  const startIso = fromLocalInputs(startDate, startTime, zone)
  const endIso = fromLocalInputs(endDate, endTime, zone)
  const timeInvalid = !startIso || !endIso || new Date(endIso) <= new Date(startIso)
  const others = owners.filter((o) => o !== me.user_id)
  const isRequest = others.length > 0

  // Warn about overlapping confirmed commitments (debounced).
  useEffect(() => {
    if (timeInvalid || owners.length === 0) return setConflicts([])
    const id = setTimeout(() => {
      fetchOverlapping(owners, startIso!, endIso!)
        .then(setConflicts)
        .catch(() => setConflicts([]))
    }, 350)
    return () => clearTimeout(id)
  }, [owners, startIso, endIso, timeInvalid])

  const conflictText = useMemo(() => {
    const byPerson = new Map<string, string[]>()
    for (const t of conflicts) {
      for (const a of t.assignments) {
        if (!owners.includes(a.user_id) || a.approval_status !== 'accepted') continue
        const list = byPerson.get(a.user_id) ?? []
        list.push(t.title)
        byPerson.set(a.user_id, list)
      }
    }
    return [...byPerson].map(([uid, titles]) => `${uid === me.user_id ? 'You' : (people.get(uid)?.name ?? 'Someone')}: ${titles.join(', ')}`)
  }, [conflicts, owners, people, me.user_id])

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!title.trim()) return setError('Give the task a title.')
    if (timeInvalid) return setError('End time must be later than start time.')
    if (owners.length === 0) return setError('Choose at least one owner.')
    const fieldErr = validateFields(fields)
    if (fieldErr) return setError(fieldErr)
    setBusy(true)
    try {
      const id = await createTask({
        title: title.trim(),
        description: description.trim() || undefined,
        start_at: startIso!,
        end_at: endIso!,
        priority,
        category: category.trim() || undefined,
        custom_fields: fields,
        owner_ids: owners,
        parent_task_id: draft.parentTask?.id,
      })
      toast(isRequest ? 'Request sent — owners will be asked to accept.' : 'Task created.')
      onCreated(id)
    } catch (err) {
      setError(toApiError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={draft.parentTask ? 'Create follow-up' : isRequest ? 'New request' : 'New task'}
      description={draft.parentTask ? `Continues “${draft.parentTask.title}”. The original stays on the calendar.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-task" loading={busy}>
            {isRequest ? 'Send request' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="create-task" onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="task-title" className="label">
            Task title
          </label>
          <input
            id="task-title"
            autoFocus
            required
            maxLength={200}
            className="field h-11 text-base"
            placeholder="e.g. Brightspeed data validation"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-2">
          <span className="text-xs font-medium text-ash">Start</span>
          <input type="date" aria-label="Start date" className="field h-10" value={startDate} onChange={(e) => {
            const v = e.target.value
            // Keep the end on the same day when moving a same-day task.
            if (endDate === startDate) setEndDate(v)
            setStartDate(v)
          }} />
          <input type="time" aria-label="Start time" className="field h-10 w-[112px]" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          <span className="text-xs font-medium text-ash">End</span>
          <input type="date" aria-label="End date" className="field h-10" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <input type="time" aria-label="End time" className="field h-10 w-[112px]" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <p className={cx('-mt-2 text-xs', timeInvalid ? 'text-st-pending' : 'text-stone')}>
          {timeInvalid ? 'End time must be later than start time.' : `${formatDuration(durationMinutes(startIso!, endIso!))} · times in ${zone}`}
        </p>

        <div>
          <span className="label">Owners</span>
          <OwnerSelector value={owners} onChange={setOwners} people={profiles} meId={me.user_id} allowEmpty />
          {isRequest ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-st-awaiting">
              <Hourglass size={13} className="mt-px shrink-0" />
              {others.map((o) => people.get(o)?.name ?? 'Someone').join(', ')} will be asked to accept. Until then it shows as tentative.
            </p>
          ) : null}
          {conflictText.length ? (
            <div className="mt-1.5 flex items-start gap-1.5 rounded-xl bg-st-pending/[0.06] px-3 py-2 text-xs text-st-pending">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              <div>
                <p className="font-semibold">Overlaps existing commitments</p>
                {conflictText.map((c) => (
                  <p key={c}>{c}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          className="flex items-center gap-1.5 text-xs font-semibold text-ash hover:text-ink"
        >
          <SlidersHorizontal size={14} /> More options
          <ChevronDown size={14} className={cx('transition-transform', more && 'rotate-180')} />
        </button>

        {more ? (
          <div className="anim-pop space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="label mb-0">Priority</span>
              <Segmented
                size="sm"
                label="Priority"
                value={priority}
                onChange={setPriority}
                options={(['low', 'medium', 'high'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
              />
            </div>
            <div>
              <label htmlFor="task-category" className="label">
                Project / category
              </label>
              <input
                id="task-category"
                list="category-options"
                className="field h-10"
                maxLength={80}
                placeholder="e.g. Brightspeed"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label htmlFor="task-description" className="label">
                Description
              </label>
              <textarea
                id="task-description"
                className="field min-h-[80px] resize-y"
                maxLength={5000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <span className="label">Custom fields</span>
              <CustomFieldEditor fields={fields} onChange={setFields} people={profiles} />
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-xl bg-st-pending/8 px-3 py-2 text-sm text-st-pending">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
