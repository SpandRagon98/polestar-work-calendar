import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  LogOut,
  Plus,
  Settings,
  Ticket,
  Users,
} from 'lucide-react'
import type { Task } from '../lib/types'
import type { RouteName } from '../lib/router'
import { useApp } from '../context'
import { useNotifications, type Notice } from '../hooks/useNotifications'
import { ACTIVITY_LABEL } from '../lib/activity'
import { desktopAlert } from '../lib/desktopAlerts'
import { formatTimeRange } from '../lib/time'
import { useFeedback } from './ui/feedback'
import { ExportDialog } from './ExportDialog'
import { NotificationsPopover } from './NotificationsPopover'
import { ProfileDialog, TeamDialog } from './TeamDialog'
import { Avatar, Logo, Popover, cx } from './ui/primitives'

interface ShellApi {
  route: RouteName
  navigate: (name: RouteName, params?: Record<string, string>) => void
  openExport: (range?: { from: string; to: string }) => void
  openTeam: () => void
  openProfile: () => void
  signOut: () => void
  notif: ReturnType<typeof useNotifications>
  /** Open a task from a notification: tickets you still have to answer go to the Tickets page. */
  openFromNotification: (task: Task | string) => void
}

const ShellContext = createContext<ShellApi | null>(null)
export function useShell(): ShellApi {
  const ctx = useContext(ShellContext)
  if (!ctx) throw new Error('useShell must be used inside AppShell')
  return ctx
}

const COLLAPSE_KEY = 'pwc.sidebar.collapsed'
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

interface Props {
  route: RouteName
  navigate: ShellApi['navigate']
  onSignOut: () => void
  reloadMe: () => Promise<void>
  children: ReactNode
}

export function AppShell({ route, navigate, onSignOut, reloadMe, children }: Props) {
  const { me, isMobile, people, zone } = useApp()
  const { toast } = useFeedback()

  // New tickets for me, and responses to tickets I raised, arrive live.
  const onNotice = useCallback(
    (n: Notice) => {
      if (n.kind === 'ticket') {
        const t = n.task
        const from = people.get(t.requester_id ?? t.created_by ?? '')?.name ?? 'A teammate'
        const open = () => navigate('tickets', { open: t.id })
        toast(`New ticket from ${from}: “${t.title}”. It goes on your calendar once you accept.`, 'notify', {
          label: 'Review',
          onClick: open,
        })
        desktopAlert(`New ticket from ${from}`, `${t.title} · ${formatTimeRange(t.start_at, t.end_at, zone)}`, t.id, open)
      } else {
        const u = n.update
        const who = people.get(u.actor_id ?? '')?.name ?? 'Someone'
        const what = ACTIVITY_LABEL[u.activity_type] ?? 'Updated'
        const title = `“${u.tasks.title}”`
        const line =
          {
            assignment_accepted: `${who} accepted ${title}.`,
            assignment_declined: `${who} declined ${title}.`,
            time_suggested: `${who} suggested a new time for ${title}.`,
            request_confirmed: `${title} is confirmed — everyone accepted.`,
            request_needs_revision: `${title} needs revision.`,
          }[u.activity_type] ?? `${what}: ${title}`
        const open = () => navigate('tickets', { open: u.task_id, tab: 'raised' })
        toast(line, 'notify', { label: 'View', onClick: open })
        desktopAlert(what, line, u.id, open)
      }
    },
    [people, zone, toast, navigate],
  )
  const notif = useNotifications(me.user_id, onNotice)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [exportRange, setExportRange] = useState<{ from: string; to: string } | null>(null)
  const [teamOpen, setTeamOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const isRequester = me.role === 'requester'

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1')
      } catch {
        /* per-browser convenience only */
      }
      return !c
    })

  // Keyboard: Ctrl/Cmd + B toggles the sidebar.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  const openFromNotification = useCallback(
    (t: Task | string) => {
      const id = typeof t === 'string' ? t : t.id
      navigate('tickets', { open: id })
    },
    [navigate],
  )

  const api = useMemo<ShellApi>(
    () => ({
      route,
      navigate,
      openExport: (range) => setExportRange(range ?? { from: '', to: '' }),
      openTeam: () => setTeamOpen(true),
      openProfile: () => setProfileOpen(true),
      signOut: onSignOut,
      notif,
      openFromNotification,
    }),
    [route, navigate, notif, openFromNotification, onSignOut],
  )

  const nav: { name: RouteName; label: string; icon: ReactNode; badge?: number }[] = [
    ...(!isRequester ? [{ name: 'calendar' as const, label: 'Calendar', icon: <CalendarDays size={19} /> }] : []),
    { name: 'tickets', label: 'Tickets', icon: <Ticket size={19} />, badge: notif.pending.length },
  ]

  return (
    <ShellContext.Provider value={api}>
      <div className="flex h-full">
        {!isMobile ? (
          <nav
            aria-label="Main"
            className={cx(
              'relative z-30 flex shrink-0 flex-col bg-ink py-4 transition-[width] duration-200 ease-out',
              collapsed ? 'w-[72px]' : 'w-[232px]',
            )}
          >
            <div className={cx('mb-5 flex h-11 items-center', collapsed ? 'justify-center px-0' : 'px-4')}>
              <div
                className={cx(
                  'flex h-11 items-center justify-center overflow-hidden rounded-2xl bg-white transition-[width] duration-200 ease-out',
                  collapsed ? 'w-11' : 'w-full px-3',
                )}
              >
                {collapsed ? <Logo compact /> : <Logo className="h-6" />}
              </div>
            </div>

            <div className={cx('flex flex-col gap-1', collapsed ? 'items-center px-0' : 'px-3')}>
              {nav.map((n) => (
                <RailItem
                  key={n.name}
                  label={n.label}
                  icon={n.icon}
                  badge={n.badge}
                  collapsed={collapsed}
                  active={route === n.name}
                  onClick={() => navigate(n.name)}
                />
              ))}
              <div className={cx('my-2 h-px bg-white/10', collapsed ? 'w-8' : 'mx-1')} />
              <RailItem
                label="New ticket"
                icon={<Plus size={19} />}
                collapsed={collapsed}
                active={route === 'new-ticket'}
                onClick={() => navigate('new-ticket')}
              />
              <RailItem label="Export to Excel" icon={<FileSpreadsheet size={19} />} collapsed={collapsed} onClick={() => api.openExport()} />
              {me.role === 'admin' ? (
                <RailItem label="Manage team" icon={<Users size={19} />} collapsed={collapsed} onClick={() => setTeamOpen(true)} />
              ) : null}
            </div>

            <span className="flex-1" />

            <div className={cx('flex flex-col gap-1', collapsed ? 'items-center px-0' : 'px-3')}>
              <RailItem label="Profile & time zone" icon={<Settings size={19} />} collapsed={collapsed} onClick={() => setProfileOpen(true)} />
              <RailItem label="Sign out" icon={<LogOut size={19} />} collapsed={collapsed} onClick={onSignOut} />
              <RailItem
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                hint="Ctrl B"
                icon={collapsed ? <ChevronsRight size={19} /> : <ChevronsLeft size={19} />}
                collapsed={collapsed}
                onClick={toggle}
              />
            </div>
          </nav>
        ) : null}

        <div key={route} className="anim-page flex min-w-0 flex-1 flex-col">
          {children}
        </div>
      </div>

      {exportRange ? (
        <ExportDialog
          open
          onClose={() => setExportRange(null)}
          visibleStart={exportRange.from || undefined}
          visibleEnd={exportRange.to || undefined}
        />
      ) : null}
      {teamOpen ? <TeamDialog open onClose={() => setTeamOpen(false)} /> : null}
      {profileOpen ? <ProfileDialog open onClose={() => setProfileOpen(false)} onSaved={reloadMe} /> : null}
    </ShellContext.Provider>
  )
}

function RailItem({
  label,
  icon,
  collapsed,
  active,
  badge,
  hint,
  onClick,
}: {
  label: string
  icon: ReactNode
  collapsed: boolean
  active?: boolean
  badge?: number
  hint?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={collapsed ? (hint ? `${label} (${hint})` : label) : hint}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cx(
        'group relative flex h-11 shrink-0 items-center rounded-2xl text-sm font-medium transition-colors duration-150',
        collapsed ? 'w-11 justify-center' : 'w-full gap-3 px-3',
        active ? 'bg-white/12 text-white' : 'text-white/60 hover:bg-white/8 hover:text-white',
      )}
    >
      <span className="relative flex shrink-0 items-center justify-center">
        {icon}
        {badge && collapsed ? (
          <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-ember px-1 text-[9.5px] font-bold text-white ring-2 ring-ink">
            {badge > 9 ? '9+' : badge}
          </span>
        ) : null}
      </span>
      {!collapsed ? (
        <>
          <span className="anim-fade min-w-0 flex-1 truncate text-left">{label}</span>
          {badge ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-ember px-1.5 text-[10.5px] font-bold text-white">
              {badge > 9 ? '9+' : badge}
            </span>
          ) : hint ? (
            <span className="text-[10.5px] text-white/35">{hint}</span>
          ) : null}
        </>
      ) : null}
      {active ? <span className="absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-r-full bg-apricot" aria-hidden /> : null}
    </button>
  )
}

// ── Top bar ────────────────────────────────────────────────────────────────

/** Page header: title on the left, page actions, then notifications and the account menu. */
export function TopBar({ title, actions, leading }: { title: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  const { me, isMobile, zone } = useApp()
  const shell = useShell()
  const [menuOpen, setMenuOpen] = useState(false)
  const isRequester = me.role === 'requester'

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-ivory px-4 md:gap-3 md:px-6">
      {isMobile ? <Logo compact /> : null}
      {leading}
      <h1 className="min-w-0 truncate font-display text-base font-bold text-ink md:text-[17px]">{title}</h1>
      <span className="flex-1" />
      {actions}
      {isMobile && !isRequester ? <MobileNavSwitch /> : null}
      <NotificationsPopover
        pending={shell.notif.pending}
        requests={shell.notif.requests}
        updates={shell.notif.updates}
        badge={shell.notif.badge}
        seenAt={shell.notif.seenAt}
        onOpen={() => void shell.notif.reload()}
        onMarkSeen={shell.notif.markSeen}
        onOpenTask={shell.openFromNotification}
      />
      <div className="relative">
        <button
          type="button"
          aria-label="Account menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="flex rounded-full ring-offset-2 ring-offset-ivory transition-shadow hover:ring-2 hover:ring-line-strong"
        >
          <Avatar id={me.user_id} name={me.name} size={isMobile ? 32 : 36} />
        </button>
        <Popover open={menuOpen} onClose={() => setMenuOpen(false)} className="w-64 p-2">
          <div className="px-3 pt-2 pb-2.5">
            <p className="truncate text-sm font-semibold">{me.name}</p>
            <p className="truncate text-xs text-stone">{me.email}</p>
            <p className="mt-1 text-[11px] text-ash capitalize">
              {me.role} · {zone}
            </p>
          </div>
          <div className="mx-1 mb-1 border-t border-line" />
          <MenuButton icon={<Settings size={15} />} onClick={() => (setMenuOpen(false), shell.openProfile())}>
            Profile & time zone
          </MenuButton>
          {me.role === 'admin' ? (
            <MenuButton icon={<Users size={15} />} onClick={() => (setMenuOpen(false), shell.openTeam())}>
              Manage team
            </MenuButton>
          ) : null}
          {isMobile ? (
            <MenuButton icon={<FileSpreadsheet size={15} />} onClick={() => (setMenuOpen(false), shell.openExport())}>
              Export to Excel
            </MenuButton>
          ) : null}
          <MenuButton icon={<LogOut size={15} />} onClick={() => shell.signOut()}>
            Sign out
          </MenuButton>
        </Popover>
      </div>
    </header>
  )
}

function MobileNavSwitch() {
  const shell = useShell()
  const onTickets = shell.route !== 'calendar'
  return (
    <div className="flex rounded-xl border border-line bg-canvas p-0.5" role="tablist" aria-label="Section">
      <button
        type="button"
        role="tab"
        aria-selected={!onTickets}
        aria-label="Calendar"
        onClick={() => shell.navigate('calendar')}
        className={cx('flex h-8 w-9 items-center justify-center rounded-[10px]', !onTickets ? 'bg-white text-ink shadow-sm' : 'text-ash')}
      >
        <CalendarDays size={16} />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={onTickets}
        aria-label="Tickets"
        onClick={() => shell.navigate('tickets')}
        className={cx('relative flex h-8 w-9 items-center justify-center rounded-[10px]', onTickets ? 'bg-white text-ink shadow-sm' : 'text-ash')}
      >
        <Ticket size={16} />
        {shell.notif.pending.length ? <span className="absolute top-1 right-1.5 h-2 w-2 rounded-full bg-ember ring-2 ring-canvas" /> : null}
      </button>
    </div>
  )
}

function MenuButton({ icon, onClick, children }: { icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-canvas">
      <span className="text-ash">{icon}</span>
      {children}
    </button>
  )
}
