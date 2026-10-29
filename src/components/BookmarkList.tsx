import { useState } from 'react'
import { Bookmark, History, Send } from 'lucide-react'
import type { Activity, Profile } from '../lib/types'
import { ACTIVITY_LABEL, describeActivity } from '../lib/activity'
import { formatRelative } from '../lib/time'
import { Button, EmptyState, cx } from './ui/primitives'

interface Props {
  activities: Activity[]
  loading: boolean
  hasMore: boolean
  onLoadMore: () => void
  people: Map<string, Profile>
  zone: string
  canAdd: boolean
  onAdd: (note: string) => Promise<void>
}

/** Progress notes ("bookmarks") with the full audit history one click away. */
export function BookmarkList({ activities, loading, hasMore, onLoadMore, people, zone, canAdd, onAdd }: Props) {
  const [tab, setTab] = useState<'notes' | 'history'>('notes')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const notes = activities.filter((a) => a.is_bookmark)
  const shown = tab === 'notes' ? notes : activities

  async function submit() {
    const text = note.trim()
    if (!text) return
    setBusy(true)
    try {
      await onAdd(text)
      setNote('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>
          <Bookmark size={13} /> Progress notes {notes.length ? <span className="text-stone">({notes.length})</span> : null}
        </TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>
          <History size={13} /> Full history
        </TabBtn>
      </div>

      {canAdd && tab === 'notes' ? (
        <div className="mb-3 flex gap-2">
          <input
            className="field h-10"
            placeholder="Add a progress note, e.g. Validation 60% done"
            aria-label="New progress note"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
          <Button variant="primary" size="icon" className="h-10 w-10" aria-label="Add note" loading={busy} onClick={() => void submit()} disabled={!note.trim()}>
            {!busy ? <Send size={15} /> : null}
          </Button>
        </div>
      ) : null}

      {loading && activities.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-12 rounded-xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<Bookmark size={18} />} title={tab === 'notes' ? 'No progress notes yet' : 'No history yet'}>
          {tab === 'notes' ? 'Short notes help the team follow along — “Waiting for upstream data”, “60% done”.' : null}
        </EmptyState>
      ) : (
        <ol className="relative space-y-0.5 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-px before:bg-line">
          {shown.map((a) => {
            const author = people.get(a.actor_id ?? '')
            const details = describeActivity(a, people, zone)
            return (
              <li key={a.id} className="relative flex gap-3 py-1.5">
                {a.is_bookmark ? (
                  <span className="z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-maroon text-white ring-4 ring-ivory">
                    <Bookmark size={11} className="fill-current" />
                  </span>
                ) : (
                  <span className="z-10 ml-[7px] mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-line-strong ring-4 ring-ivory" />
                )}
                <div className={cx('min-w-0 flex-1', !a.is_bookmark && 'ml-[5px]')}>
                  <div className="flex items-baseline gap-1.5 text-xs">
                    <span className="font-semibold text-ink">{author?.name ?? 'System'}</span>
                    {!a.is_bookmark ? <span className="text-ash">{ACTIVITY_LABEL[a.activity_type] ?? a.activity_type}</span> : null}
                    <span className="ml-auto shrink-0 text-[11px] text-stone">{formatRelative(a.created_at, zone)}</span>
                  </div>
                  {a.note ? <p className={cx('mt-0.5 text-sm break-words', a.is_bookmark ? 'text-ink' : 'text-ash')}>{a.note}</p> : null}
                  {details && !a.is_bookmark ? <p className="mt-0.5 text-xs break-words text-stone">{details}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {hasMore ? (
        <button type="button" onClick={onLoadMore} className="mt-2 w-full rounded-lg py-1.5 text-xs font-medium text-ember hover:bg-canvas">
          Load older activity
        </button>
      ) : null}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors',
        active ? 'bg-ink text-white' : 'text-ash hover:bg-canvas hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}
