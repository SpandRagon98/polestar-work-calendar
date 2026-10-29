import { useMemo, useRef, useState } from 'react'
import { DateTime } from 'luxon'
import { AlertTriangle, Gauge } from 'lucide-react'
import type { Profile, Task } from '../lib/types'
import { computeUtilization, utilizationLevel, type Utilization } from '../lib/utilization'
import { formatHours } from '../lib/time'
import { Avatar, cx, useDismiss, usePresence } from './ui/primitives'

const LEVEL_STYLE = {
  idle: 'text-ash',
  healthy: 'text-st-completed',
  high: 'text-[#9a5a14]',
  over: 'text-ember',
} as const

const BAR_STYLE = {
  idle: 'bg-line-strong',
  healthy: 'bg-st-completed',
  high: 'bg-apricot',
  over: 'bg-ember',
} as const

export function pctLabel(p: number | null): string {
  if (p === null) return '—'
  if (!Number.isFinite(p)) return 'Over'
  return `${Math.round(p)}%`
}

interface Props {
  tasks: Task[]
  focus: Profile
  team: Profile[]
  dates: string[]
  showTeam: boolean
  compact?: boolean
}

/** Planned (scheduled, confirmed) effort vs. capacity for the visible days. */
export function UtilizationIndicator({ tasks, focus, team, dates, showTeam, compact }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  const panel = usePresence(open)

  const u = useMemo(() => computeUtilization(tasks, focus, dates), [tasks, focus, dates])
  const teamRows = useMemo(
    () =>
      showTeam
        ? team
            .filter((p) => p.active && p.role !== 'requester')
            .map((p) => ({ p, u: computeUtilization(tasks, p, dates) }))
            .sort((a, b) => (b.u.percent ?? 0) - (a.u.percent ?? 0))
        : [],
    [tasks, team, dates, showTeam],
  )
  const level = utilizationLevel(u.percent)
  const warn = u.overCapacityDays.length > 0 || u.conflicts.length > 0

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Utilization ${pctLabel(u.percent)}: ${formatHours(u.plannedMinutes)} planned of ${formatHours(u.availableMinutes)} available`}
        className="flex h-10 items-center gap-2.5 rounded-xl border border-line bg-white px-3 text-left hover:border-stone"
      >
        <Gauge size={16} className={LEVEL_STYLE[level]} />
        <span className="leading-tight">
          <span className={cx('block font-display text-sm font-bold tabular-nums', LEVEL_STYLE[level])}>{pctLabel(u.percent)}</span>
          {!compact ? (
            <span className="block text-[10.5px] text-stone tabular-nums">
              {formatHours(u.plannedMinutes)} / {formatHours(u.availableMinutes)}
            </span>
          ) : null}
        </span>
        {warn ? <AlertTriangle size={14} className="text-ember" aria-label="Capacity warning" /> : null}
      </button>
      {panel.mounted ? (
        <div
          className={cx(
            'absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] origin-top-right rounded-2xl border border-line bg-ivory p-4',
            panel.closing ? 'anim-pop-out pointer-events-none' : 'anim-pop',
          )}
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <p className="section-title">Utilization · {focus.name}</p>
          <p className="mt-1 text-xs text-ash">
            Confirmed scheduled work ÷ available hours. Tentative requests don’t count. This is planned effort, not time tracked.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Planned" value={formatHours(u.plannedMinutes)} />
            <Stat label="Available" value={formatHours(u.availableMinutes)} />
            <Stat label="Utilization" value={pctLabel(u.percent)} tone={LEVEL_STYLE[level]} />
          </div>
          <DayBars u={u} />
          {u.overCapacityDays.length ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-ember/[0.06] px-3 py-2 text-xs text-ember">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              Over capacity on {u.overCapacityDays.map((d) => DateTime.fromISO(d).toFormat('ccc d')).join(', ')}.
            </p>
          ) : null}
          {u.conflicts.length ? (
            <div className="mt-2 rounded-xl bg-st-pending/[0.06] px-3 py-2 text-xs text-st-pending">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={13} /> {u.conflicts.length} scheduling conflict{u.conflicts.length > 1 ? 's' : ''}
              </p>
              {u.conflicts.slice(0, 4).map(([a, b]) => (
                <p key={a.id + b.id} className="mt-0.5 truncate">
                  “{a.title}” overlaps “{b.title}”
                </p>
              ))}
            </div>
          ) : null}
          {teamRows.length ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="section-title mb-2">Team</p>
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {teamRows.map(({ p, u: tu }) => {
                  const lv = utilizationLevel(tu.percent)
                  const width = Math.min(100, Number.isFinite(tu.percent ?? 0) ? (tu.percent ?? 0) : 100)
                  return (
                    <li key={p.user_id} className="flex items-center gap-2 text-xs">
                      <Avatar id={p.user_id} name={p.name} size={20} />
                      <span className="w-20 truncate">{p.name}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                        <span className={cx('block h-full rounded-full', BAR_STYLE[lv])} style={{ width: `${width}%` }} />
                      </span>
                      <span className={cx('w-10 text-right font-semibold tabular-nums', LEVEL_STYLE[lv])}>{pctLabel(tu.percent)}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-canvas px-2 py-2">
      <p className={cx('font-display text-base font-bold tabular-nums', tone)}>{value}</p>
      <p className="text-[10.5px] text-stone">{label}</p>
    </div>
  )
}

function DayBars({ u }: { u: Utilization }) {
  if (u.days.length <= 1) return null
  const max = Math.max(...u.days.map((d) => Math.max(d.plannedMinutes, d.availableMinutes)), 60)
  return (
    <div className="mt-3 flex h-20 items-end gap-1.5" aria-hidden>
      {u.days.map((d) => {
        const lv = utilizationLevel(d.percent)
        return (
          <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
            <div className="relative flex h-14 w-full items-end justify-center rounded-md bg-canvas">
              {d.availableMinutes > 0 ? (
                <div className="absolute inset-x-0 border-t border-dashed border-stone/50" style={{ bottom: `${(d.availableMinutes / max) * 100}%` }} />
              ) : null}
              <div className={cx('w-3/5 rounded-t-sm', BAR_STYLE[lv])} style={{ height: `${(d.plannedMinutes / max) * 100}%` }} />
            </div>
            <span className="text-[9.5px] text-stone">{DateTime.fromISO(d.date).toFormat('ccccc')}</span>
          </div>
        )
      })}
    </div>
  )
}
