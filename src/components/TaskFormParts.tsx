import { DateTime } from 'luxon'
import { AlertTriangle, CalendarCheck2, Hourglass, Repeat } from 'lucide-react'
import type { Priority } from '../lib/types'
import { REPEAT_LABEL, type RepeatPattern } from '../lib/recurrence'
import { PRIORITY_LABEL } from '../lib/status'
import { formatDuration } from '../lib/time'
import type { TaskForm } from '../hooks/useTaskForm'
import { useApp } from '../context'
import { Collapse, Segmented, cx } from './ui/primitives'

const DURATIONS = [30, 60, 120, 240]

/** Start / end date-time rows, with optional one-tap durations. */
export function TimeFields({ form, durations = false }: { form: TaskForm; durations?: boolean }) {
  const { zone } = useApp()
  return (
    <div>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_7rem] items-center gap-x-2 gap-y-2">
        <span className="text-xs font-medium text-ash">Start</span>
        <input type="date" aria-label="Start date" className="field h-10" value={form.startDate} onChange={(e) => form.setStartDate(e.target.value)} />
        <input type="time" aria-label="Start time" className="field h-10" value={form.startTime} onChange={(e) => form.setStartTime(e.target.value)} />
        <span className="text-xs font-medium text-ash">End</span>
        <input type="date" aria-label="End date" className="field h-10" value={form.endDate} onChange={(e) => form.setEndDate(e.target.value)} />
        <input type="time" aria-label="End time" className="field h-10" value={form.endTime} onChange={(e) => form.setEndTime(e.target.value)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[3.5rem]">
        {durations
          ? DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => form.setDuration(m)}
                aria-pressed={form.minutes === m}
                className={cx(
                  'h-7 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                  form.minutes === m ? 'border-maroon bg-peach-50 text-maroon' : 'border-line bg-white text-ash hover:border-stone hover:text-ink',
                )}
              >
                {formatDuration(m)}
              </button>
            ))
          : null}
        <span className={cx('text-xs', form.timeInvalid ? 'text-st-pending' : 'text-stone', durations && 'ml-1')}>
          {form.timeInvalid ? 'End time must be later than start time.' : `${durations ? '' : `${form.lengthLabel} · `}times in ${zone}`}
        </span>
      </div>
    </div>
  )
}

/** Turn an event into a series: one real event per date, from a start date to an end date. */
export function RepeatFields({ form }: { form: TaskForm }) {
  const fmt = (d: string) => DateTime.fromISO(d).toFormat('ccc d LLL')
  const dates = form.repeatDates
  return (
    <div>
      <button
        type="button"
        aria-pressed={form.repeat}
        onClick={() => form.setRepeat(!form.repeat)}
        className={cx(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors',
          form.repeat ? 'border-maroon bg-peach-50 text-maroon' : 'border-line bg-white text-ash hover:border-stone hover:text-ink',
        )}
      >
        <Repeat size={13} /> Repeat
      </button>
      <Collapse open={form.repeat}>
        <div className="mt-2.5 mb-px space-y-3 rounded-2xl border border-line bg-white p-3.5">
          <Segmented
            size="sm"
            label="Repeat pattern"
            value={form.repeatPattern}
            onChange={form.setRepeatPattern}
            options={(Object.keys(REPEAT_LABEL) as RepeatPattern[]).map((p) => ({ value: p, label: REPEAT_LABEL[p] }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="repeat-start">
                Start date
              </label>
              <input id="repeat-start" type="date" className="field h-10" value={form.startDate} onChange={(e) => form.setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="repeat-end">
                End date
              </label>
              <input
                id="repeat-end"
                type="date"
                className="field h-10"
                min={form.startDate}
                value={form.repeatUntil}
                onChange={(e) => form.setRepeatUntil(e.target.value)}
              />
            </div>
          </div>
          <p className={cx('text-xs leading-relaxed', form.repeatError ? 'text-st-pending' : 'text-stone')}>
            {form.repeatError ?? (dates.length ? `Creates ${dates.length} events: ${fmt(dates[0])} to ${fmt(dates[dates.length - 1])}. Each one can be changed on its own.` : '')}
          </p>
        </div>
      </Collapse>
    </div>
  )
}

export function PriorityField({ form }: { form: TaskForm }) {
  return (
    <Segmented
      size="sm"
      label="Priority"
      value={form.priority}
      onChange={form.setPriority}
      options={(['low', 'medium', 'high'] as Priority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
    />
  )
}

/** Who will be asked to accept, and any clashes with their confirmed work. */
export function OwnerNotes({ form }: { form: TaskForm }) {
  const { people } = useApp()
  return (
    <>
      {form.isRequest ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-st-awaiting">
          <Hourglass size={13} className="mt-0.5 shrink-0" />
          <span>
            {form.others.map((o) => people.get(o)?.name ?? 'Someone').join(', ')}{' '}
            {form.others.length === 1 ? 'needs' : 'need'} to accept before it appears on their calendar.
          </span>
        </p>
      ) : null}
      {form.directAssign ? (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-st-completed">
          <CalendarCheck2 size={13} className="mt-0.5 shrink-0" />
          <span>
            Goes straight onto {form.others.map((o) => people.get(o)?.name ?? 'Someone').join(', ')}’s calendar. As an admin, no acceptance is needed.
          </span>
        </p>
      ) : null}
      {form.conflictText.length ? (
        <div className="mt-2 flex items-start gap-2 rounded-xl bg-st-pending/[0.06] px-3 py-2.5 text-xs text-st-pending">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">Overlaps existing commitments</p>
            {form.conflictText.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-xl bg-st-pending/8 px-3.5 py-2.5 text-sm text-st-pending">
      {message}
    </p>
  )
}
