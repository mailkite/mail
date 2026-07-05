import { cn } from '../../lib/cn'

/** Keyboard-shortcut pill — shared by the rail menu items and the list toolbar. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-grid min-w-[18px] place-items-center rounded bg-[color-mix(in_oklab,var(--color-border)_35%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-muted)] ring-1 ring-[var(--color-border)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
