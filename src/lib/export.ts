import type { Workbook, Worksheet } from 'exceljs'
import { DateTime } from 'luxon'
import type { Activity, Profile, Task, WorkStatus } from './types'
import { ACTIVITY_LABEL, describeActivity } from './activity'
import { exportValue, displayValue } from './customFields'
import { APPROVAL_STATE_LABEL, ASSIGNMENT_LABEL, PRIORITY_LABEL, WORK_STATUS_LABEL } from './status'
import { daysBetween, minutesByLocalDay, scheduledMinutes, taskSessions, toZoned } from './time'
import { availableMinutes, isConfirmedFor, plannedByDay } from './utilization'

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

/** Tasks on the calendar between two dates (tickets nobody has given a time yet are left out). */
export function tasksInRange(tasks: Task[], fromDate: string, toDate: string, zone: string): Task[] {
  const start = DateTime.fromISO(fromDate, { zone }).startOf('day').toMillis()
  const end = DateTime.fromISO(toDate, { zone }).plus({ days: 1 }).startOf('day').toMillis()
  return tasks.filter((t) => !t.unscheduled && new Date(t.start_at).getTime() < end && new Date(t.end_at).getTime() > start)
}

// ── Gantt chart ──────────────────────────────────────────────────────────────

/** Bar colour, a light tint for the status cell, and readable text on the tint. */
export const GANTT_STATUS: Record<WorkStatus, { label: string; bar: string; tint: string; text: string }> = {
  completed: { label: 'Completed', bar: 'FF3DA35D', tint: 'FFDFF2E5', text: 'FF1E6B3A' },
  in_progress: { label: 'In progress', bar: 'FFF5C342', tint: 'FFFDF3D3', text: 'FF7A5600' },
  pending: { label: 'Pending', bar: 'FFF0983A', tint: 'FFFDE6CC', text: 'FF8F4A00' },
  scheduled: { label: 'Not started', bar: 'FFB9B4AE', tint: 'FFEFEDEA', text: 'FF57524F' },
  cancelled: { label: 'Cancelled', bar: 'FFE2DFDB', tint: 'FFF4F2F0', text: 'FF8E8984' },
}

/** Events have no progress, so they get one colour of their own (unless cancelled). */
export const GANTT_EVENT = { label: 'Event', bar: 'FF5B8DEF', tint: 'FFE3ECFC', text: 'FF1F4FA8' }
const ganttStyle = (t: Task) => (t.kind === 'event' && t.work_status !== 'cancelled' ? GANTT_EVENT : GANTT_STATUS[t.work_status])

const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
const thin = (argb: string) => ({ style: 'thin' as const, color: { argb } })

interface Slot {
  start: number
  end: number
  /** Header line above (month, or the day when the columns are hours). */
  group: string
  label: string
  weekend: boolean
  today: boolean
}

/** Day columns, or hour columns when the range is one or two days. */
export function ganttSlots(tasks: Task[], fromDate: string, toDate: string, zone: string, now = DateTime.now()): Slot[] {
  const first = DateTime.fromISO(fromDate, { zone }).startOf('day')
  const days = daysBetween(fromDate, DateTime.fromISO(toDate).plus({ days: 1 }).toISODate()!).map((d) => DateTime.fromISO(d, { zone }))
  const todayIso = now.setZone(zone).toISODate()
  if (days.length > 2) {
    return days.map((d) => ({
      start: d.toMillis(),
      end: d.plus({ days: 1 }).toMillis(),
      group: d.toFormat('LLLL yyyy'),
      label: `${d.toFormat('ccccc')}\n${d.day}`,
      weekend: d.weekday > 5,
      today: d.toISODate() === todayIso,
    }))
  }
  // Hours: from the earliest start to the latest end on these days (at least 9 to 6).
  let from = 9
  let to = 18
  const rangeEnd = first.plus({ days: days.length }).toMillis()
  for (const t of tasks) {
    for (const s of taskSessions(t.start_at, t.end_at, zone)) {
      const a = Math.max(new Date(s.start_at).getTime(), first.toMillis())
      const b = Math.min(new Date(s.end_at).getTime(), rangeEnd)
      if (b <= a) continue
      const sa = DateTime.fromMillis(a, { zone })
      const sb = DateTime.fromMillis(b, { zone })
      from = Math.min(from, sa.hour)
      to = Math.max(to, sb.hasSame(sa, 'day') ? Math.ceil(sb.hour + sb.minute / 60) : 24)
    }
  }
  return days.flatMap((d) =>
    Array.from({ length: to - from }, (_, i) => {
      const h = d.set({ hour: from + i })
      return {
        start: h.toMillis(),
        end: h.plus({ hours: 1 }).toMillis(),
        group: d.toFormat('cccc d LLLL'),
        label: h.toFormat('ha').toLowerCase(),
        weekend: d.weekday > 5,
        today: false,
      }
    }),
  )
}

function addGantt(wb: Workbook, tasks: Task[], input: ExportInput, nameOf: (id: string | null) => string) {
  const { zone } = input
  const ws = wb.addWorksheet('Gantt', { properties: { tabColor: { argb: BRAND } } })
  const slots = ganttSlots(tasks, input.fromDate, input.toDate, zone)
  const hours = slots.length > 0 && slots[0].end - slots[0].start < 86_400_000 / 2
  const LEFT = ['#', 'Task', 'Owners', 'Status', 'Progress', 'Start', 'End', 'Hours']
  const T0 = LEFT.length + 1 // first timeline column
  const lastCol = LEFT.length + slots.length
  const HEAD = 5 // the two header rows are 5 and 6

  ;[5, 36, 22, 13, 9, 15, 15, 7].forEach((w, i) => (ws.getColumn(i + 1).width = w))
  slots.forEach((_, i) => (ws.getColumn(T0 + i).width = hours ? 4.6 : 3.4))

  // Title, period and legend
  ws.mergeCells(1, 1, 1, Math.max(lastCol, 8))
  const title = ws.getCell(1, 1)
  title.value = 'Polestar Work Calendar · Gantt chart'
  title.font = { bold: true, size: 16, color: { argb: BRAND } }
  ws.getRow(1).height = 28
  ws.mergeCells(2, 1, 2, Math.max(lastCol, 8))
  const from = DateTime.fromISO(input.fromDate).toFormat('d LLL yyyy')
  const to = DateTime.fromISO(input.toDate).toFormat('d LLL yyyy')
  ws.getCell(2, 1).value = `${from === to ? from : `${from} – ${to}`} · ${tasks.length} task${tasks.length === 1 ? '' : 's'} · times in ${zone} · exported ${DateTime.now().setZone(zone).toFormat('d LLL yyyy, h:mm a')}`
  ws.getCell(2, 1).font = { size: 10, color: { argb: 'FF7A7470' } }
  ws.mergeCells(3, 1, 3, Math.max(lastCol, 8))
  ws.getCell(3, 1).value = {
    richText: [
      ...[...Object.values(GANTT_STATUS), GANTT_EVENT].flatMap((s) => [
        { text: '■ ', font: { size: 13, color: { argb: s.bar } } },
        { text: `${s.label}     `, font: { size: 10, color: { argb: 'FF3B3532' } } },
      ]),
      { text: '▨ ', font: { size: 12, color: { argb: 'FF9A938D' } } },
      { text: 'Hatched: not yet accepted by everyone', font: { size: 10, color: { argb: 'FF3B3532' } } },
    ],
  }
  ws.getRow(3).height = 20
  ws.getRow(4).height = 6

  // Header: left titles span both rows; the timeline has a group row and a label row.
  LEFT.forEach((label, i) => {
    ws.mergeCells(HEAD, i + 1, HEAD + 1, i + 1)
    const c = ws.getCell(HEAD, i + 1)
    c.value = label
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = solid(BRAND)
    c.alignment = { vertical: 'middle', horizontal: i === 1 || i === 2 ? 'left' : 'center', indent: i === 1 || i === 2 ? 1 : 0 }
  })
  let groupStart = 0
  slots.forEach((s, i) => {
    if (i + 1 === slots.length || slots[i + 1].group !== s.group) {
      ws.mergeCells(HEAD, T0 + groupStart, HEAD, T0 + i)
      const g = ws.getCell(HEAD, T0 + groupStart)
      g.value = s.group
      g.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      g.fill = solid(BRAND)
      g.alignment = { horizontal: 'center', vertical: 'middle' }
      g.border = { left: thin('FFFFFFFF') }
      groupStart = i + 1
    }
    const c = ws.getCell(HEAD + 1, T0 + i)
    c.value = s.label
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.font = { size: 8, bold: s.today, color: { argb: s.today ? 'FFFFFFFF' : s.weekend ? 'FF9A938D' : 'FF3B3532' } }
    c.fill = solid(s.today ? 'FFB5462F' : s.weekend ? 'FFEDE5DF' : 'FFF6EFEA')
    c.border = { left: thin('FFE4DBD4'), bottom: thin('FFD9CEC6') }
  })
  ws.getRow(HEAD).height = 20
  ws.getRow(HEAD + 1).height = hours ? 18 : 28

  // One row per task
  tasks.forEach((t, n) => {
    const r = HEAD + 2 + n
    const row = ws.getRow(r)
    row.height = 20
    const st = ganttStyle(t)
    const tentative = t.approval_state !== 'confirmed'
    const owners = t.assignments
      .filter((a) => a.approval_status !== 'declined')
      .map((a) => nameOf(a.user_id) + (a.approval_status === 'accepted' ? '' : ' (awaiting)'))
      .join(', ')
    const values: unknown[] = [
      n + 1,
      safeText(t.title),
      safeText(owners),
      st.label,
      t.progress_percent / 100,
      wallClock(t.start_at, zone),
      wallClock(t.end_at, zone),
      scheduledMinutes(t.start_at, t.end_at, zone) / 60,
    ]
    const zebra = n % 2 ? 'FFFBF9F7' : 'FFFFFFFF'
    values.forEach((v, i) => {
      const c = row.getCell(i + 1)
      c.value = v as never
      c.fill = solid(zebra)
      c.alignment = { vertical: 'middle', horizontal: i === 1 || i === 2 ? 'left' : 'center', indent: i === 1 || i === 2 ? 1 : 0 }
      c.border = { bottom: thin('FFEFEAE5') }
      c.font = { size: 10, color: { argb: 'FF2B2522' } }
    })
    const name = row.getCell(2)
    name.font = { size: 10, bold: t.priority === 'high', strike: t.work_status === 'cancelled', color: { argb: t.work_status === 'cancelled' ? 'FF8E8984' : 'FF2B2522' } }
    const notes = [t.priority === 'high' ? 'High priority' : '', ...(t.points ?? []).map((p) => `• ${p}`)].filter(Boolean)
    if (notes.length) name.note = notes.join('\n')
    const status = row.getCell(4)
    status.fill = solid(st.tint)
    status.font = { size: 9, bold: true, color: { argb: st.text } }
    if (tentative) status.note = 'Not yet accepted by every owner'
    row.getCell(5).numFmt = '0%'
    row.getCell(6).numFmt = 'dd mmm hh:mm'
    row.getCell(7).numFmt = 'dd mmm hh:mm'
    row.getCell(8).numFmt = '0.0'

    const sessions = taskSessions(t.start_at, t.end_at, zone).map((s) => [new Date(s.start_at).getTime(), new Date(s.end_at).getTime()])
    let labelled = false
    slots.forEach((s, i) => {
      const c = row.getCell(T0 + i)
      const on = sessions.some(([a, b]) => a < s.end && b > s.start)
      c.border = { left: thin(on ? 'FFFFFFFF' : 'FFF0EBE6'), bottom: thin(on ? 'FFFFFFFF' : 'FFEFEAE5'), top: on ? thin('FFFFFFFF') : undefined }
      if (on) {
        c.fill = tentative
          ? { type: 'pattern', pattern: 'darkUp', fgColor: { argb: st.bar }, bgColor: { argb: st.tint } }
          : solid(st.bar)
        if (!labelled && t.kind !== 'event' && t.progress_percent > 0 && t.work_status !== 'completed') {
          c.value = `${t.progress_percent}%`
          c.font = { size: 8, bold: true, color: { argb: 'FF2B2522' } }
          c.alignment = { vertical: 'middle' }
        }
        labelled = true
      } else {
        c.fill = solid(s.today ? 'FFFBE9DF' : s.weekend ? 'FFF7F3EF' : zebra)
      }
    })
  })

  // Totals
  const sumRow = HEAD + 3 + tasks.length
  ws.mergeCells(sumRow, 1, sumRow, Math.max(lastCol, 8))
  const groups = [...Object.values(GANTT_STATUS), GANTT_EVENT]
    .map((s) => ({ s, n: tasks.filter((t) => ganttStyle(t) === s).length }))
    .filter((g) => g.n > 0)
  const planned = tasks.filter((t) => t.work_status !== 'cancelled').reduce((sum, t) => sum + scheduledMinutes(t.start_at, t.end_at, zone), 0) / 60
  ws.getCell(sumRow, 1).value = {
    richText: [
      { text: 'Summary   ', font: { bold: true, size: 10, color: { argb: BRAND } } },
      ...groups.flatMap(({ s, n }) => [
        { text: '■ ', font: { size: 12, color: { argb: s.bar } } },
        { text: `${n} ${s.label.toLowerCase()}${s === GANTT_EVENT && n !== 1 ? 's' : ''}    `, font: { size: 10 } },
      ]),
      { text: `${Math.round(planned * 10) / 10} planned hours`, font: { size: 10, bold: true } },
    ],
  }
  ws.getRow(sumRow).height = 22

  ws.views = [{ state: 'frozen', xSplit: LEFT.length, ySplit: HEAD + 1, showGridLines: false, activeCell: `A${HEAD + 2}` }]
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9, // A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${HEAD}:${HEAD + 1}`,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  }
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

  // ── Sheet 1: Gantt chart ──────────────────────────────────────────────────
  addGantt(wb, tasks, input, nameOf)

  // ── Sheet 2: Tasks ────────────────────────────────────────────────────────
  const fieldLabels: string[] = []
  for (const t of tasks) {
    for (const f of t.custom_fields) if (!fieldLabels.includes(f.label)) fieldLabels.push(f.label)
  }
  const ws1 = wb.addWorksheet('Tasks')
  ws1.columns = [
    { header: 'Task ID', key: 'id', width: 38 },
    { header: 'Task Title', key: 'title', width: 36 },
    { header: 'Type', key: 'kind', width: 8 },
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
    { header: 'Points', key: 'points', width: 44 },
    { header: 'Custom Fields', key: 'custom', width: 40 },
    ...fieldLabels.map((label, i) => ({ header: safeText(label), key: `cf_${i}`, width: 18 })),
  ]
  for (const t of tasks) {
    const start = toZoned(t.start_at, zone)
    const end = toZoned(t.end_at, zone)
    const row: Record<string, unknown> = {
      id: t.id,
      title: safeText(t.title),
      kind: t.kind === 'event' ? 'Event' : 'Task',
      date: new Date(Date.UTC(start.year, start.month - 1, start.day)),
      start: wallClock(t.start_at, zone),
      end: wallClock(t.end_at, zone),
      duration: scheduledMinutes(t.start_at, t.end_at, zone) / 60,
      owners: safeText(
        t.assignments
          .map((a) => nameOf(a.user_id) + (a.approval_status === 'accepted' ? '' : ` (${ASSIGNMENT_LABEL[a.approval_status]})`))
          .join(', '),
      ),
      requester: safeText(nameOf(t.requester_id)),
      status: ganttStyle(t) === GANTT_EVENT ? 'Event' : WORK_STATUS_LABEL[t.work_status],
      approval: APPROVAL_STATE_LABEL[t.approval_state],
      progress: t.progress_percent / 100,
      priority: PRIORITY_LABEL[t.priority],
      category: safeText(t.category),
      pending: safeText(t.pending_reason),
      created: wallClock(t.created_at, zone),
      completed: t.completed_at ? wallClock(t.completed_at, zone) : null,
      points: (t.points ?? []).map((p) => `• ${p}`).join('\n'),
      custom: safeText(t.custom_fields.map((f) => `${f.label}: ${displayValue(f, people)}`).join('; ')),
    }
    for (const f of t.custom_fields) {
      const v = exportValue(f, people)
      row[`cf_${fieldLabels.indexOf(f.label)}`] = typeof v === 'string' ? safeText(v) : v
    }
    const added = ws1.addRow(row)
    added.getCell('points').alignment = { wrapText: true, vertical: 'top' }
    const st = ganttStyle(t)
    added.getCell('status').fill = solid(st.tint)
    added.getCell('status').font = { bold: true, color: { argb: st.text } }
    if (!start.hasSame(end, 'day')) added.getCell('end').numFmt = 'yyyy-mm-dd hh:mm'
    for (const f of t.custom_fields) {
      if (f.type === 'date') added.getCell(`cf_${fieldLabels.indexOf(f.label)}`).numFmt = 'yyyy-mm-dd'
    }
  }
  styleSheet(ws1)

  // ── Sheet 3: Utilization (each user in their own time zone) ───────────────
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
        const minutes = (profile ? plannedByDay(t, profile, userZone) : minutesByLocalDay(t.start_at, t.end_at, userZone)).get(date)
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

  // ── Sheet 4: Bookmarks and history ────────────────────────────────────────
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
