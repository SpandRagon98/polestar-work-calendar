import { useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Users } from 'lucide-react'
import type { Profile } from '../lib/types'
import { Avatar, Button, cx, useDismiss, usePresence } from './ui/primitives'

interface Props {
  value: string[]
  onChange: (ids: string[]) => void
  people: Profile[]
  meId: string
  label?: string
  /** Render as compact pill button (filters) instead of a form field. */
  variant?: 'field' | 'filter'
  placeholder?: string
  allowEmpty?: boolean
}

/** Multi-select for task owners (and the owner filter). */
export function OwnerSelector({
  value,
  onChange,
  people,
  meId,
  label = 'Owners',
  variant = 'field',
  placeholder = 'Choose owners',
  allowEmpty = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  const panel = usePresence(open)

  const active = useMemo(
    () =>
      people
        .filter((p) => p.active || value.includes(p.user_id))
        .sort((a, b) => (a.user_id === meId ? -1 : b.user_id === meId ? 1 : a.name.localeCompare(b.name))),
    [people, value, meId],
  )
  const filtered = active.filter(
    (p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.email.toLowerCase().includes(q.toLowerCase()),
  )
  const selected = value.map((id) => people.find((p) => p.user_id === id)).filter(Boolean) as Profile[]

  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    if (next.length === 0 && !allowEmpty) return
    onChange(next)
  }

  return (
    <div ref={ref} className="relative">
      {variant === 'field' ? (
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((o) => !o)}
          className="field flex min-h-10 items-center gap-2 text-left"
        >
          {selected.length === 0 ? (
            <span className="flex-1 text-stone">{placeholder}</span>
          ) : (
            <span className="flex flex-1 flex-wrap gap-1.5">
              {selected.map((p) => (
                <span key={p.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-canvas py-0.5 pr-2 pl-0.5 text-xs font-medium">
                  <Avatar id={p.user_id} name={p.name} size={18} />
                  {p.user_id === meId ? 'Me' : p.name}
                </span>
              ))}
            </span>
          )}
          <ChevronDown size={16} className="shrink-0 text-stone" />
        </button>
      ) : (
        <Button
          size="sm"
          variant={value.length ? 'soft' : 'secondary'}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="h-9 rounded-xl"
        >
          <Users size={14} />
          {value.length === 0 ? 'All owners' : value.length === 1 ? selected[0]?.name : `${value.length} owners`}
          <ChevronDown size={14} />
        </Button>
      )}
      {panel.mounted ? (
        <div
          className={cx(
            'mt-2 origin-top rounded-2xl border border-line bg-ivory p-2',
            panel.closing ? 'anim-pop-out pointer-events-none' : 'anim-pop',
            // In forms the list flows inline so scrolling dialogs never clip it.
            variant === 'field' ? 'w-full' : 'absolute z-40 w-72 max-w-[calc(100vw-2rem)]',
          )}
          style={{ boxShadow: variant === 'field' ? 'var(--shadow-card)' : 'var(--shadow-pop)' }}
        >
          <div className="relative mb-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-stone" />
            <input
              autoFocus
              className="field h-9 pl-8"
              placeholder="Search people"
              aria-label="Search people"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <ul role="listbox" aria-multiselectable aria-label={label} className={cx('overflow-y-auto py-1', variant === 'field' ? 'max-h-48' : 'max-h-64')}>
            {filtered.map((p) => {
              const on = value.includes(p.user_id)
              return (
                <li key={p.user_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(p.user_id)}
                    className={cx(
                      'flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-canvas',
                      on && 'bg-peach-50',
                    )}
                  >
                    <Avatar id={p.user_id} name={p.name} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {p.name}
                        {p.user_id === meId ? <span className="font-normal text-stone"> (you)</span> : null}
                      </span>
                      <span className="block truncate text-xs text-stone">
                        {p.role === 'requester' ? 'Requester · ' : ''}
                        {p.email}
                      </span>
                    </span>
                    {on ? <Check size={16} className="text-maroon" /> : null}
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 ? <li className="px-2 py-3 text-center text-xs text-stone">No matches</li> : null}
          </ul>
          {variant === 'field' ? (
            <button type="button" className="w-full rounded-lg py-1.5 text-xs font-semibold text-ash hover:bg-canvas hover:text-ink" onClick={() => setOpen(false)}>
              Done
            </button>
          ) : null}
          {variant === 'filter' && value.length ? (
            <button type="button" className="w-full rounded-lg py-1.5 text-xs font-medium text-ember hover:bg-canvas" onClick={() => onChange([])}>
              Clear owner filter
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
