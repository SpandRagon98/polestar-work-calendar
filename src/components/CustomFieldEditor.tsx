import { useState } from 'react'
import { ArrowDown, ArrowUp, ExternalLink, Pin, PinOff, Plus, Trash2, X } from 'lucide-react'
import type { CustomField, FieldType, Profile } from '../lib/types'
import {
  FIELD_TYPES,
  MAX_FIELDS,
  MAX_PINNED,
  createField,
  isHttpUrl,
  moveField,
  removeField,
  togglePin,
  updateField,
} from '../lib/customFields'
import { Button, cx } from './ui/primitives'

interface Props {
  fields: CustomField[]
  onChange: (fields: CustomField[]) => void
  people: Profile[]
  disabled?: boolean
}

/**
 * Per-task custom fields stored in tasks.custom_fields (JSONB). A "Person" field
 * is only a reference — it never assigns that person to the task.
 */
export function CustomFieldEditor({ fields, onChange, people, disabled }: Props) {
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [type, setType] = useState<FieldType>('text')
  const pinnedCount = fields.filter((f) => f.pinned).length

  const add = () => {
    if (!label.trim()) return
    onChange([...fields, createField(type, label)])
    setLabel('')
    setType('text')
    setAdding(false)
  }

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={f.id} className="group rounded-xl border border-line bg-white p-2.5">
          <div className="mb-1.5 flex items-center gap-1">
            <input
              aria-label="Field name"
              className="min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-xs font-semibold text-ash outline-none focus:bg-canvas"
              value={f.label}
              disabled={disabled}
              maxLength={60}
              onChange={(e) => onChange(updateField(fields, f.id, { label: e.target.value }))}
            />
            <span className="text-[10px] text-stone">{FIELD_TYPES.find((t) => t.type === f.type)?.label}</span>
            {!disabled ? (
              <div className="flex items-center">
                <IconBtn
                  label={f.pinned ? 'Unpin from calendar' : 'Pin to calendar'}
                  onClick={() => onChange(togglePin(fields, f.id))}
                  disabled={!f.pinned && pinnedCount >= MAX_PINNED}
                  active={f.pinned}
                >
                  {f.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </IconBtn>
                <IconBtn label="Move up" onClick={() => onChange(moveField(fields, f.id, -1))} disabled={i === 0}>
                  <ArrowUp size={13} />
                </IconBtn>
                <IconBtn label="Move down" onClick={() => onChange(moveField(fields, f.id, 1))} disabled={i === fields.length - 1}>
                  <ArrowDown size={13} />
                </IconBtn>
                <IconBtn label={`Remove ${f.label}`} onClick={() => onChange(removeField(fields, f.id))}>
                  <Trash2 size={13} />
                </IconBtn>
              </div>
            ) : null}
          </div>
          <FieldInput field={f} people={people} disabled={disabled} onChange={(patch) => onChange(updateField(fields, f.id, patch))} />
        </div>
      ))}

      {adding ? (
        <div className="anim-pop rounded-xl border border-dashed border-line-strong bg-white p-2.5">
          <div className="flex gap-2">
            <input
              autoFocus
              aria-label="New field name"
              placeholder="Field name, e.g. Blocked by"
              className="field h-9 flex-1"
              maxLength={60}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
                if (e.key === 'Escape') setAdding(false)
              }}
            />
            <select aria-label="Field type" className="field h-9 w-32" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
              {FIELD_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={add} disabled={!label.trim()}>
              Add field
            </Button>
          </div>
        </div>
      ) : !disabled && fields.length < MAX_FIELDS ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong py-2 text-xs font-semibold text-ash transition-colors hover:border-maroon/40 hover:bg-peach-50 hover:text-maroon"
        >
          <Plus size={14} /> Add field
        </button>
      ) : null}
      {fields.length > 0 && !disabled ? (
        <p className="text-[11px] text-stone">
          Pin up to {MAX_PINNED} fields to show them on the calendar. Person fields are references only — use Owners to assign work.
        </p>
      ) : null}
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'rounded-md p-1 transition-colors hover:bg-canvas hover:text-ink disabled:opacity-30',
        active ? 'text-maroon' : 'text-stone',
      )}
    >
      {children}
    </button>
  )
}

function FieldInput({
  field,
  people,
  disabled,
  onChange,
}: {
  field: CustomField
  people: Profile[]
  disabled?: boolean
  onChange: (patch: Partial<CustomField>) => void
}) {
  const common = { disabled, 'aria-label': field.label, className: 'field h-9' }
  switch (field.type) {
    case 'long_text':
      return (
        <textarea
          {...common}
          className="field min-h-[72px] resize-y"
          maxLength={4000}
          value={field.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      )
    case 'number':
      return <input {...common} type="number" inputMode="decimal" value={field.value} onChange={(e) => onChange({ value: e.target.value })} />
    case 'date':
      return <input {...common} type="date" value={field.value} onChange={(e) => onChange({ value: e.target.value })} />
    case 'checkbox':
      return (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={disabled}
            className="h-4 w-4 accent-maroon"
            checked={field.value === 'true'}
            onChange={(e) => onChange({ value: e.target.checked ? 'true' : 'false' })}
          />
          {field.value === 'true' ? 'Yes' : 'No'}
        </label>
      )
    case 'url':
      return (
        <div className="flex gap-1.5">
          <input
            {...common}
            type="url"
            placeholder="https://"
            value={field.value}
            onChange={(e) => onChange({ value: e.target.value })}
          />
          {isHttpUrl(field.value) ? (
            <a
              href={field.value}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open link"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line text-ash hover:text-ink"
            >
              <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      )
    case 'person':
      return (
        <select {...common} value={field.value} onChange={(e) => onChange({ value: e.target.value })}>
          <option value="">— Select person —</option>
          {people
            .filter((p) => p.active || p.user_id === field.value)
            .map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.name}
              </option>
            ))}
        </select>
      )
    case 'dropdown':
      return <DropdownInput field={field} disabled={disabled} onChange={onChange} />
    default:
      return <input {...common} maxLength={500} value={field.value} onChange={(e) => onChange({ value: e.target.value })} />
  }
}

function DropdownInput({
  field,
  disabled,
  onChange,
}: {
  field: CustomField
  disabled?: boolean
  onChange: (patch: Partial<CustomField>) => void
}) {
  const [newChoice, setNewChoice] = useState('')
  const choices = field.options?.choices ?? []
  const addChoice = () => {
    const c = newChoice.trim()
    if (!c || choices.includes(c)) return
    onChange({ options: { choices: [...choices, c] }, value: field.value || c })
    setNewChoice('')
  }
  return (
    <div className="space-y-1.5">
      <select
        disabled={disabled || choices.length === 0}
        aria-label={field.label}
        className="field h-9"
        value={field.value}
        onChange={(e) => onChange({ value: e.target.value })}
      >
        <option value="">{choices.length ? '— Select —' : 'Add options below'}</option>
        {choices.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      {!disabled ? (
        <div className="flex flex-wrap items-center gap-1">
          {choices.map((c) => (
            <span key={c} className="inline-flex items-center gap-0.5 rounded-full bg-canvas py-0.5 pr-1 pl-2 text-[11px]">
              {c}
              <button
                type="button"
                aria-label={`Remove option ${c}`}
                className="rounded-full p-0.5 text-stone hover:text-ink"
                onClick={() =>
                  onChange({ options: { choices: choices.filter((x) => x !== c) }, value: field.value === c ? '' : field.value })
                }
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <input
            aria-label="New option"
            placeholder="+ option"
            className="h-6 w-24 rounded-full border border-dashed border-line-strong bg-transparent px-2 text-[11px] outline-none focus:border-ember"
            value={newChoice}
            maxLength={60}
            onChange={(e) => setNewChoice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addChoice()
              }
            }}
            onBlur={addChoice}
          />
        </div>
      ) : null}
    </div>
  )
}
