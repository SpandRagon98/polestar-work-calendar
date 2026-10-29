// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MANDYA, SPANDAN, makeTask, people } from './fixtures'
import { AppContext, type AppContextValue } from '../context'
import { FeedbackProvider } from '../components/ui/feedback'

vi.mock('../lib/api', async (orig) => {
  const actual = await orig<typeof import('../lib/api')>()
  return {
    ...actual,
    createTask: vi.fn(async () => 'new-task-id'),
    fetchOverlapping: vi.fn(async () => []),
  }
})

import * as api from '../lib/api'
import { CreateTaskDialog } from '../components/CreateTaskDialog'
import { CustomFieldEditor } from '../components/CustomFieldEditor'
import { ProgressControl } from '../components/ProgressControl'
import { persistMove } from '../components/CalendarView'
import type { CustomField } from '../lib/types'

const profiles = [people.spandan, people.mandya, people.rupam]
const ctx: AppContextValue = {
  me: people.spandan,
  profiles,
  people: new Map(profiles.map((p) => [p.user_id, p])),
  zone: 'Asia/Kolkata',
  isMobile: false,
  reloadProfiles: async () => undefined,
}

function wrap(ui: React.ReactNode) {
  return render(
    <FeedbackProvider>
      <AppContext.Provider value={ctx}>{ui}</AppContext.Provider>
    </FeedbackProvider>,
  )
}

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('creating a task from a selected range', () => {
  const draft = { start: '2026-11-02T08:30:00.000Z', end: '2026-11-02T10:30:00.000Z' } // 2–4 PM IST

  it('prefills the selected time, defaults the owner to me and saves', async () => {
    const onCreated = vi.fn()
    wrap(<CreateTaskDialog draft={draft} categories={[]} onClose={() => {}} onCreated={onCreated} />)
    expect(screen.getByLabelText('Start time')).toHaveValue('14:00')
    expect(screen.getByLabelText('End time')).toHaveValue('16:00')
    expect(screen.getByRole('button', { name: 'Owners' })).toHaveTextContent('Me')

    await userEvent.type(screen.getByLabelText('Task title'), 'Brightspeed Data Validation')
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-task-id'), { timeout: 3000 })
    expect(api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Brightspeed Data Validation',
        start_at: '2026-11-02T08:30:00.000Z',
        end_at: '2026-11-02T10:30:00.000Z',
        owner_ids: [SPANDAN],
        priority: 'medium',
      }),
    )
  })

  it('keeps focus in the title field after the dialog opens', async () => {
    wrap(<CreateTaskDialog draft={draft} categories={[]} onClose={() => {}} onCreated={() => {}} />)
    await new Promise((r) => setTimeout(r, 50)) // let the dialog's focus frame run
    expect(document.activeElement).toBe(screen.getByLabelText('Task title'))
  })

  it('turns into a ticket when another owner is added', async () => {
    wrap(<CreateTaskDialog draft={draft} categories={[]} onClose={() => {}} onCreated={() => {}} />)
    await userEvent.type(screen.getByLabelText('Task title'), 'Joint review')
    await userEvent.click(screen.getByRole('button', { name: 'Owners' }))
    await userEvent.click(screen.getByRole('option', { name: /Mandya/ }))
    expect(screen.getByText(/needs to accept before it appears on their calendar/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send ticket' }))
    await waitFor(() => expect(api.createTask).toHaveBeenCalled(), { timeout: 3000 })
    expect(vi.mocked(api.createTask).mock.calls[0][0].owner_ids).toEqual([SPANDAN, MANDYA])
  })

  it('blocks an end time before the start time', async () => {
    wrap(<CreateTaskDialog draft={draft} categories={[]} onClose={() => {}} onCreated={() => {}} />)
    await userEvent.type(screen.getByLabelText('Task title'), 'Backwards')
    const end = screen.getByLabelText('End time')
    await userEvent.clear(end)
    await userEvent.type(end, '13:00')
    expect(screen.getAllByText('End time must be later than start time.').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(api.createTask).not.toHaveBeenCalled()
  })
})

describe('dragging and resizing on the calendar', () => {
  const event = (task = makeTask()) => ({
    event: { extendedProps: { task }, start: new Date('2026-11-02T09:30:00Z'), end: new Date('2026-11-02T11:30:00Z') },
    revert: vi.fn(),
  })

  it('saves the new time', async () => {
    const arg = event()
    const save = vi.fn(async () => undefined)
    expect(await persistMove(arg as never, save)).toBe(true)
    expect(save).toHaveBeenCalledWith(arg.event.extendedProps.task, arg.event.start, arg.event.end)
    expect(arg.revert).not.toHaveBeenCalled()
  })

  it('reverts the event when the save fails (e.g. a version conflict)', async () => {
    const arg = event()
    const save = vi.fn(async () => {
      throw new api.ApiError('changed', 'PT409')
    })
    expect(await persistMove(arg as never, save)).toBe(false)
    expect(arg.revert).toHaveBeenCalledTimes(1)
  })
})

describe('custom field editor', () => {
  it('adds a field and edits its value without touching owners', async () => {
    let fields: CustomField[] = []
    const onChange = vi.fn((f: CustomField[]) => (fields = f))
    const { rerender } = render(<CustomFieldEditor fields={fields} onChange={onChange} people={profiles} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await userEvent.type(screen.getByLabelText('New field name'), 'Blocked By')
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ label: 'Blocked By', type: 'text', value: '' })
    rerender(<CustomFieldEditor fields={fields} onChange={onChange} people={profiles} />)
    await userEvent.type(screen.getByLabelText('Blocked By'), 'A')
    expect(fields[0].value).toBe('A')
  })
})

describe('progress control', () => {
  it('commits quick increments and typed values', async () => {
    const onCommit = vi.fn()
    render(<ProgressControl value={40} onCommit={onCommit} />)
    await userEvent.click(screen.getByRole('button', { name: '25%' }))
    expect(onCommit).toHaveBeenLastCalledWith(65)
    const input = screen.getByLabelText('Progress percentage')
    await userEvent.clear(input)
    await userEvent.type(input, '150{Enter}')
    expect(onCommit).toHaveBeenLastCalledWith(100)
  })
})
