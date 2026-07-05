import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_THEME_ID, PRESET_IDS, type ThemeMode } from './presets'

interface ThemeState {
  /** light | dark | system (system follows the OS preference). */
  mode: ThemeMode
  /** The concrete light/dark value in effect right now. */
  resolved: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
  /** The active color theme id (see PRESETS). */
  preset: string
  setPreset: (id: string) => void
}

const ThemeCtx = createContext<ThemeState | null>(null)
const MODE_KEY = 'mailkite.theme.mode'
const PRESET_KEY = 'mailkite.theme.preset'

function systemPref(): 'light' | 'dark' {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function resolve(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? systemPref() : mode
}

function initialPreset(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID
  const stored = localStorage.getItem(PRESET_KEY)
  return stored && PRESET_IDS.includes(stored) ? stored : DEFAULT_THEME_ID
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Auto (system) by default — respects the OS light/dark preference until the
  // user explicitly picks light or dark.
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof localStorage === 'undefined') return 'system'
    return (localStorage.getItem(MODE_KEY) as ThemeMode | null) ?? 'system'
  })
  const [preset, setPreset] = useState<string>(initialPreset)
  const resolved = resolve(mode)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolve(mode))
    localStorage.setItem(MODE_KEY, mode)
  }, [mode])

  useEffect(() => {
    document.documentElement.setAttribute('data-preset', preset)
    localStorage.setItem(PRESET_KEY, preset)
  }, [preset])

  // When on 'system', track live OS changes.
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => document.documentElement.setAttribute('data-theme', systemPref())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return (
    <ThemeCtx.Provider value={{ mode, resolved, setMode, preset, setPreset }}>
      {children}
    </ThemeCtx.Provider>
  )
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
