import { useMemo, useState } from 'react'
import { Mail, Trash2, UserPlus } from 'lucide-react'
import type { Profile, Role } from '../lib/types'
import { adminDeleteUser, adminUpdateProfile, inviteUser, toApiError, updateMyProfile } from '../lib/api'
import { appUrl } from '../lib/supabase'
import { browserZone } from '../lib/time'
import { useApp } from '../context'
import { useFeedback } from './ui/feedback'
import { Avatar, Button, Dialog, Segmented, cx } from './ui/primitives'
import { graphicsRenderer, isSoftwareRendering, readMotionPref, resolveMotion, setMotionPref, type MotionLevel, type MotionPref } from '../lib/motion'

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', contributor: 'Contributor', requester: 'Requester' }
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ROLE_HINT: Record<Role, string> = {
  admin: 'Admins can edit any task and manage the team.',
  contributor: 'Contributors plan their own work, see the team calendar and answer tickets.',
  requester: 'Requesters only see the Tickets page: they raise tickets and follow their progress.',
}

/** Admin-only: invite people and manage roles, capacity and working days. */
export function TeamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profiles, me, reloadProfiles } = useApp()
  const { toast, confirm } = useFeedback()
  const [deleting, setDeleting] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('contributor')
  const [busy, setBusy] = useState(false)

  async function save(p: Profile, fields: Parameters<typeof adminUpdateProfile>[1]) {
    try {
      await adminUpdateProfile(p.user_id, fields)
      await reloadProfiles()
    } catch (e) {
      toast(toApiError(e).message, 'error')
    }
  }

  async function invite() {
    setBusy(true)
    try {
      await inviteUser({ email: email.trim(), name: name.trim(), role, redirectTo: appUrl() })
      toast(`Invitation sent to ${email.trim()}.`)
      setEmail('')
      setName('')
      setInviting(false)
      await reloadProfiles()
    } catch (e) {
      toast(toApiError(e).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: Profile) {
    setDeleting(p.user_id)
    try {
      const impact = await adminDeleteUser(p.user_id, true)
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
      const ok = await confirm({
        title: `Delete ${p.name}?`,
        confirmLabel: 'Delete permanently',
        danger: true,
        message: (
          <div className="space-y-3">
            <p>
              This removes <b className="text-ink">{p.email}</b> and their login. It can’t be undone.
            </p>
            <ul className="space-y-1.5 rounded-xl bg-canvas px-3.5 py-3 text-xs leading-relaxed">
              <li>
                <b className="text-ink">{plural(impact.sole_tasks, 'task')}</b> where they’re the only owner will be deleted.
              </li>
              <li>
                They’ll be removed from <b className="text-ink">{plural(impact.shared_tasks, 'shared task')}</b>; other owners keep them.
              </li>
              <li>
                <b className="text-ink">{plural(impact.raised_tasks, 'ticket')}</b> they raised stay, without a requester.
              </li>
            </ul>
            <p className="text-xs">
              To keep their history instead, untick <b className="text-ink">Active</b> — they won’t be able to sign in.
            </p>
          </div>
        ),
      })
      if (!ok) return
      await adminDeleteUser(p.user_id)
      toast(`${p.name} was deleted.`)
      await reloadProfiles()
    } catch (e) {
      const err = toApiError(e)
      toast(
        /admin_delete_user/.test(err.message)
          ? 'Deleting people needs a one-time database update: run supabase/migrations/20261030000000_admin_delete_user.sql in the Supabase SQL Editor.'
          : err.message,
        'error',
      )
    } finally {
      setDeleting(null)
    }
  }

  const activeCount = profiles.filter((p) => p.active).length

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Team"
      description="Invite people and set their role, daily capacity and working days."
      width="max-w-4xl"
    >
      {inviting ? (
        <div className="anim-pop mb-6 rounded-2xl border border-line bg-white p-5">
          <p className="mb-3 text-sm font-semibold text-ink">Invite a teammate</p>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_9rem]">
            <div>
              <label className="label" htmlFor="invite-name">
                Full name
              </label>
              <input id="invite-name" className="field h-10" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="invite-email">
                Work email
              </label>
              <input
                id="invite-email"
                className="field h-10"
                type="email"
                placeholder="name@polestaranalytics.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="invite-role">
                Role
              </label>
              <select id="invite-role" className="field h-10" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-stone">{ROLE_HINT[role]} They’ll get an email to set a password.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!email.includes('@') || !name.trim()} onClick={() => void invite()}>
              {!busy ? <Mail size={14} /> : null} Send invite
            </Button>
          </div>
        </div>
      ) : (
        <div className="mb-5 flex items-center justify-between gap-3">
          <p className="text-sm text-ash">
            {activeCount} active member{activeCount === 1 ? '' : 's'}
          </p>
          <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
            <UserPlus size={14} /> Invite teammate
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line">
        <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_13.5rem_5rem] items-center gap-4 bg-canvas/60 px-4 py-2.5 text-[11px] font-semibold tracking-wide text-stone uppercase md:grid">
          <span>Person</span>
          <span>Role</span>
          <span>Capacity</span>
          <span>Working days</span>
          <span>Active</span>
        </div>
        <ul className="divide-y divide-line">
          {profiles.map((p) => (
            <li
              key={p.user_id}
              className={cx(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_8.5rem_6.5rem_13.5rem_5rem]',
                !p.active && 'opacity-55',
              )}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar id={p.user_id} name={p.name} size={32} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {p.name}
                    {p.user_id === me.user_id ? <span className="font-normal text-stone"> (you)</span> : null}
                  </p>
                  <p className="truncate text-xs text-stone">
                    {p.email}
                    {p.timezone ? ` · ${p.timezone}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1 md:order-last md:justify-between">
              <label className="flex h-9 items-center gap-2 px-1 text-xs text-ash">
                <span className="md:sr-only">Active</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-maroon"
                  aria-label={`${p.name} is active`}
                  checked={p.active}
                  disabled={p.user_id === me.user_id}
                  onChange={(e) => void save(p, { active: e.target.checked })}
                />
              </label>
              {p.user_id !== me.user_id ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-stone hover:bg-st-pending/8 hover:text-st-pending"
                  aria-label={`Delete ${p.name}`}
                  title="Delete permanently"
                  loading={deleting === p.user_id}
                  onClick={() => void remove(p)}
                >
                  {deleting !== p.user_id ? <Trash2 size={15} /> : null}
                </Button>
              ) : (
                <span className="h-9 w-9" aria-hidden />
              )}
              </div>
              <select
                className="field h-9 py-0 max-md:col-span-2"
                aria-label={`Role for ${p.name}`}
                value={p.role}
                onChange={(e) => void save(p, { role: e.target.value as Role })}
              >
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  aria-label={`Daily capacity hours for ${p.name}`}
                  className="field h-9 w-16 py-0 text-right tabular-nums"
                  defaultValue={p.capacity_minutes / 60}
                  onBlur={(e) => {
                    const minutes = Math.round(Number(e.target.value) * 60)
                    if (Number.isFinite(minutes) && minutes !== p.capacity_minutes) void save(p, { capacity_minutes: minutes })
                  }}
                />
                <span className="text-xs text-stone">h/day</span>
              </div>
              <div className="flex gap-1 max-md:justify-end">
                {WEEKDAYS.map((d, i) => {
                  const day = i + 1
                  const on = p.work_days.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={on}
                      aria-label={`${DAY_NAMES[i]} for ${p.name}`}
                      title={DAY_NAMES[i]}
                      onClick={() =>
                        void save(p, {
                          work_days: on ? p.work_days.filter((x) => x !== day) : [...p.work_days, day].sort(),
                        })
                      }
                      className={cx(
                        'h-7 w-7 rounded-lg text-[11px] font-semibold transition-colors',
                        on ? 'bg-maroon text-white hover:bg-maroon-600' : 'bg-canvas text-stone hover:text-ink',
                      )}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}

/** Each person can set their display name and time zone. */
export function ProfileDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const { me } = useApp()
  const { toast } = useFeedback()
  const [name, setName] = useState(me.name)
  const [zone, setZone] = useState(me.timezone ?? browserZone())
  const [busy, setBusy] = useState(false)
  const zones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [zone]

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your profile"
      width="max-w-md"
      footer={(close) => (
        <>
          <Button onClick={close}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await updateMyProfile({ name: name.trim(), timezone: zone })
                await onSaved()
                toast('Profile saved.')
                onClose()
              } catch (e) {
                toast(toApiError(e).message, 'error')
              } finally {
                setBusy(false)
              }
            }}
          >
            Save
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="profile-name">
            Display name
          </label>
          <input id="profile-name" className="field h-10" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="profile-zone">
            Time zone
          </label>
          <select id="profile-zone" className="field h-10" value={zone} onChange={(e) => setZone(e.target.value)}>
            {(zones.includes(zone) ? zones : [zone, ...zones]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-stone">All times are shown in this zone. Your browser reports {browserZone()}.</p>
        </div>
        <div className="rounded-2xl bg-canvas p-3 text-xs text-ash">
          <p>
            <b className="text-ink">Role:</b> {ROLE_LABEL[me.role]} · <b className="text-ink">Capacity:</b> {me.capacity_minutes / 60}h per working day
          </p>
          <p className="mt-0.5">Roles and capacity are managed by an admin.</p>
        </div>
        <MotionSetting />
      </div>
    </Dialog>
  )
}

const MOTION_HINT: Record<MotionLevel, string> = {
  full: 'All animations.',
  lite: 'Quick fades only — best when the browser draws without graphics acceleration.',
  off: 'No animations.',
}

/** Per-browser animation level; applies immediately. */
function MotionSetting() {
  const [pref, setPref] = useState<MotionPref>(readMotionPref)
  const [level, setLevel] = useState<MotionLevel>(() => resolveMotion(readMotionPref()))
  const renderer = useMemo(() => graphicsRenderer(), [])
  const software = isSoftwareRendering(renderer)
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label mb-0">Animations</span>
        <Segmented
          size="sm"
          label="Animations"
          value={pref}
          onChange={(v) => {
            setPref(v)
            setLevel(setMotionPref(v))
          }}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'full', label: 'Full' },
            { value: 'lite', label: 'Lite' },
            { value: 'off', label: 'Off' },
          ]}
        />
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-stone">
        {pref === 'auto' ? `Auto chose ${level}: ` : ''}
        {MOTION_HINT[level]}
        {software ? ' Your browser is drawing without graphics acceleration — turn it on in the browser’s settings for the smoothest experience.' : ''}
      </p>
    </div>
  )
}
