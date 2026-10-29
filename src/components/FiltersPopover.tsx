import { useState } from 'react'
import { Filter } from 'lucide-react'
import type { Priority } from '../lib/types'
import { PRIORITY_LABEL, STATE_LABEL, type DisplayState } from '../lib/status'
import { Button, Popover, cx } from './ui/primitives'

export interface Filters {
  states: DisplayState[]
  categories: string[]
  priorities: Priority[]
}

export const EMPTY_FILTERS: Filters = { states: [], categories: [], priorities: [] }

export function filterCount(f: Filters): number {
  return f.states.length + f.categories.length + f.priorities.length
}

const STATES: DisplayState[] = ['scheduled', 'in_progress', 'pending', 'completed', 'awaiting', 'needs_revision', 'cancelled']
const DOT: Record<DisplayState, string> = {
  scheduled: 'bg-st-scheduled',
  in_progress: 'bg-st-progress',
  pending: 'bg-st-pending',
  completed: 'bg-st-completed',
  awaiting: 'bg-st-awaiting',
  needs_revision: 'bg-st-awaiting',
  cancelled: 'bg-line-strong',
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

export function FiltersPopover({ value, onChange, categories }: { value: Filters; onChange: (f: Filters) => void; categories: string[] }) {
  const [open, setOpen] = useState(false)
  const n = filterCount(value)
  return (
    <div className="relative">
      <Button size="sm" variant={n ? 'soft' : 'secondary'} className="h-9 rounded-xl" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Filter size={14} /> Filters{n ? ` · ${n}` : ''}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} className="w-72 p-4">
        <p className="section-title mb-2">Status</p>
        <div className="flex flex-wrap gap-1.5">
          {STATES.map((s) => (
            <Chip key={s} on={value.states.includes(s)} onClick={() => onChange({ ...value, states: toggle(value.states, s) })}>
              <span className={cx('h-2 w-2 rounded-full', DOT[s])} />
              {STATE_LABEL[s]}
            </Chip>
          ))}
        </div>
        <p className="section-title mt-4 mb-2">Priority</p>
        <div className="flex flex-wrap gap-1.5">
          {(['high', 'medium', 'low'] as Priority[]).map((p) => (
            <Chip key={p} on={value.priorities.includes(p)} onClick={() => onChange({ ...value, priorities: toggle(value.priorities, p) })}>
              {PRIORITY_LABEL[p]}
            </Chip>
          ))}
        </div>
        <p className="section-title mt-4 mb-2">Project / category</p>
        {categories.length ? (
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {categories.map((c) => (
              <Chip key={c} on={value.categories.includes(c)} onClick={() => onChange({ ...value, categories: toggle(value.categories, c) })}>
                {c}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone">No categories in view.</p>
        )}
        {n ? (
          <button type="button" className="mt-4 w-full rounded-lg py-1.5 text-xs font-semibold text-ember hover:bg-canvas" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear all filters
          </button>
        ) : null}
      </Popover>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        on ? 'border-maroon bg-peach-50 text-maroon' : 'border-line bg-white text-ash hover:border-stone',
      )}
    >
      {children}
    </button>
  )
}
