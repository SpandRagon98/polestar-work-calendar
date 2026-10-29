import { AlertCircle, Bookmark, Flag, Hourglass } from 'lucide-react'
import type { Profile, Task } from '../lib/types'
import { displayState, needsUpdate, progressColor, initials, avatarColor, STATE_LABEL } from '../lib/status'
import { displayValue } from '../lib/customFields'
import { toZoned } from '../lib/time'

interface Props {
  task: Task
  meId: string
  zone: string
  people: Map<string, Profile>
  now: Date
}

/** The visual body of one task on the time grid. */
export function EventContent({ task, meId, zone, people, now }: Props) {
  const state = displayState(task, meId)
  const stale = needsUpdate(task, now)
  const owners = task.assignments.filter((a) => a.approval_status !== 'declined')
  const pinned = task.custom_fields.filter((f) => f.pinned).slice(0, 2)
  const minutes = (new Date(task.end_at).getTime() - new Date(task.start_at).getTime()) / 60000
  const compact = minutes <= 45
  const start = toZoned(task.start_at, zone)
  const end = toZoned(task.end_at, zone)
  const time = `${start.toFormat(start.minute ? 'h:mm' : 'h')}–${end.toFormat(end.minute ? 'h:mm a' : 'h a')}`

  return (
    <div className={`pw-event-body pw-st-${state} relative flex flex-col overflow-hidden px-1.5 pt-1 pb-2`}>
      <div className="flex min-w-0 items-start gap-1">
        {state === 'awaiting' || state === 'needs_revision' ? (
          <Hourglass size={11} className="mt-[2px] shrink-0 text-st-awaiting" aria-hidden />
        ) : null}
        <span className="pw-event-title min-w-0 flex-1 truncate text-[12px] leading-tight font-semibold">
          {task.title}
        </span>
        {stale ? <AlertCircle size={12} className="mt-px shrink-0 text-st-pending" aria-label="Needs update" /> : null}
        {task.priority === 'high' ? <Flag size={11} className="mt-[2px] shrink-0 text-ember" aria-label="High priority" /> : null}
      </div>
      {!compact ? (
        <div className="truncate text-[10.5px] leading-snug text-ash">
          {time}
          {state !== 'scheduled' ? <span className="font-medium"> · {STATE_LABEL[state]}</span> : null}
        </div>
      ) : null}
      {!compact && minutes >= 75
        ? pinned.map((f) => (
            <div key={f.id} className="truncate text-[10.5px] leading-snug">
              <span className="text-stone">{f.label}:</span> <span className="font-medium">{displayValue(f, people) || '—'}</span>
            </div>
          ))
        : null}
      {!compact ? (
        <div className="mt-auto flex items-center gap-1 pt-0.5">
          <div className="flex -space-x-1">
            {owners.slice(0, 3).map((a) => {
              const name = people.get(a.user_id)?.name ?? '?'
              return (
                <span
                  key={a.user_id}
                  title={name}
                  className="inline-flex h-[17px] w-[17px] items-center justify-center rounded-full text-[8px] font-bold text-white ring-[1.5px] ring-white"
                  style={{ background: avatarColor(a.user_id), opacity: a.approval_status === 'accepted' ? 1 : 0.55 }}
                >
                  {initials(name)}
                </span>
              )
            })}
            {owners.length > 3 ? (
              <span className="inline-flex h-[17px] items-center rounded-full bg-white px-1 text-[8px] font-bold text-ash ring-[1.5px] ring-white">
                +{owners.length - 3}
              </span>
            ) : null}
          </div>
          <span className="flex-1" />
          {task.bookmark_count > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-ash" title={`${task.bookmark_count} progress notes`}>
              <Bookmark size={10} className="fill-current" />
              {task.bookmark_count}
            </span>
          ) : null}
          <span className="text-[10px] font-semibold text-ash tabular-nums">{task.progress_percent}%</span>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/5" aria-hidden>
        <div
          className="h-full origin-left transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${task.progress_percent / 100})`, background: progressColor(task.progress_percent) }}
        />
      </div>
    </div>
  )
}
