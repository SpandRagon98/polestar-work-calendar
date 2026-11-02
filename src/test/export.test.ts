import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { MANDYA, SPANDAN, RUPAM, makeTask, people } from './fixtures'
import { buildWorkbook, exportFileName, GANTT_EVENT, GANTT_STATUS, safeText, wallClock } from '../lib/export'
import type { Activity } from '../lib/types'

const profiles = [people.spandan, people.mandya, people.rupam]

async function roundTrip(wb: ExcelJS.Workbook) {
  const buf = await wb.xlsx.writeBuffer()
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(buf as ArrayBuffer)
  return back
}

describe('Excel export', () => {
  const brightspeed = makeTask({
    title: 'Brightspeed Data Validation',
    category: 'Brightspeed',
    progress_percent: 60,
    work_status: 'in_progress',
    requester_id: RUPAM,
    owners: [[SPANDAN, 'accepted'], [MANDYA, 'accepted']],
    custom_fields: [
      { id: 'a', label: 'Blocked By', type: 'text', value: 'Awaiting FCC mapping', pinned: true },
      { id: 'b', label: 'Rows checked', type: 'number', value: '1200' },
      { id: 'c', label: 'Reviewer', type: 'person', value: MANDYA },
    ],
  })
  const outside = makeTask({ title: 'Next week', start_at: '2026-11-10T08:30:00Z', end_at: '2026-11-10T09:30:00Z' })
  const tentative = makeTask({ title: '=HYPERLINK("http://evil")', approval_state: 'awaiting_approval', owners: [[MANDYA, 'pending']] })
  const activities: Activity[] = [
    {
      id: 'a1',
      task_id: brightspeed.id,
      actor_id: SPANDAN,
      activity_type: 'bookmark',
      note: '60% completed',
      metadata: {},
      is_bookmark: true,
      created_at: '2026-11-02T09:15:00Z',
    },
    {
      id: 'a2',
      task_id: brightspeed.id,
      actor_id: SPANDAN,
      activity_type: 'progress',
      note: null,
      metadata: { from: 0, to: 60 },
      is_bookmark: false,
      created_at: '2026-11-02T09:16:00Z',
    },
  ]

  it('builds three formatted sheets with custom fields as columns', async () => {
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [brightspeed, outside, tentative], activities, profiles, fromDate: '2026-11-02', toDate: '2026-11-06', zone: 'Asia/Kolkata' }),
    )
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Gantt', 'Tasks', 'Utilization', 'Bookmarks and History'])

    const tasks = wb.getWorksheet('Tasks')!
    const header = (tasks.getRow(1).values as unknown[]).slice(1)
    expect(header).toEqual(
      expect.arrayContaining(['Task ID', 'Task Title', 'Date', 'Start Time', 'End Time', 'Owners', 'Requester', 'Status', 'Progress %', 'Custom Fields', 'Blocked By', 'Rows checked', 'Reviewer']),
    )
    expect(tasks.rowCount).toBe(3) // header + 2 tasks in range
    expect(tasks.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
    const col = (name: string) => header.indexOf(name) + 1
    const row = tasks.getRow(2)
    expect(row.getCell(col('Task Title')).value).toBe('Brightspeed Data Validation')
    expect(row.getCell(col('Owners')).value).toBe('Spandan, Mandya')
    expect(row.getCell(col('Requester')).value).toBe('Rupam')
    expect(row.getCell(col('Progress %')).value).toBe(0.6)
    expect(row.getCell(col('Rows checked')).value).toBe(1200)
    expect(row.getCell(col('Reviewer')).value).toBe('Mandya')
    expect(row.getCell(col('Start Time')).value).toEqual(new Date('2026-11-02T14:00:00Z')) // wall clock IST
    expect(row.getCell(col('Planned Duration (h)')).value).toBe(2)
  })

  it('opens on a Gantt chart: one bar per task, coloured by status', async () => {
    const unscheduled = makeTask({ title: 'Ticket without a time', unscheduled: true })
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [brightspeed, tentative, unscheduled], activities, profiles, fromDate: '2026-11-02', toDate: '2026-11-06', zone: 'Asia/Kolkata' }),
    )
    const gantt = wb.worksheets[0]
    expect(gantt.name).toBe('Gantt')
    expect(gantt.getCell('A1').value).toBe('Polestar Work Calendar · Gantt chart')
    expect([1, 2, 4].map((c) => gantt.getRow(5).getCell(c).value)).toEqual(['#', 'Task', 'Status'])
    expect(gantt.getRow(5).getCell(9).value).toBe('November 2026')
    expect(gantt.getRow(6).getCell(9).value).toBe('M\n2') // Monday 2 Nov
    expect(gantt.views[0]).toMatchObject({ state: 'frozen', xSplit: 8, ySplit: 6 })

    const rows = [7, 8].map((r) => gantt.getRow(r))
    const bright = rows.find((r) => r.getCell(2).value === 'Brightspeed Data Validation')!
    expect(bright.getCell(4).value).toBe('In progress')
    expect(bright.getCell(9).fill).toMatchObject({ pattern: 'solid', fgColor: { argb: GANTT_STATUS.in_progress.bar } })
    expect(bright.getCell(9).value).toBe('60%')
    expect(bright.getCell(10).fill).not.toMatchObject({ fgColor: { argb: GANTT_STATUS.in_progress.bar } })
    const waiting = rows.find((r) => r !== bright)!
    expect(waiting.getCell(4).value).toBe('Not started')
    expect(waiting.getCell(9).fill).toMatchObject({ pattern: 'darkUp' }) // not accepted yet
    // Tickets without a time aren't on the calendar, so they aren't exported.
    expect(gantt.getRow(9).getCell(2).value).not.toBe('Ticket without a time')
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Gantt', 'Tasks', 'Utilization', 'Bookmarks and History'])
  })

  it('gives events their own colour and lists points', async () => {
    const meeting = makeTask({ title: 'Weekly sync', kind: 'event', points: ['Pipeline review', 'Hiring plan'] })
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [meeting], activities: [], profiles, fromDate: '2026-11-02', toDate: '2026-11-06', zone: 'Asia/Kolkata' }),
    )
    const row = wb.getWorksheet('Gantt')!.getRow(7)
    expect(row.getCell(4).value).toBe('Event')
    expect(row.getCell(9).fill).toMatchObject({ fgColor: { argb: GANTT_EVENT.bar } })
    const tasks = wb.getWorksheet('Tasks')!
    const header = (tasks.getRow(1).values as unknown[]).slice(1)
    expect(tasks.getRow(2).getCell(header.indexOf('Type') + 1).value).toBe('Event')
    expect(tasks.getRow(2).getCell(header.indexOf('Points') + 1).value).toBe('• Pipeline review\n• Hiring plan')
  })

  it('uses hour columns for a one-day export', async () => {
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [brightspeed], activities: [], profiles, fromDate: '2026-11-02', toDate: '2026-11-02', zone: 'Asia/Kolkata' }),
    )
    const gantt = wb.getWorksheet('Gantt')!
    const labels = (gantt.getRow(6).values as unknown[]).slice(9)
    expect(labels[0]).toBe('9am')
    const filled = labels.filter((_, i) => (gantt.getRow(7).getCell(9 + i).fill as { fgColor?: { argb: string } }).fgColor?.argb === GANTT_STATUS.in_progress.bar)
    expect(filled).toHaveLength(2) // 2–4 PM
    expect(labels[labels.findIndex((_, i) => (gantt.getRow(7).getCell(9 + i).fill as { fgColor?: { argb: string } }).fgColor?.argb === GANTT_STATUS.in_progress.bar)]).toBe('2pm')
  })

  it('escapes spreadsheet formulas in user text', async () => {
    expect(safeText('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(safeText('+1')).toBe("'+1")
    expect(safeText('@cmd')).toBe("'@cmd")
    expect(safeText('Normal')).toBe('Normal')
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [tentative], activities: [], profiles, fromDate: '2026-11-02', toDate: '2026-11-02', zone: 'Asia/Kolkata' }),
    )
    const cell = wb.getWorksheet('Tasks')!.getRow(2).getCell(2)
    expect(cell.value).toBe(`'=HYPERLINK("http://evil")`)
    expect(cell.formula).toBeUndefined()
  })

  it('adds per-user daily totals that count only confirmed work', async () => {
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [brightspeed, tentative], activities, profiles, fromDate: '2026-11-02', toDate: '2026-11-02', zone: 'Asia/Kolkata' }),
    )
    const rows = wb.getWorksheet('Utilization')!.getSheetValues().slice(2) as unknown[][]
    const totals = rows.filter((r) => r[4] === 'Daily total (confirmed work)')
    const byUser = Object.fromEntries(totals.map((r) => [r[2], { planned: r[5], available: r[7], util: r[8] }]))
    expect(byUser.Spandan).toEqual({ planned: 2, available: 8, util: 0.25 })
    // Mandya: 2h confirmed (Brightspeed) + 2h tentative (not counted)
    expect(byUser.Mandya).toEqual({ planned: 2, available: 8, util: 0.25 })
    expect(rows.some((r) => String(r[6]).includes('not counted'))).toBe(true)
  })

  it('exports bookmarks and history with readable change details', async () => {
    const wb = await roundTrip(
      await buildWorkbook({ tasks: [brightspeed], activities, profiles, fromDate: '2026-11-02', toDate: '2026-11-02', zone: 'Asia/Kolkata' }),
    )
    const sheet = wb.getWorksheet('Bookmarks and History')!
    expect(sheet.getRow(2).getCell(3).value).toBe('Progress note')
    expect(sheet.getRow(2).getCell(6).value).toBe('60% completed')
    expect(sheet.getRow(3).getCell(6).value).toBe('0% → 60%')
  })

  it('names files by range and stores wall-clock times', () => {
    expect(exportFileName('2026-11-02', '2026-11-02')).toBe('polestar-work-calendar_2026-11-02.xlsx')
    expect(exportFileName('2026-11-02', '2026-11-06')).toBe('polestar-work-calendar_2026-11-02_to_2026-11-06.xlsx')
    expect(wallClock('2026-11-02T08:30:00Z', 'Asia/Kolkata').toISOString()).toBe('2026-11-02T14:00:00.000Z')
  })
})
