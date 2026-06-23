import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ThemeMode } from './presets'

interface ThemeState {
  mode: ThemeMode
  resolved: 'light' | 'dark'
  setMode: (m: ThemeMode) => void
}

const ThemeCtx = createContext<ThemeState | null>(null)
const STORAGE_KEY = 'mailkite.theme.mode'

function systemPref(): 'light' | 'dark' {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

function resolve(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? systemPref() : mode
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'dark'
  })
  const resolved = resolve(mode)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolve(mode))
    localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => document.documentElement.setAttribute('data-theme', systemPref())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return <ThemeCtx.Provider value={{ mode, resolved, setMode }}>{children}</ThemeCtx.Provider>
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeCtx)
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>')
  return ctx
}
