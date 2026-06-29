import { cn } from '../../lib/cn'

/** Keyboard-shortcut pill — shared by the rail menu items and the list toolbar. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-grid min-w-[18px] place-items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
