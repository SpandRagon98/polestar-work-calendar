import { useCallback, useEffect, useMemo, useState } from 'react'
import { DatabaseZap, ShieldAlert } from 'lucide-react'
import { supabaseConfigured, initialAuthLinkType } from './lib/supabase'
import { fetchProfiles } from './lib/api'
import type { Profile } from './lib/types'
import { browserZone } from './lib/time'
import { AppContext, useMediaQuery, type AppContextValue } from './context'
import { useAuth } from './hooks/useAuth'
import { AuthLayout, AuthScreen, SetPasswordScreen } from './components/AuthScreen'
import { CalendarPage } from './components/CalendarPage'
import { FeedbackProvider } from './components/ui/feedback'
import { Button, Logo, Spinner } from './components/ui/primitives'

export default function App() {
  return (
    <FeedbackProvider>
      {supabaseConfigured ? <Root /> : <NotConfigured />}
    </FeedbackProvider>
  )
}

function Root() {
  const auth = useAuth()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [profiles, setProfiles] = useState<Profile[]>([])

  const loadProfiles = useCallback(async () => {
    setProfiles(await fetchProfiles())
  }, [])

  const active = auth.profile?.active
  useEffect(() => {
    if (active) void loadProfiles().catch(() => undefined)
  }, [active, loadProfiles])

  const { profile, reloadProfile } = auth
  const ctx = useMemo<AppContextValue | null>(() => {
    if (!profile) return null
    return {
      me: profile,
      profiles,
      people: new Map(profiles.map((p) => [p.user_id, p])),
      zone: profile.timezone || browserZone(),
      isMobile,
      reloadProfiles: async () => {
        await loadProfiles()
        await reloadProfile()
      },
    }
  }, [profile, reloadProfile, profiles, isMobile, loadProfiles])

  if (!auth.ready) return <FullScreenSpinner />
  if (!auth.session) return <AuthScreen />
  if (auth.mustSetPassword) {
    return <SetPasswordScreen isInvite={initialAuthLinkType === 'invite'} onDone={auth.passwordSet} />
  }
  if (auth.profileLoading && !auth.profile) return <FullScreenSpinner />
  if (!auth.profile || !auth.profile.active || auth.profileError) {
    return (
      <AuthLayout>
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-st-pending/10 text-st-pending">
          <ShieldAlert size={20} />
        </div>
        <h1 className="font-display text-2xl font-bold">
          {auth.profileError ? 'Couldn’t load your account' : 'Your account isn’t active'}
        </h1>
        <p className="mt-2 text-sm text-ash">
          {auth.profileError ?? 'Ask an admin to activate your account, then sign in again.'}
        </p>
        <div className="mt-6 flex gap-2">
          {auth.profileError ? <Button onClick={() => void auth.reloadProfile()}>Try again</Button> : null}
          <Button variant="primary" onClick={() => void auth.signOut()}>
            Sign out
          </Button>
        </div>
      </AuthLayout>
    )
  }
  if (!ctx) return <FullScreenSpinner />

  return (
    <AppContext.Provider value={ctx}>
      <CalendarPage key={ctx.zone} onSignOut={() => void auth.signOut()} reloadMe={ctx.reloadProfiles} />
    </AppContext.Provider>
  )
}

function FullScreenSpinner() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-ivory">
      <Logo className="h-9" />
      <Spinner className="h-5 w-5 text-maroon" />
    </div>
  )
}

function NotConfigured() {
  return (
    <AuthLayout>
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-peach-50 text-maroon">
        <DatabaseZap size={20} />
      </div>
      <h1 className="font-display text-2xl font-bold">Connect Supabase</h1>
      <p className="mt-2 text-sm text-ash">
        This build has no Supabase settings. Set <code className="rounded bg-canvas px-1">VITE_SUPABASE_URL</code> and{' '}
        <code className="rounded bg-canvas px-1">VITE_SUPABASE_PUBLISHABLE_KEY</code> in <code>.env.local</code> (local) or as
        GitHub Actions variables (deployment), then rebuild. See the README.
      </p>
    </AuthLayout>
  )
}
