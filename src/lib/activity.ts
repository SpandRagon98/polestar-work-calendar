import type { Activity, Profile, WorkStatus } from './types'
import { WORK_STATUS_LABEL } from './status'
import { formatTimeRange } from './time'

export const ACTIVITY_LABEL: Record<string, string> = {
  created: 'Created task',
  request_created: 'Sent request',
  follow_up_created: 'Created follow-up',
  rescheduled: 'Rescheduled',
  proposal_updated: 'Updated proposed time',
  status_changed: 'Changed status',
  completed: 'Marked completed',
  progress: 'Updated progress',
  details_changed: 'Edited details',
  custom_fields: 'Edited custom fields',
  owners_changed: 'Changed owners',
  assignment_accepted: 'Accepted assignment',
  assignment_declined: 'Declined assignment',
  time_suggested: 'Suggested another time',
  request_confirmed: 'Request confirmed by all owners',
  request_needs_revision: 'Request needs revision',
  bookmark: 'Progress note',
}

type NameMap = Map<string, Pick<Profile, 'name'>>

const names = (ids: unknown, profiles: NameMap) =>
  (Array.isArray(ids) ? ids : [])
    .map((id) => profiles.get(String(id))?.name ?? 'Unknown')
    .join(', ')

const str = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

/** One-line description of what an activity changed (note excluded). */
export function describeActivity(a: Activity, profiles: NameMap, zone: string): string {
  const m = a.metadata ?? {}
  switch (a.activity_type) {
    case 'rescheduled': {
      const from = m.from as { start_at: string; end_at: string } | undefined
      const to = m.to as { start_at: string; end_at: string } | undefined
      if (!from || !to) return ''
      return `${formatTimeRange(from.start_at, from.end_at, zone)} → ${formatTimeRange(to.start_at, to.end_at, zone)}`
    }
    case 'proposal_updated':
    case 'time_suggested':
      return m.start_at && m.end_at ? formatTimeRange(String(m.start_at), String(m.end_at), zone) : ''
    case 'status_changed':
    case 'completed': {
      const from = WORK_STATUS_LABEL[m.from as WorkStatus] ?? str(m.from)
      const to = WORK_STATUS_LABEL[m.to as WorkStatus] ?? str(m.to)
      const reason = m.pending_reason ? ` (${m.pending_reason})` : ''
      return from === to ? `Reason: ${m.pending_reason ?? '—'}` : `${from} → ${to}${reason}`
    }
    case 'progress':
      return `${str(m.from)}% → ${str(m.to)}%`
    case 'owners_changed': {
      const parts = []
      const added = names(m.added, profiles)
      const removed = names(m.removed, profiles)
      if (added) parts.push(`Added ${added}`)
      if (removed) parts.push(`Removed ${removed}`)
      return parts.join('; ')
    }
    case 'created':
    case 'request_created':
      return m.owners ? `Owners: ${names(m.owners, profiles)}` : ''
    case 'details_changed':
      return Array.isArray(m.fields) ? `Changed ${(m.fields as string[]).join(', ')}` : ''
    case 'custom_fields': {
      const parts: string[] = []
      const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : [])
      if (list(m.added).length) parts.push(`Added ${list(m.added).join(', ')}`)
      if (list(m.removed).length) parts.push(`Removed ${list(m.removed).join(', ')}`)
      const changed = Array.isArray(m.changed) ? (m.changed as Array<Record<string, unknown>>) : []
      for (const c of changed) {
        if (c.from_label && c.from_label !== c.label) parts.push(`Renamed ${c.from_label} → ${c.label}`)
        if (JSON.stringify(c.from) !== JSON.stringify(c.to)) parts.push(`${c.label}: ${str(c.from)} → ${str(c.to)}`)
      }
      return parts.join('; ')
    }
    case 'follow_up_created':
      return m.start_at && m.end_at ? `Follow-up at ${formatTimeRange(String(m.start_at), String(m.end_at), zone)}` : ''
    default:
      return ''
  }
}
