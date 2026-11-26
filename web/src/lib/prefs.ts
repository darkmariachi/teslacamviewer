import { useSyncExternalStore } from 'react'

/** Preferences that belong to this browser (or the desktop app's window), not the server: each device keeps its own. */
export interface Prefs {
  theme: 'system' | 'dark' | 'light'
  speedUnit: 'mph' | 'kmh'
  /** Show the car's driving data over the video when the clips have it. */
  hud: boolean
}

const KEY = 'teslacam.prefs'

// Most of the world reads km/h; the US and the UK read mph.
const defaultUnit = (): Prefs['speedUnit'] => (/-(US|GB|LR|MM)\b/i.test(navigator.language) ? 'mph' : 'kmh')

function load(): Prefs {
  const base: Prefs = { theme: 'system', speedUnit: defaultUnit(), hud: true }
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }
  } catch {
    return base
  }
}

let current = load()
const listeners = new Set<() => void>()

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Private windows may refuse storage; the choice still holds until reload.
  }
  if (key === 'theme') applyTheme()
  for (const l of listeners) l()
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

const darkQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function resolvedTheme(): 'dark' | 'light' {
  if (current.theme !== 'system') return current.theme
  return darkQuery?.matches === false ? 'light' : 'dark'
}

/** Puts the chosen theme on <html>; index.html does the same before the app loads so the page never flashes. */
export function applyTheme() {
  const theme = resolvedTheme()
  document.documentElement.classList.toggle('light', theme === 'light')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f4f6' : '#0a0a0b')
  for (const l of themeListeners) l()
}

const themeListeners = new Set<() => void>()
darkQuery?.addEventListener('change', () => {
  if (current.theme === 'system') applyTheme()
})

/** The theme actually showing ('system' resolved), for things drawn outside CSS such as map styles. */
export function useResolvedTheme(): 'dark' | 'light' {
  return useSyncExternalStore(
    (l) => {
      themeListeners.add(l)
      return () => themeListeners.delete(l)
    },
    resolvedTheme,
  )
}
