// Sandbox stand-in for src/lib/supabase.ts (vite --mode sandbox only).
import { SANDBOX_USERS, getDb } from './db'

export const supabaseConfigured = true
export type AuthLink = { kind: 'invite' | 'recovery'; tokenHash?: string } | { kind: 'error'; message: string }
export const initialAuthLink: AuthLink | null = null
export function appUrl(): string {
  return window.location.href
}

const KEY = 'pwc.sandbox.user'
type Session = { user: { id: string; email: string } }
type AuthListener = (event: string, session: Session | null) => void
const listeners = new Set<AuthListener>()

function session(): Session | null {
  try {
    const id = localStorage.getItem(KEY)
    const u = SANDBOX_USERS.find((x) => x.id === id)
    return u ? { user: { id: u.id, email: u.email } } : null
  } catch {
    return null
  }
}

// ── Simulated Realtime (single tab) ─────────────────────────────────────────
type Handler = { filter: { event: string; table: string; filter?: string }; cb: (p: unknown) => void }
class Channel {
  handlers: Handler[] = []
  on(_type: string, filter: Handler['filter'], cb: Handler['cb']) {
    this.handlers.push({ filter, cb })
    return this
  }
  subscribe(cb?: (status: string) => void) {
    cb?.('SUBSCRIBED')
    return this
  }
}
const channels = new Set<Channel>()

export function emit(table: string, eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) {
  for (const c of channels) {
    for (const h of c.handlers) {
      if (h.filter.table !== table) continue
      if (h.filter.event !== '*' && h.filter.event !== eventType) continue
      if (h.filter.filter) {
        const [col, rest] = h.filter.filter.split('=eq.')
        if (String(row[col]) !== rest) continue
      }
      setTimeout(() => h.cb({ eventType, new: row, old: row }), 0)
    }
  }
}

export const supabase = {
  auth: {
    async getSession() {
      await getDb()
      return { data: { session: session() } }
    },
    onAuthStateChange(cb: AuthListener) {
      listeners.add(cb)
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      const u = SANDBOX_USERS.find((x) => x.email === email.trim().toLowerCase())
      if (!u) return { error: { message: `Sandbox users: ${SANDBOX_USERS.map((x) => x.email).join(', ')}` } }
      localStorage.setItem(KEY, u.id)
      listeners.forEach((l) => l('SIGNED_IN', session()))
      return { error: null }
    },
    async signOut() {
      localStorage.removeItem(KEY)
      listeners.forEach((l) => l('SIGNED_OUT', null))
      return { error: null }
    },
    async resetPasswordForEmail() {
      return { error: null }
    },
    async updateUser() {
      return { error: null }
    },
    async verifyOtp() {
      return { error: { message: 'Email links are not available in the sandbox.' } }
    },
  },
  channel() {
    const c = new Channel()
    channels.add(c)
    return c
  },
  async removeChannel(c: Channel) {
    channels.delete(c)
  },
}

if (typeof document !== 'undefined') {
  const bar = document.createElement('div')
  bar.textContent = 'Local sandbox — in-browser database, resets on reload. Not connected to Supabase.'
  bar.setAttribute(
    'style',
    'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:70;background:#250B0B;color:#E5B69C;font:600 11px Inter,sans-serif;padding:4px 12px;border-radius:999px;pointer-events:none;opacity:.85',
  )
  document.body.appendChild(bar)
}
