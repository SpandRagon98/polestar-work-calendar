import { useCallback, useEffect, useState } from 'react'

// Hash routes (#/calendar, #/tickets, #/tickets/new) work on GitHub Pages without
// server rewrites. Auth redirects also use the hash (#access_token=…); anything
// not starting with "#/" is left for supabase-js and treated as the default page.

export type RouteName = 'calendar' | 'tickets' | 'new-ticket'

export interface Route {
  name: RouteName | null
  params: URLSearchParams
}

const PATHS: Record<RouteName, string> = {
  calendar: '/calendar',
  tickets: '/tickets',
  'new-ticket': '/tickets/new',
}

export function parseRoute(hash: string): Route {
  if (!hash.startsWith('#/')) return { name: null, params: new URLSearchParams() }
  const [path, query = ''] = hash.slice(1).split('?')
  const name = (Object.keys(PATHS) as RouteName[]).find((r) => PATHS[r] === path) ?? null
  return { name, params: new URLSearchParams(query) }
}

export function routeHash(name: RouteName, params?: Record<string, string>): string {
  const qs = params ? new URLSearchParams(params).toString() : ''
  return `#${PATHS[name]}${qs ? `?${qs}` : ''}`
}

export function useRoute(): [Route, (name: RouteName, params?: Record<string, string>, replace?: boolean) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const navigate = useCallback((name: RouteName, params?: Record<string, string>, replace = false) => {
    const hash = routeHash(name, params)
    if (replace) {
      history.replaceState(null, '', window.location.pathname + window.location.search + hash)
      setRoute(parseRoute(hash))
    } else if (window.location.hash !== hash) {
      window.location.hash = hash
    }
  }, [])
  return [route, navigate]
}
