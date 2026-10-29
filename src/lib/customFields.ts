import { DateTime } from 'luxon'
import type { CustomField, FieldType, Profile } from './types'

export const FIELD_TYPES: { type: FieldType; label: string }[] = [
  { type: 'text', label: 'Short text' },
  { type: 'long_text', label: 'Long text' },
  { type: 'number', label: 'Number' },
  { type: 'date', label: 'Date' },
  { type: 'dropdown', label: 'Dropdown' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'url', label: 'URL' },
  { type: 'person', label: 'Person' },
]

export const MAX_FIELDS = 30
export const MAX_PINNED = 2
export const MAX_LABEL = 60
export const MAX_VALUE = 4000

export function newFieldId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createField(type: FieldType, label: string): CustomField {
  return {
    id: newFieldId(),
    label: label.trim(),
    type,
    value: type === 'checkbox' ? 'false' : '',
    ...(type === 'dropdown' ? { options: { choices: [] } } : {}),
  }
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Mirrors the database CHECK so problems show up before saving. Returns an error or null. */
export function validateFields(fields: CustomField[]): string | null {
  if (fields.length > MAX_FIELDS) return `A task can have at most ${MAX_FIELDS} custom fields.`
  if (fields.filter((f) => f.pinned).length > MAX_PINNED) return `Pin at most ${MAX_PINNED} fields to the calendar.`
  const labels = new Set<string>()
  for (const f of fields) {
    const label = f.label.trim()
    if (!label) return 'Every field needs a name.'
    if (label.length > MAX_LABEL) return `Field names must be ${MAX_LABEL} characters or fewer.`
    const key = label.toLowerCase()
    if (labels.has(key)) return `Two fields are called “${label}”.`
    labels.add(key)
    if (f.value.length > MAX_VALUE) return `“${label}” is too long.`
    if (f.type === 'number' && f.value.trim() && !Number.isFinite(Number(f.value))) return `“${label}” must be a number.`
    if (f.type === 'url' && f.value.trim() && !isHttpUrl(f.value.trim()))
      return `“${label}” must be a link starting with http:// or https://`
    if (f.type === 'date' && f.value && !/^\d{4}-\d{2}-\d{2}$/.test(f.value)) return `“${label}” must be a date.`
  }
  if (JSON.stringify(fields).length > 19000) return 'Custom fields are too large.'
  return null
}

export function moveField(fields: CustomField[], id: string, delta: -1 | 1): CustomField[] {
  const i = fields.findIndex((f) => f.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= fields.length) return fields
  const next = [...fields]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** Toggle a field's calendar pin; refuses a third pin. */
export function togglePin(fields: CustomField[], id: string): CustomField[] {
  const target = fields.find((f) => f.id === id)
  if (!target) return fields
  if (!target.pinned && fields.filter((f) => f.pinned).length >= MAX_PINNED) return fields
  return fields.map((f) => (f.id === id ? { ...f, pinned: !f.pinned } : f))
}

export function updateField(fields: CustomField[], id: string, patch: Partial<CustomField>): CustomField[] {
  return fields.map((f) => (f.id === id ? { ...f, ...patch } : f))
}

export function removeField(fields: CustomField[], id: string): CustomField[] {
  return fields.filter((f) => f.id !== id)
}

/** Human-readable value, used on events, in the drawer and in exports. */
export function displayValue(field: CustomField, profiles?: Map<string, Pick<Profile, 'name'>>): string {
  switch (field.type) {
    case 'checkbox':
      return field.value === 'true' ? 'Yes' : 'No'
    case 'person':
      return field.value ? (profiles?.get(field.value)?.name ?? 'Unknown person') : ''
    case 'date': {
      const d = DateTime.fromISO(field.value)
      return field.value && d.isValid ? d.toFormat('d LLL yyyy') : field.value
    }
    default:
      return field.value
  }
}

/** Values typed for spreadsheets: numbers as numbers, dates as dates. */
export function exportValue(
  field: CustomField,
  profiles?: Map<string, Pick<Profile, 'name'>>,
): string | number | boolean | Date | null {
  if (!field.value && field.type !== 'checkbox') return null
  switch (field.type) {
    case 'number': {
      const n = Number(field.value)
      return Number.isFinite(n) ? n : field.value
    }
    case 'checkbox':
      return field.value === 'true'
    case 'date': {
      const d = new Date(`${field.value}T00:00:00Z`)
      return Number.isNaN(d.getTime()) ? field.value : d
    }
    default:
      return displayValue(field, profiles)
  }
}
