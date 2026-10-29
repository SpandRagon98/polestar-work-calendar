import type { Workbook, Worksheet } from 'exceljs'
import { DateTime } from 'luxon'
import type { Activity, Profile, Task } from './types'
import { ACTIVITY_LABEL, describeActivity } from './activity'
import { exportValue, displayValue } from './customFields'
import { APPROVAL_STATE_LABEL, ASSIGNMENT_LABEL, PRIORITY_LABEL, WORK_STATUS_LABEL } from './status'
import { daysBetween, durationMinutes, minutesByLocalDay, toZoned } from './time'
import { availableMinutes, isConfirmedFor } from './utilization'

export interface ExportInput {
  tasks: Task[]
  activities: Activity[]
  profiles: Profile[]
  /** Inclusive local dates (yyyy-mm-dd) in `zone`. */
  fromDate: string
  toDate: string
  zone: string
}

/**
 * Spreadsheet apps execute cells that start with = + - @ (and tab/CR) as formulas.
 * Prefix untrusted text with an apostrophe so it is always shown as text.
 */
export function safeText(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

/** Excel has no time zones: store the wall-clock time the user sees in `zone`. */
export function wallClock(iso: string, zone: string): Date {
  const dt = toZoned(iso, zone)
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second))
}

export function exportFileName(fromDate: string, toDate: string): string {
  return fromDate === toDate
    ? `polestar-work-calendar_${fromDate}.xlsx`
    : `polestar-work-calendar_${fromDate}_to_${toDate}.xlsx`
}

const BRAND = 'FF5C0605'

function styleSheet(ws: Worksheet) {
  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } }
  header.alignment = { vertical: 'middle' }
  header.height = 22
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  if (ws.columnCount > 0) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  }
}

export function tasksInRange(tasks: Task[], fromDate: string, toDate: string, zone: string): Task[] {
  const start = DateTime.fromISO(fromDate, { zone }).startOf('day').toMillis()
  const end = DateTime.fromISO(toDate, { zone }).plus({ days: 1 }).startOf('day').toMillis()
  return tasks.filter((t) => new Date(t.start_at).getTime() < end && new Date(t.end_at).getTime() > start)
}

export async function buildWorkbook(input: ExportInput): Promise<Workbook> {
  const ExcelJS = (await import('exceljs')).default
  const { profiles, zone } = input
  const people = new Map(profiles.map((p) => [p.user_id, p]))
  const nameOf = (id: string | null) => (id ? (people.get(id)?.name ?? 'Unknown') : '')
  const tasks = tasksInRange(input.tasks, input.fromDate, input.toDate, zone).sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  )
  const taskIds = new Set(tasks.map((t) => t.id))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'Polestar Work Calendar'
  wb.created = new Date()

  // ── Sheet 1: Tasks ────────────────────────────────────────────────────────
  const fieldLabels: string[] = []
  for (const t of tasks) {
    for (const f of t.custom_fields) if (!fieldLabels.includes(f.label)) fieldLabels.push(f.label)
  }
  const ws1 = wb.addWorksheet('Tasks')
  ws1.columns = [
    { header: 'Task ID', key: 'id', width: 38 },
    { header: 'Task Title', key: 'title', width: 36 },
    { header: 'Date', key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Start Time', key: 'start', width: 11, style: { numFmt: 'hh:mm' } },
    { header: 'End Time', key: 'end', width: 11, style: { numFmt: 'hh:mm' } },
    { header: 'Planned Duration (h)', key: 'duration', width: 12, style: { numFmt: '0.00' } },
    { header: 'Owners', key: 'owners', width: 32 },
    { header: 'Requester', key: 'requester', width: 18 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Approval', key: 'approval', width: 18 },
    { header: 'Progress %', key: 'progress', width: 11, style: { numFmt: '0%' } },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Pending Reason', key: 'pending', width: 28 },
    { header: 'Created At', key: 'created', width: 17, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Completed At', key: 'completed', width: 17, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Custom Fields', key: 'custom', width: 40 },
    ...fieldLabels.map((label, i) => ({ header: safeText(label), key: `cf_${i}`, width: 18 })),
  ]
  for (const t of tasks) {
    const start = toZoned(t.start_at, zone)
    const end = toZoned(t.end_at, zone)
    const row: Record<string, unknown> = {
      id: t.id,
      title: safeText(t.title),
      date: new Date(Date.UTC(start.year, start.month - 1, start.day)),
      start: wallClock(t.start_at, zone),
      end: wallClock(t.end_at, zone),
      duration: durationMinutes(t.start_at, t.end_at) / 60,
      owners: safeText(
        t.assignments
          .map((a) => nameOf(a.user_id) + (a.approval_status === 'accepted' ? '' : ` (${ASSIGNMENT_LABEL[a.approval_status]})`))
          .join(', '),
      ),
      requester: safeText(nameOf(t.requester_id)),
      status: WORK_STATUS_LABEL[t.work_status],
      approval: APPROVAL_STATE_LABEL[t.approval_state],
      progress: t.progress_percent / 100,
      priority: PRIORITY_LABEL[t.priority],
      category: safeText(t.category),
      pending: safeText(t.pending_reason),
      created: wallClock(t.created_at, zone),
      completed: t.completed_at ? wallClock(t.completed_at, zone) : null,
      custom: safeText(t.custom_fields.map((f) => `${f.label}: ${displayValue(f, people)}`).join('; ')),
    }
    for (const f of t.custom_fields) {
      const v = exportValue(f, people)
      row[`cf_${fieldLabels.indexOf(f.label)}`] = typeof v === 'string' ? safeText(v) : v
    }
    const added = ws1.addRow(row)
    if (!start.hasSame(end, 'day')) added.getCell('end').numFmt = 'yyyy-mm-dd hh:mm'
    for (const f of t.custom_fields) {
      if (f.type === 'date') added.getCell(`cf_${fieldLabels.indexOf(f.label)}`).numFmt = 'yyyy-mm-dd'
    }
  }
  styleSheet(ws1)

  // ── Sheet 2: Utilization (each user in their own time zone) ───────────────
  const ws2 = wb.addWorksheet('Utilization')
  ws2.columns = [
    { header: 'Date', key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'User', key: 'user', width: 20 },
    { header: 'Task ID', key: 'id', width: 38 },
    { header: 'Task', key: 'task', width: 36 },
    { header: 'Planned Hours', key: 'planned', width: 13, style: { numFmt: '0.00' } },
    { header: 'Approval Status', key: 'approval', width: 26 },
    { header: 'Available Hours', key: 'available', width: 14, style: { numFmt: '0.00' } },
    { header: 'Utilization %', key: 'util', width: 13, style: { numFmt: '0.0%' } },
  ]
  const dates = daysBetween(input.fromDate, DateTime.fromISO(input.toDate).plus({ days: 1 }).toISODate()!)
  const dateSet = new Set(dates)
  const userIds = [...new Set(tasks.flatMap((t) => t.assignments.map((a) => a.user_id)))].sort((a, b) =>
    nameOf(a).localeCompare(nameOf(b)),
  )
  for (const uid of userIds) {
    const profile = people.get(uid)
    const userZone = profile?.timezone || zone
    for (const date of dates) {
      let confirmedMinutes = 0
      let any = false
      for (const t of tasks) {
        const a = t.assignments.find((x) => x.user_id === uid)
        if (!a) continue
        const minutes = minutesByLocalDay(t.start_at, t.end_at, userZone).get(date)
        if (!minutes || !dateSet.has(date)) continue
        any = true
        const confirmed = isConfirmedFor(t, uid)
        if (confirmed) confirmedMinutes += minutes
        ws2.addRow({
          date: new Date(`${date}T00:00:00Z`),
          user: safeText(nameOf(uid)),
          id: t.id,
          task: safeText(t.title),
          planned: minutes / 60,
          approval: confirmed
            ? 'Confirmed'
            : t.work_status === 'cancelled'
              ? 'Cancelled (not counted)'
              : `${a.approval_status === 'accepted' ? APPROVAL_STATE_LABEL[t.approval_state] : ASSIGNMENT_LABEL[a.approval_status]} (not counted)`,
        })
      }
      if (!any) continue
      const available = profile ? availableMinutes(profile, date) : 0
      const total = ws2.addRow({
        date: new Date(`${date}T00:00:00Z`),
        user: safeText(nameOf(uid)),
        task: 'Daily total (confirmed work)',
        planned: confirmedMinutes / 60,
        approval: confirmedMinutes > available ? 'Over capacity' : '',
        available: available / 60,
        util: available > 0 ? confirmedMinutes / available : null,
      })
      total.font = { bold: true }
      total.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7ECE6' } }
    }
  }
  styleSheet(ws2)

  // ── Sheet 3: Bookmarks and history ────────────────────────────────────────
  const ws3 = wb.addWorksheet('Bookmarks and History')
  ws3.columns = [
    { header: 'Task ID', key: 'id', width: 38 },
    { header: 'Task', key: 'task', width: 36 },
    { header: 'Activity Type', key: 'type', width: 24 },
    { header: 'Author', key: 'author', width: 18 },
    { header: 'Timestamp', key: 'at', width: 17, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
    { header: 'Note / Change Details', key: 'note', width: 70 },
  ]
  const titles = new Map(tasks.map((t) => [t.id, t.title]))
  const history = input.activities
    .filter((a) => taskIds.has(a.task_id))
    .sort((a, b) => a.task_id.localeCompare(b.task_id) || a.created_at.localeCompare(b.created_at))
  for (const a of history) {
    const details = [a.note, describeActivity(a, people, zone)].filter(Boolean).join(' — ')
    ws3.addRow({
      id: a.task_id,
      task: safeText(titles.get(a.task_id)),
      type: ACTIVITY_LABEL[a.activity_type] ?? a.activity_type,
      author: safeText(nameOf(a.actor_id)),
      at: wallClock(a.created_at, zone),
      note: safeText(details),
    })
  }
  styleSheet(ws3)

  return wb
}

export async function downloadWorkbook(wb: Workbook, fileName: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
