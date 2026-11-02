import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cx } from './ui/primitives'

export const MAX_POINTS = 50
const MAX_LENGTH = 300

interface Props {
  value: string[]
  /** Called with the whole list after each add, edit or removal. */
  onChange: (next: string[]) => void
  disabled?: boolean
  placeholder?: string
}

/**
 * A bullet list edited in place: type and press Enter to add a point, click a point
 * to change it, clear it (or press ×) to remove it.
 */
export function PointsEditor({ value, onChange, disabled, placeholder = 'Add a point…' }: Props) {
  // Shown straight away, then replaced by what was saved.
  const [items, setItems] = useState(value)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const key = JSON.stringify(value)
  useEffect(() => setItems(JSON.parse(key) as string[]), [key])

  const commit = (next: string[]) => {
    const clean = next.map((p) => p.trim()).filter(Boolean)
    setItems(clean)
    if (JSON.stringify(clean) !== JSON.stringify(value)) onChange(clean)
  }

  const add = () => {
    const text = draft.trim()
    if (!text || items.length >= MAX_POINTS) return
    commit([...items, text])
    setDraft('')
  }

  return (
    <div className="space-y-0.5">
      {items.length ? (
        <ul className="space-y-0.5">
          {items.map((p, i) => (
            // Keyed by text (and which copy of it), so removing one point doesn't replay the others.
            <li key={`${p}#${items.slice(0, i).filter((x) => x === p).length}`} className="anim-item group flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-canvas/70">
              <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-maroon" aria-hidden />
              {editing === i && !disabled ? (
                <input
                  autoFocus
                  aria-label={`Point ${i + 1}`}
                  maxLength={MAX_LENGTH}
                  defaultValue={p}
                  className="min-w-0 flex-1 rounded-md bg-surface px-1.5 py-1 text-sm text-ink ring-2 ring-ember/15 outline-none"
                  onBlur={(e) => {
                    setEditing(null)
                    commit(items.map((x, j) => (j === i ? e.target.value : x)))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') {
                      e.preventDefault()
                      ;(e.target as HTMLInputElement).value = p
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setEditing(i)}
                  className="min-w-0 flex-1 cursor-text py-1 text-left text-sm leading-snug break-words text-ink disabled:cursor-default"
                >
                  {p}
                </button>
              )}
              {!disabled ? (
                <button
                  type="button"
                  aria-label={`Remove point ${i + 1}`}
                  onClick={() => commit(items.filter((_, j) => j !== i))}
                  className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface hover:text-ink focus-visible:opacity-100"
                >
                  <X size={13} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : disabled ? (
        <p className="text-xs text-stone">No points yet.</p>
      ) : null}
      {!disabled && items.length < MAX_POINTS ? (
        <div className="flex items-center gap-2 px-1">
          <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', draft ? 'bg-maroon' : 'bg-line-strong')} aria-hidden />
          <input
            ref={addRef}
            aria-label="New point"
            maxLength={MAX_LENGTH}
            value={draft}
            placeholder={placeholder}
            className="h-8 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-stone outline-none"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
            onBlur={add}
          />
        </div>
      ) : null}
    </div>
  )
}
