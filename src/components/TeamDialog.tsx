import { useState } from 'react'
import { Mail, UserPlus } from 'lucide-react'
import type { Profile, Role } from '../lib/types'
import { adminUpdateProfile, inviteUser, toApiError, updateMyProfile } from '../lib/api'
import { appUrl } from '../lib/supabase'
import { browserZone } from '../lib/time'
import { useApp } from '../context'
import { useFeedback } from './ui/feedback'
import { Avatar, Button, Dialog, cx } from './ui/primitives'

const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', contributor: 'Contributor', requester: 'Requester' }
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/** Admin-only: invite people and manage roles, capacity and working days. */
export function TeamDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profiles, me, reloadProfiles } = useApp()
  const { toast } = useFeedback()
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

  return (
    <Dialog open={open} onClose={onClose} title="Team" description="Roles, daily capacity and working days." width="max-w-3xl">
      <div className="mb-4 flex justify-end">
        {!inviting ? (
          <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
            <UserPlus size={14} /> Invite teammate
          </Button>
        ) : null}
      </div>
      {inviting ? (
        <div className="anim-pop mb-5 rounded-2xl border border-line bg-white p-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input className="field h-10" placeholder="Full name" aria-label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input
              className="field h-10"
              type="email"
              placeholder="email@company.com"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select className="field h-10" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-xs text-stone">
            They’ll get an email link to set a password. Requires the <code>invite-user</code> Edge Function (see README). You can
            also invite from the Supabase dashboard.
          </p>
          <div className="mt-3 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={busy} disabled={!email.includes('@') || !name.trim()} onClick={() => void invite()}>
              <Mail size={14} /> Send invite
            </Button>
          </div>
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-stone">
              <th className="pb-2 font-medium">Person</th>
              <th className="pb-2 font-medium">Role</th>
              <th className="pb-2 font-medium">Capacity / day</th>
              <th className="pb-2 font-medium">Working days</th>
              <th className="pb-2 font-medium">Active</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.user_id} className={cx('border-t border-line', !p.active && 'opacity-55')}>
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar id={p.user_id} name={p.name} size={28} />
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {p.name}
                        {p.user_id === me.user_id ? <span className="text-stone"> (you)</span> : null}
                      </p>
                      <p className="truncate text-xs text-stone">
                        {p.email} · {p.timezone ?? 'zone not set'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  <select
                    className="field h-8 w-32 py-0"
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
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.5}
                      aria-label={`Daily capacity hours for ${p.name}`}
                      className="field h-8 w-16 py-0 text-right"
                      defaultValue={p.capacity_minutes / 60}
                      onBlur={(e) => {
                        const minutes = Math.round(Number(e.target.value) * 60)
                        if (Number.isFinite(minutes) && minutes !== p.capacity_minutes) void save(p, { capacity_minutes: minutes })
                      }}
                    />
                    <span className="text-xs text-stone">h</span>
                  </div>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex gap-0.5">
                    {WEEKDAYS.map((d, i) => {
                      const day = i + 1
                      const on = p.work_days.includes(day)
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          aria-label={`${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]} for ${p.name}`}
                          onClick={() =>
                            void save(p, {
                              work_days: on ? p.work_days.filter((x) => x !== day) : [...p.work_days, day].sort(),
                            })
                          }
                          className={cx(
                            'h-7 w-7 rounded-lg text-[11px] font-semibold',
                            on ? 'bg-maroon text-white' : 'bg-canvas text-stone hover:text-ink',
                          )}
                        >
                          {d}
                        </button>
                      )
                    })}
                  </div>
                </td>
                <td className="py-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-maroon"
                    aria-label={`${p.name} is active`}
                    checked={p.active}
                    disabled={p.user_id === me.user_id}
                    onChange={(e) => void save(p, { active: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
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
      }
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
      </div>
    </Dialog>
  )
}
