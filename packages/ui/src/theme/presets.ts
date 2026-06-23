export type BgStyle = 'solid' | 'gradient' | 'glow' | 'grid'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface DesignTheme {
  id: string
  name: string
  bgStyle: BgStyle
}

/** Phase 2 ships the default; more presets (Midnight/Paper/Terminal) land in Phase 4. */
export const PRESETS: DesignTheme[] = [{ id: 'mailkite', name: 'MailKite', bgStyle: 'glow' }]
export const DEFAULT_THEME_ID = 'mailkite'
