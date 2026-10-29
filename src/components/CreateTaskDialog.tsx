import { useState, type FormEvent } from 'react'
import { ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useApp } from '../context'
import { useTaskForm, type CreateDraft } from '../hooks/useTaskForm'
import { CustomFieldEditor } from './CustomFieldEditor'
import { OwnerSelector } from './OwnerSelector'
import { FormError, OwnerNotes, PriorityField, TimeFields } from './TaskFormParts'
import { useFeedback } from './ui/feedback'
import { Button, Dialog, cx } from './ui/primitives'

export type { CreateDraft } from '../hooks/useTaskForm'

interface Props {
  draft: CreateDraft | null
  categories: string[]
  onClose: () => void
  onCreated: (id: string) => void
}

/** Quick task creation from the calendar. Adding someone else as owner turns it into a ticket. */
export function CreateTaskDialog({ draft, categories, onClose, onCreated }: Props) {
  return draft ? (
    <CreateTaskForm
      key={draft.start + (draft.parentTask?.id ?? '')}
      draft={draft}
      categories={categories}
      onClose={onClose}
      onCreated={onCreated}
    />
  ) : null
}

function CreateTaskForm({ draft, categories, onClose, onCreated }: { draft: CreateDraft } & Omit<Props, 'draft'>) {
  const { me, profiles } = useApp()
  const { toast } = useFeedback()
  const form = useTaskForm(draft, me.role === 'requester' ? [] : [me.user_id])
  const [more, setMore] = useState(Boolean(draft.description || draft.customFields?.length || draft.category))

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    const id = await form.submit()
    if (!id) return
    toast(form.isRequest ? 'Ticket sent — it’s added to calendars once accepted.' : 'Task created.')
    onCreated(id)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={draft.parentTask ? 'Create follow-up' : form.isRequest ? 'New ticket' : 'New task'}
      description={draft.parentTask ? `Continues “${draft.parentTask.title}”. The original stays on the calendar.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-task" loading={form.busy}>
            {form.isRequest ? 'Send ticket' : 'Create task'}
          </Button>
        </>
      }
    >
      <form id="create-task" onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="task-title" className="label">
            Task title
          </label>
          <input
            id="task-title"
            autoFocus
            required
            maxLength={200}
            className="field h-11 text-base"
            placeholder="e.g. Brightspeed data validation"
            value={form.title}
            onChange={(e) => form.setTitle(e.target.value)}
          />
        </div>

        <TimeFields form={form} />

        <div>
          <span className="label">Owners</span>
          <OwnerSelector value={form.owners} onChange={form.setOwners} people={profiles} meId={me.user_id} allowEmpty />
          <OwnerNotes form={form} />
        </div>

        <div>
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            aria-expanded={more}
            className="flex items-center gap-1.5 text-xs font-semibold text-ash transition-colors hover:text-ink"
          >
            <SlidersHorizontal size={14} /> More options
            <ChevronDown size={14} className={cx('transition-transform duration-200', more && 'rotate-180')} />
          </button>

          {more ? (
            <div className="anim-pop mt-4 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="label mb-0">Priority</span>
                <PriorityField form={form} />
              </div>
              <div>
                <label htmlFor="task-category" className="label">
                  Project / category
                </label>
                <input
                  id="task-category"
                  list="category-options"
                  className="field h-10"
                  maxLength={80}
                  placeholder="e.g. Brightspeed"
                  value={form.category}
                  onChange={(e) => form.setCategory(e.target.value)}
                />
                <datalist id="category-options">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label htmlFor="task-description" className="label">
                  Description
                </label>
                <textarea
                  id="task-description"
                  className="field min-h-[84px] resize-y"
                  maxLength={5000}
                  value={form.description}
                  onChange={(e) => form.setDescription(e.target.value)}
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
      </form>
    </Dialog>
  )
}
