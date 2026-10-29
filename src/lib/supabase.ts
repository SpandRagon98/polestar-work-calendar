import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

// Accept a pasted URL with a path (e.g. ".../rest/v1/") — the client needs the origin only.
const url = (() => {
  try {
    return rawUrl ? new URL(rawUrl).origin : undefined
  } catch {
    return undefined
  }
})()

export const supabaseConfigured = Boolean(url && key)

/**
 * What an auth email link brought the user here for, captured before supabase-js
 * reads (and clears) the URL:
 *  • `token_hash` links (our email templates) — verified only when the person
 *    clicks a button, so corporate link scanners can't use up the invite;
 *  • implicit links (Supabase's default templates) — tokens in the hash;
 *  • error redirects such as an expired or already-used link.
 */
export type AuthLink =
  | { kind: 'invite' | 'recovery'; tokenHash?: string }
  | { kind: 'error'; message: string }

export function parseAuthLink(href: string): AuthLink | null {
  const u = new URL(href)
  const hash = new URLSearchParams(u.hash.replace(/^#\/?/, ''))
  const q = u.searchParams
  const qType = q.get('type')
  const tokenHash = q.get('token_hash')
  if (tokenHash && (qType === 'invite' || qType === 'recovery')) return { kind: qType, tokenHash }
  const hType = hash.get('type')
  if (hash.get('access_token') && (hType === 'invite' || hType === 'recovery')) return { kind: hType }
  const error = hash.get('error_description') ?? q.get('error_description')
  if (error) return { kind: 'error', message: friendlyLinkError(error, hash.get('error_code') ?? q.get('error_code')) }
  return null
}

function friendlyLinkError(description: string, code: string | null): string {
  if (code === 'otp_expired' || /expired|invalid/i.test(description)) {
    return 'This link has expired or was already used. Ask your admin to send a new invite, or use “Forgot password?”.'
  }
  return description
}

export const initialAuthLink: AuthLink | null = (() => {
  if (typeof window === 'undefined') return null
  const link = parseAuthLink(window.location.href)
  // Token-hash and error links are handled by the app; tidy the address bar right away.
  if (link && (link.kind === 'error' || ('tokenHash' in link && link.tokenHash))) {
    window.history.replaceState(null, '', window.location.pathname)
  }
  return link
})()

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** Where auth emails send people back to: works locally and under /<repo>/ on GitHub Pages. */
export function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString()
}
