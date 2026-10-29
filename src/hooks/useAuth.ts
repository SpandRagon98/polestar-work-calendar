import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { initialAuthLinkType, supabase } from '../lib/supabase'
import { fetchMyProfile, toApiError, updateMyProfile } from '../lib/api'
import { browserZone } from '../lib/time'
import type { Profile } from '../lib/types'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [mustSetPassword, setMustSetPassword] = useState(initialAuthLinkType !== null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      setReady(true)
      if (event === 'PASSWORD_RECOVERY') setMustSetPassword(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id

  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      return
    }
    setProfileLoading(true)
    setProfileError(null)
    try {
      let p = await fetchMyProfile(userId)
      // Record the browser's time zone the first time someone signs in.
      if (p && p.active && !p.timezone) {
        await updateMyProfile({ timezone: browserZone() })
        p = await fetchMyProfile(userId)
      }
      setProfile(p)
    } catch (e) {
      setProfileError(toApiError(e).message)
    } finally {
      setProfileLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  return {
    session,
    ready,
    profile,
    profileLoading,
    profileError,
    reloadProfile: loadProfile,
    signOut,
    mustSetPassword,
    passwordSet: () => {
      setMustSetPassword(false)
      history.replaceState(null, '', window.location.pathname + window.location.search)
    },
  }
}
