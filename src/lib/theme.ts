// Colour themes. Colours live in src/index.css as [data-theme] token overrides;
// this list drives the picker in Profile. The choice is per browser, like the
// animation level. Status colours (in progress, completed…) stay the same in every
// theme, so they keep their meaning.

import { motionLevel } from './motion'

export type ThemeId = 'burgundy' | 'ocean' | 'forest' | 'plum' | 'rose' | 'graphite' | 'midnight' | 'espresso'

export interface Theme {
  id: ThemeId
  name: string
  tone: 'light' | 'dark'
  /** Sidebar, primary and accent, for the picker. */
  swatch: [string, string, string]
  /** Window title bar colour of the installed app. */
  bar: string
}

export const THEMES: Theme[] = [
  { id: 'burgundy', name: 'Burgundy', tone: 'light', swatch: ['#250b0b', '#5c0605', '#e8a35c'], bar: '#fdfdfd' },
  { id: 'ocean', name: 'Ocean', tone: 'light', swatch: ['#0b1f33', '#0d4a73', '#f0b35a'], bar: '#fdfeff' },
  { id: 'forest', name: 'Forest', tone: 'light', swatch: ['#0f2419', '#14533a', '#e3b34f'], bar: '#fdfefd' },
  { id: 'plum', name: 'Plum', tone: 'light', swatch: ['#211030', '#4b1a78', '#f0a9c0'], bar: '#fefdff' },
  { id: 'rose', name: 'Rose', tone: 'light', swatch: ['#2c0b1d', '#9d174d', '#fbbf77'], bar: '#fffdfe' },
  { id: 'graphite', name: 'Graphite', tone: 'light', swatch: ['#16191d', '#2b3038', '#f59e42'], bar: '#fdfdfe' },
  { id: 'midnight', name: 'Midnight', tone: 'dark', swatch: ['#0c0e16', '#6472f0', '#f0b35a'], bar: '#181a24' },
  { id: 'espresso', name: 'Espresso', tone: 'dark', swatch: ['#120a09', '#b5432f', '#e8a35c'], bar: '#211714' },
]

const KEY = 'pwc.theme'

export function readTheme(): ThemeId {
  try {
    const v = localStorage.getItem(KEY)
    return THEMES.find((t) => t.id === v)?.id ?? 'burgundy'
  } catch {
    return 'burgundy'
  }
}

/** Apply a theme to <html data-theme data-tone> (CSS keys off them). */
export function applyTheme(id: ThemeId = readTheme()): void {
  const theme = THEMES.find((t) => t.id === id) ?? THEMES[0]
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.dataset.tone = theme.tone
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bar)
}

/** Save and apply; with full motion the whole app cross-fades to the new colours. */
export function setTheme(id: ThemeId): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* preferences are a convenience */
  }
  const doc = document as Document & { startViewTransition?: (fn: () => void) => unknown }
  if (motionLevel() === 'full' && doc.startViewTransition) doc.startViewTransition(() => applyTheme(id))
  else applyTheme(id)
}
