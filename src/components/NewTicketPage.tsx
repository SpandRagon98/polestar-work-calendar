import { useMemo, useState, type FormEvent } from 'react'
import { DateTime } from 'luxon'
import { ArrowLeft, CalendarCheck2, ChevronDown, Inbox, Send, SlidersHorizontal } from 'lucide-react'
import { useApp } from '../context'
import { useTaskForm, type CreateDraft } from '../hooks/useTaskForm'
import { formatTimeRange } from '../lib/time'
import { useShell, TopBar } from './AppShell'
import { CustomFieldEditor } from './CustomFieldEditor'
import { OwnerSelector } from './OwnerSelector'
import { FormError, OwnerNotes, PriorityField, TimeFields } from './TaskFormParts'
import { useFeedback } from './ui/feedback'
import { Avatar, Button, cx } from './ui/primitives'

/** Next working day at 10:00 in the user's zone, one hour long. */
function defaultSlot(zone: string): CreateDraft {
  let day = DateTime.now().setZone(zone).plus({ days: 1 }).startOf('day')
  while (day.weekday > 5) day = day.plus({ days: 1 })
  const start = day.set({ hour: 10 })
  return { start: start.toUTC().toISO()!, end: start.plus({ hours: 1 }).toUTC().toISO()! }
}

export function NewTicketPage() {
  const { zone } = useApp()
  const draft = useMemo(() => defaultSlot(zone), [zone])
  return <NewTicketForm draft={draft} />
}

function NewTicketForm({ draft }: { draft: CreateDraft }) {
  const { me, profiles, people, zone, isMobile } = useApp()
  const shell = useShell()
  const { toast } = useFeedback()
  const form = useTaskForm(draft, [])
  const [details, setDetails] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const id = await form.submit()
    if (!id) return
    toast(form.isRequest ? 'Ticket sent. It’s added to calendars once accepted.' : 'Task created on your calendar.')
    shell.navigate('tickets', { tab: 'raised', open: id })
  }

  const assignees = form.owners.map((id) => people.get(id)).filter(Boolean)

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
              <p className="mt-1 text-sm text-ash">Describe the work, who should do it and when. They’ll accept, decline or suggest another time.</p>
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
                      value={form.title}
                      onChange={(e) => form.setTitle(e.target.value)}
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
                      value={form.description}
                      onChange={(e) => form.setDescription(e.target.value)}
                    />
                  </div>
                </div>
              </Section>

              <Section step={2} title="Who should do it?">
                <OwnerSelector
                  value={form.owners}
                  onChange={form.setOwners}
                  people={profiles}
                  meId={me.user_id}
                  allowEmpty
                  placeholder="Choose one or more people"
                  label="Assignees"
                />
                <OwnerNotes form={form} />
              </Section>

              <Section step={3} title="When should it happen?">
                <TimeFields form={form} durations />
              </Section>

              <div>
                <button
                  type="button"
                  onClick={() => setDetails((d) => !d)}
                  aria-expanded={details}
                  className="flex items-center gap-1.5 text-xs font-semibold text-ash transition-colors hover:text-ink"
                >
                  <SlidersHorizontal size={14} /> Priority, project & custom fields
                  <ChevronDown size={14} className={cx('transition-transform duration-200', details && 'rotate-180')} />
                </button>
                {details ? (
                  <div className="anim-pop mt-4 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="label mb-0">Priority</span>
                      <PriorityField form={form} />
                    </div>
                    <div>
                      <label htmlFor="ticket-category" className="label">
                        Project / category
                      </label>
                      <input
                        id="ticket-category"
                        className="field h-10"
                        maxLength={80}
                        placeholder="e.g. Brightspeed"
                        value={form.category}
                        onChange={(e) => form.setCategory(e.target.value)}
                      />
                    </div>
                    <div>
                      <span className="label">Custom fields</span>
                      <CustomFieldEditor fields={form.fields} onChange={form.setFields} people={profiles} />
                    </div>
                  </div>
                ) : null}
              </div>

              <FormError message={form.error} />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/40 px-6 py-4 sm:flex-row sm:justify-end md:px-8">
              <Button onClick={() => shell.navigate('tickets')}>Cancel</Button>
              <Button type="submit" variant="primary" loading={form.busy} className="justify-center">
                {!form.busy ? <Send size={15} /> : null} Submit ticket
              </Button>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <div className="card p-5">
              <p className="section-title">Summary</p>
              <p className={cx('mt-2 text-sm font-semibold break-words', form.title ? 'text-ink' : 'text-stone')}>
                {form.title || 'Untitled ticket'}
              </p>
              <p className="mt-1 text-xs text-ash">
                {form.timeInvalid
                  ? 'Choose a valid time'
                  : formatTimeRange(
                      DateTime.fromISO(`${form.startDate}T${form.startTime}`, { zone }).toUTC().toISO()!,
                      DateTime.fromISO(`${form.endDate}T${form.endTime}`, { zone }).toUTC().toISO()!,
                      zone,
                    )}
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
                <Step icon={<Inbox size={14} />} title="They respond">
                  Accept, decline or suggest a different time. You can adjust and resend.
                </Step>
                <Step icon={<CalendarCheck2 size={14} />} title="It’s scheduled">
                  Once everyone accepts, it lands on their calendars. Follow progress here.
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
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[11px] font-bold text-white">{step}</span>
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
