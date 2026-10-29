import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

// Invite / password-recovery links land with tokens in the URL hash. Capture the
// link type before supabase-js consumes the hash so we can ask for a password.
export const initialAuthLinkType: 'invite' | 'recovery' | null = (() => {
  if (typeof window === 'undefined') return null
  const m = /[#&]type=(invite|recovery)/.exec(window.location.hash)
  return (m?.[1] as 'invite' | 'recovery') ?? null
})()

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 5 } },
})

/** Where auth emails send people back to: works locally and under /<repo>/ on GitHub Pages. */
export function appUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).toString()
}
