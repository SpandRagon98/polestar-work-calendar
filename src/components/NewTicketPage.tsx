import { useState, type FormEvent } from 'react'
import { ArrowLeft, CalendarCheck2, CalendarClock, ChevronDown, Flag, Send, SlidersHorizontal } from 'lucide-react'
import type { CustomField, Priority } from '../lib/types'
import { createTicket, explainMissing } from '../lib/api'
import { validateFields } from '../lib/customFields'
import { PRIORITY_LABEL } from '../lib/status'
import { useApp } from '../context'
import { useShell, TopBar } from './AppShell'
import { CustomFieldEditor } from './CustomFieldEditor'
import { OwnerSelector } from './OwnerSelector'
import { FormError } from './TaskFormParts'
import { useFeedback } from './ui/feedback'
import { Avatar, Button, Collapse, cx } from './ui/primitives'

const PRIORITIES: { value: Priority; hint: string; tone: string }[] = [
  { value: 'low', hint: 'Whenever there’s room', tone: 'text-ash' },
  { value: 'medium', hint: 'In the next few days', tone: 'text-warn' },
  { value: 'high', hint: 'As soon as possible', tone: 'text-ember' },
]

/** Raise a ticket: what needs doing, who should do it and how urgent it is. The assignees choose the time. */
export function NewTicketPage() {
  const { me, profiles, people, isMobile } = useApp()
  const shell = useShell()
  const { toast } = useFeedback()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [owners, setOwners] = useState<string[]>([])
  const [priority, setPriority] = useState<Priority>('medium')
  const [category, setCategory] = useState('')
  const [fields, setFields] = useState<CustomField[]>([])
  const [details, setDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!title.trim()) return setError('Give the ticket a title.')
    if (owners.length === 0) return setError('Choose at least one person to do it.')
    const fieldErr = validateFields(fields)
    if (fieldErr) return setError(fieldErr)
    setBusy(true)
    try {
      const id = await createTicket({
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        category: category.trim() || undefined,
        custom_fields: fields,
        owner_ids: owners,
      })
      toast('Ticket sent. It reaches the calendar once an assignee chooses a time.')
      shell.navigate('tickets', { tab: 'raised', open: id })
    } catch (err) {
      setError(explainMissing(err, 'create_ticket').message)
    } finally {
      setBusy(false)
    }
  }

  const assignees = owners.map((id) => people.get(id)).filter(Boolean)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopBar
        title="New ticket"
        leading={
          <button
            type="button"
            aria-label="Back to tickets"
            onClick={() => shell.navigate('tickets')}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-xl text-ash transition-colors hover:bg-canvas hover:text-ink"
          >
            <ArrowLeft size={18} />
          </button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <form
          onSubmit={submit}
          className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 md:px-8 md:py-8 lg:grid-cols-[minmax(0,1fr)_19rem]"
        >
          <div className="card min-w-0">
            <div className="border-b border-line px-6 py-5 md:px-8">
              <h2 className="font-display text-xl font-bold text-ink">Raise a ticket</h2>
              <p className="mt-1 text-sm text-ash">Describe the work, who should do it and how urgent it is. They’ll choose when to do it.</p>
            </div>

            <div className="space-y-7 px-6 py-6 md:px-8">
              <Section step={1} title="What needs doing?">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="ticket-title" className="label">
                      Title
                    </label>
                    <input
                      id="ticket-title"
                      autoFocus={!isMobile}
                      required
                      maxLength={200}
                      className="field h-11 text-base"
                      placeholder="e.g. Churn analysis by region for leadership review"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="ticket-description" className="label">
                      Details <span className="font-normal text-stone">(optional)</span>
                    </label>
                    <textarea
                      id="ticket-description"
                      className="field min-h-[112px] resize-y leading-relaxed"
                      maxLength={5000}
                      placeholder="Context, links, what “done” looks like…"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>
                </div>
              </Section>

              <Section step={2} title="Who should do it?">
                <OwnerSelector
                  value={owners}
                  onChange={setOwners}
                  people={profiles}
                  meId={me.user_id}
                  allowEmpty
                  placeholder="Choose one or more people"
                  label="Assignees"
                />
              </Section>

              <Section step={3} title="How urgent is it?">
                <div role="radiogroup" aria-label="Priority" className="grid gap-2 sm:grid-cols-3">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={priority === p.value}
                      onClick={() => setPriority(p.value)}
                      className={cx(
                        'flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] duration-150',
                        priority === p.value
                          ? 'border-maroon bg-peach-50 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-maroon)_12%,transparent)]'
                          : 'border-line bg-surface hover:border-stone',
                      )}
                    >
                      <Flag size={15} className={cx('mt-0.5 shrink-0', p.tone)} />
                      <span>
                        <span className="block text-sm font-semibold text-ink">{PRIORITY_LABEL[p.value]}</span>
                        <span className="block text-xs text-ash">{p.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Section>

              <div>
                <button
                  type="button"
                  onClick={() => setDetails((d) => !d)}
                  aria-expanded={details}
                  className="flex items-center gap-1.5 text-xs font-semibold text-ash transition-colors hover:text-ink"
                >
                  <SlidersHorizontal size={14} /> Project & custom fields
                  <ChevronDown size={14} className={cx('transition-transform duration-200', details && 'rotate-180')} />
                </button>
                <Collapse open={details} className="space-y-5 pt-4 pb-1">
                  <div>
                    <label htmlFor="ticket-category" className="label">
                      Project / category
                    </label>
                    <input
                      id="ticket-category"
                      className="field h-10"
                      maxLength={80}
                      placeholder="e.g. Brightspeed"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    />
                  </div>
                  <div>
                    <span className="label">Custom fields</span>
                    <CustomFieldEditor fields={fields} onChange={setFields} people={profiles} />
                  </div>
                </Collapse>
              </div>

              <FormError message={error} />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/40 px-6 py-4 sm:flex-row sm:justify-end md:px-8">
              <Button onClick={() => shell.navigate('tickets')}>Cancel</Button>
              <Button type="submit" variant="primary" loading={busy} className="justify-center">
                {!busy ? <Send size={15} /> : null} Submit ticket
              </Button>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <div className="card p-5">
              <p className="section-title">Summary</p>
              <p className={cx('mt-2 text-sm font-semibold break-words', title ? 'text-ink' : 'text-stone')}>{title || 'Untitled ticket'}</p>
              <p className="mt-1 flex items-center gap-1.5 text-xs text-ash">
                <Flag size={11} className={PRIORITIES.find((p) => p.value === priority)?.tone} /> {PRIORITY_LABEL[priority]} priority · time chosen by assignee
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {assignees.length ? (
                  assignees.map((p) => (
                    <span key={p!.user_id} className="inline-flex items-center gap-1.5 rounded-full bg-canvas py-0.5 pr-2.5 pl-0.5 text-xs font-medium">
                      <Avatar id={p!.user_id} name={p!.name} size={20} />
                      {p!.user_id === me.user_id ? 'You' : p!.name}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-stone">No assignees yet</span>
                )}
              </div>
            </div>
            <div className="card p-5">
              <p className="section-title">How tickets work</p>
              <ol className="mt-3 space-y-3 text-sm">
                <Step icon={<Send size={14} />} title="You submit">
                  Each assignee gets a notification in Tickets.
                </Step>
                <Step icon={<CalendarClock size={14} />} title="They choose a time">
                  An assignee picks the date and time when they accept, or declines.
                </Step>
                <Step icon={<CalendarCheck2 size={14} />} title="It’s on the calendar">
                  Once accepted, it lands on their calendar. Follow progress here.
                </Step>
              </ol>
            </div>
          </aside>
        </form>
      </div>
    </div>
  )
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 flex items-center gap-2.5 text-sm font-semibold text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-rail text-[11px] font-bold text-white">{step}</span>
        {title}
      </h3>
      <div className="md:pl-[2.125rem]">{children}</div>
    </section>
  )
}

function Step({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-peach-50 text-maroon">{icon}</span>
      <span>
        <span className="block font-medium text-ink">{title}</span>
        <span className="block text-xs leading-relaxed text-ash">{children}</span>
      </span>
    </li>
  )
}
