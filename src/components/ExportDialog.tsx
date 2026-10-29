import { useState } from 'react'
import { DateTime } from 'luxon'
import { FileSpreadsheet } from 'lucide-react'
import { fetchActivitiesForTasks, fetchTasksInRange, toApiError } from '../lib/api'
import { buildWorkbook, downloadWorkbook, exportFileName, tasksInRange } from '../lib/export'
import { isMyTask } from '../lib/permissions'
import { useApp } from '../context'
import { useFeedback } from './ui/feedback'
import { Button, Dialog, Segmented, cx } from './ui/primitives'

type Preset = 'today' | 'visible' | 'week' | 'custom'

interface Props {
  open: boolean
  onClose: () => void
  /** The calendar's visible range (yyyy-mm-dd, inclusive); without it the dialog starts on this week. */
  visibleStart?: string
  visibleEnd?: string
}

const MAX_DAYS = 92

export function ExportDialog({ open, onClose, visibleStart, visibleEnd }: Props) {
  const { me, profiles, zone } = useApp()
  const { toast } = useFeedback()
  const today = DateTime.now().setZone(zone)
  const weekStart = today.startOf('week').toISODate()!
  const weekEnd = today.startOf('week').plus({ days: 6 }).toISODate()!
  const hasVisible = Boolean(visibleStart && visibleEnd)
  const [preset, setPreset] = useState<Preset>(hasVisible ? 'visible' : 'week')
  const [from, setFrom] = useState(visibleStart ?? weekStart)
  const [to, setTo] = useState(visibleEnd ?? weekEnd)
  const [scope, setScope] = useState<'mine' | 'all'>(me.role === 'admin' ? 'all' : 'mine')
  const [busy, setBusy] = useState(false)

  const choose = (p: Preset) => {
    setPreset(p)
    if (p === 'today') {
      setFrom(today.toISODate()!)
      setTo(today.toISODate()!)
    } else if (p === 'visible' && visibleStart && visibleEnd) {
      setFrom(visibleStart)
      setTo(visibleEnd)
    } else if (p === 'week') {
      setFrom(weekStart)
      setTo(weekEnd)
    }
  }

  const days = DateTime.fromISO(to).diff(DateTime.fromISO(from), 'days').days + 1
  const invalid = !from || !to || days < 1 || days > MAX_DAYS

  async function run() {
    setBusy(true)
    try {
      const start = DateTime.fromISO(from, { zone }).startOf('day')
      const end = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf('day')
      // Buffer a day either side so every owner's local day is complete.
      let tasks = await fetchTasksInRange(start.minus({ days: 1 }).toJSDate(), end.plus({ days: 1 }).toJSDate(), 5000)
      if (scope === 'mine') tasks = tasks.filter((t) => isMyTask(t, me.user_id))
      const inRange = tasksInRange(tasks, from, to, zone)
      if (inRange.length === 0) {
        toast('No tasks in that range to export.', 'info')
        return
      }
      const activities = await fetchActivitiesForTasks(inRange.map((t) => t.id))
      const wb = await buildWorkbook({ tasks: inRange, activities, profiles, fromDate: from, toDate: to, zone })
      await downloadWorkbook(wb, exportFileName(from, to))
      toast(`Exported ${inRange.length} task${inRange.length === 1 ? '' : 's'}.`)
      onClose()
    } catch (e) {
      toast(toApiError(e).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Export to Excel"
      description="Tasks, utilization and history as an .xlsx file — generated in your browser."
      width="max-w-md"
      footer={(close) => (
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={invalid} onClick={() => void run()}>
            <FileSpreadsheet size={16} /> Export to Excel
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div>
          <span className="label">Date range</span>
          <div className={cx('grid grid-cols-2 gap-1.5', hasVisible ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
            {(
              [
                ['today', 'Today'],
                ...(hasVisible ? [['visible', 'Visible']] : []),
                ['week', 'This week'],
                ['custom', 'Custom'],
              ] as [Preset, string][]
            ).map(([p, label]) => (
              <button
                key={p}
                type="button"
                aria-pressed={preset === p}
                onClick={() => choose(p)}
                className={cx(
                  'rounded-xl border px-2 py-2 text-xs font-semibold',
                  preset === p ? 'border-maroon bg-peach-50 text-maroon' : 'border-line bg-white text-ash hover:border-stone',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="export-from">
                From
              </label>
              <input
                id="export-from"
                type="date"
                className="field h-10"
                value={from}
                onChange={(e) => {
                  setPreset('custom')
                  setFrom(e.target.value)
                }}
              />
            </div>
            <div>
              <label className="label" htmlFor="export-to">
                To
              </label>
              <input
                id="export-to"
                type="date"
                className="field h-10"
                value={to}
                onChange={(e) => {
                  setPreset('custom')
                  setTo(e.target.value)
                }}
              />
            </div>
          </div>
          {invalid ? (
            <p className="mt-1.5 text-xs text-st-pending">
              {days > MAX_DAYS ? `Choose at most ${MAX_DAYS} days.` : '“To” must be on or after “From”.'}
            </p>
          ) : (
            <p className="mt-1.5 text-xs text-stone">
              {days} day{days === 1 ? '' : 's'} · times in {zone}
            </p>
          )}
        </div>
        {me.role !== 'requester' ? (
          <div>
            <span className="label">Include</span>
            <Segmented
              label="Include"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'mine', label: 'My tasks' },
                { value: 'all', label: 'All visible tasks' },
              ]}
            />
          </div>
        ) : null}
        <ul className="space-y-1 rounded-2xl bg-canvas p-3 text-xs text-ash">
          <li>
            <b className="text-ink">Tasks</b> — one row per task, custom fields as extra columns
          </li>
          <li>
            <b className="text-ink">Utilization</b> — per person, per day, with daily totals
          </li>
          <li>
            <b className="text-ink">Bookmarks and History</b> — progress notes and every change
          </li>
        </ul>
      </div>
    </Dialog>
  )
}
