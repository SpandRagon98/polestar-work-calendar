import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { progressColor } from '../lib/status'
import { cx } from './ui/primitives'

interface Props {
  value: number
  disabled?: boolean
  onCommit: (value: number) => void
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Manual progress: slider, typed percentage, or one-tap increments. */
export function ProgressControl({ value, disabled, onCommit }: Props) {
  const [draft, setDraft] = useState(value)
  const [text, setText] = useState(String(value))
  useEffect(() => {
    setDraft(value)
    setText(String(value))
  }, [value])

  const commit = (n: number) => {
    const v = clamp(n)
    setDraft(v)
    setText(String(v))
    if (v !== value) onCommit(v)
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          aria-label="Progress"
          disabled={disabled}
          value={draft}
          className="pw-range flex-1"
          style={{ '--pct': `${draft}%`, '--fill': progressColor(draft) } as React.CSSProperties}
          onChange={(e) => {
            setDraft(Number(e.target.value))
            setText(e.target.value)
          }}
          onPointerUp={() => commit(draft)}
          onKeyUp={(e) => (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') && commit(draft)}
        />
        <div className="relative w-[78px]">
          <input
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            aria-label="Progress percentage"
            disabled={disabled}
            className="field h-9 pr-6 text-right tabular-nums"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(Number(text) || 0)}
            onKeyDown={(e) => e.key === 'Enter' && commit(Number(text) || 0)}
          />
          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-stone">%</span>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {[-10, 10, 25].map((d) => (
          <button
            key={d}
            type="button"
            disabled={disabled || (d < 0 ? value === 0 : value === 100)}
            onClick={() => commit(value + d)}
            className={cx(
              'inline-flex h-7 items-center gap-0.5 rounded-lg border border-line bg-white px-2 text-xs font-medium text-ash',
              'hover:border-stone hover:text-ink disabled:opacity-40',
            )}
          >
            {d < 0 ? <Minus size={12} /> : <Plus size={12} />}
            {Math.abs(d)}%
          </button>
        ))}
        {[50, 75].map((v) => (
          <button
            key={v}
            type="button"
            disabled={disabled || value === v}
            onClick={() => commit(v)}
            className="h-7 rounded-lg border border-line bg-white px-2 text-xs font-medium text-ash hover:border-stone hover:text-ink disabled:opacity-40"
          >
            {v}%
          </button>
        ))}
      </div>
    </div>
  )
}
