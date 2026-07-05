export type BgStyle = 'solid' | 'gradient' | 'glow' | 'grid'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface DesignTheme {
  id: string
  name: string
  /** One-line description shown under the name in the theme picker. */
  description: string
  bgStyle: BgStyle
  /** Representative colors (light mode) for the picker's mini preview. */
  swatch: { bg: string; panel: string; accent: string; accent2: string }
}

/**
 * Premade color themes. Each theme defines its full light + dark palette in
 * global.css keyed off `html[data-preset="<id>"]` (see ThemeProvider, which
 * sets both `data-preset` and `data-theme`). The first entry is the default.
 */
export const PRESETS: DesignTheme[] = [
  {
    id: 'mailkite',
    name: 'MailKite',
    description: 'Brand green — clean and confident.',
    bgStyle: 'glow',
    swatch: { bg: '#f0eef6', panel: '#ffffff', accent: '#008f4c', accent2: '#0a6e5c' },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Cool indigo — calm and focused.',
    bgStyle: 'gradient',
    swatch: { bg: '#f7f8fa', panel: '#ffffff', accent: '#4f46e5', accent2: '#7c3aed' },
  },
  {
    id: 'paper',
    name: 'Paper',
    description: 'Warm neutral — soft and easy on the eyes.',
    bgStyle: 'solid',
    swatch: { bg: '#faf8f4', panel: '#ffffff', accent: '#b45309', accent2: '#d97706' },
  },
]

export const DEFAULT_THEME_ID = 'mailkite'

/** Ids that have a matching palette in global.css. */
export const PRESET_IDS = PRESETS.map((p) => p.id)
