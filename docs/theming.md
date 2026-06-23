# MailKite Mail — Theming & design themes

> **One-liner:** Users pick a **design theme** — a named preset bundling a colour palette, a
> background style, a corner radius (and optional font), in both light and dark — and can override
> the accent and background on top. It's all **CSS variables** applied at runtime and persisted per
> user, so any palette or background works with **no rebuild**. This is exactly what shadcn/ui's
> CSS-variable model gives us, and the reason we chose it over DaisyUI.

See [`stack.md`](stack.md) (UI stack), [`features.md`](features.md) (settings tier),
[`data-model.md`](data-model.md) (where the per-user theme is stored).

## 1. Principle

shadcn/ui components don't carry a fixed look — they read **CSS custom properties**
(`--background`, `--foreground`, `--primary`, `--card`, `--border`, `--ring`, `--radius`, …). A
theme is just a set of values for those variables. So "let users choose a design theme" reduces to
"swap a set of CSS variables at runtime" — no recompile, no component edits.

> **Decision (2026-06): shadcn/ui, not DaisyUI.** shadcn = owned components + pure CSS-variable
> theming → unlimited custom palettes **and** custom background styles **and** per-user runtime
> config. DaisyUI's class-based themes are quick but constrain palettes and impose their own look.
> For a user-configurable "design themes" feature, the CSS-variable model wins.

## 2. The three token layers

All defined with Tailwind CSS 4's inline `@theme` + `:root` / `[data-theme]` blocks in
`packages/ui`:

| Layer | Examples | Owner |
|---|---|---|
| **shadcn primitives** | `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--card`, `--popover`, `--border`, `--input`, `--ring`, `--radius` | the design theme |
| **Brand/utility** | `--color-accent` `#6ea8fe`, `--color-accent-2` `#7c6cff` (the website tokens), gradient helpers | the design theme (default = MailKite) |
| **Background style** | `--bg-style` + helper classes (`.bg-solid`, `.bg-gradient`, `.bg-glow`, `.bg-grid`) | the user's bg-style choice |

## 3. What a "design theme" is

A preset is a plain object — light + dark variable maps plus metadata:

```ts
// packages/ui/src/theme/presets.ts
export interface DesignTheme {
  id: string                 // "mailkite"
  name: string               // "MailKite"
  radius: string             // "0.5rem"
  font?: string
  bgStyle: BgStyle           // default background treatment
  light: Record<string, string>  // CSS-var name → value
  dark: Record<string, string>
}
export type BgStyle = 'solid' | 'gradient' | 'glow' | 'grid'
```

Shipped presets (initial set — final list TBD with you):

| Preset | Vibe | Default bg |
|---|---|---|
| **MailKite** (default) | Brand — deep navy, blue→purple accent | `glow` |
| Midnight | Pure dark, high contrast | `solid` |
| Paper | Warm light, minimal | `solid` |
| Terminal | Mono, green accent | `grid` |

Each ships **both** light and dark variable maps; the default is **MailKite** using the website's
`#0b0d12` / `#6ea8fe` / `#7c6cff`.

## 4. Background styles

Independent of palette, the user picks a background treatment (lifted from the website's brand CSS):

| Style | Implementation |
|---|---|
| `solid` | flat `--background` |
| `gradient` | subtle two-stop gradient |
| `glow` | radial brand glow (website `.brand-glow`) |
| `grid` | faint grid backdrop (website `.grid-bg`) |

## 5. Per-user configuration model

Stored in the own store (see [`data-model.md`](data-model.md)) on the user/settings row:

```ts
interface ThemeSettings {
  themeId: string            // preset id
  mode: 'light' | 'dark' | 'system'
  accent?: string            // optional hex override of --primary/accent
  bgStyle?: BgStyle          // optional override of the preset default
}
```

- **`ThemeProvider`** (`packages/ui/src/theme/`) resolves the active preset + mode, writes the
  variable map to `:root` via a `data-theme` attribute, applies `accent`/`bgStyle` overrides as
  inline vars, and persists the choice (server settings + a local mirror for instant load).
- **`mode: 'system'`** follows `prefers-color-scheme` and reacts to OS changes.
- **No flash of wrong theme:** a tiny inline head script sets `data-theme` from the local mirror
  before first paint (works for the Workers-served SPA and the Tauri shells alike).
- **Settings UI** (a theme picker: preset gallery + light/dark/system toggle + accent swatch + bg
  style) lands in the Settings screen.

## 6. Where it lives & when it's built

```
packages/ui/src/theme/
  global.css          # COPIED VERBATIM from the website — brand tokens, light/dark
                      #   switch, and every brand helper (.text-gradient, .brand-glow,
                      #   .grid-bg, .gradient-ring, .eyebrow, .docs-prose, …)
  shadcn.css          # shadcn primitive vars (--background, --primary, …) mapped
                      #   onto the brand tokens, so components inherit light/dark free
  presets.ts          # the DesignTheme presets (CSS-var maps); default = the above
  ThemeProvider.tsx    # applies + persists the active theme
  useTheme.ts          # hook: read/set themeId, mode, accent, bgStyle
```

> **Speed-up (2026-06): the default MailKite theme is the website's `global.css` copied
> verbatim** into `packages/ui/src/theme/`, plus the thin `shadcn.css` map — proven, on-brand,
> zero rebuild. Additional presets are layered on the same `data-theme` mechanism later.

| Concern | Phase |
|---|---|
| `ThemeProvider` + presets + default MailKite theme | **Phase 2** (Read UI — built into the shell from day one) |
| Theme-picker Settings UI + persistence | **Phase 4** (Organize/settings) |
| Per-shell parity (Tauri webviews honour the same vars) | **Phases 7–8** |

> **Decision (2026-06):** the theme engine is part of `packages/ui` from the **first** UI phase, not
> retrofitted — every component is built reading the CSS-variable tokens, so adding presets later is
> free.
