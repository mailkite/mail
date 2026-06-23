import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

type Variant = 'primary' | 'ghost'

export function Button({
  className,
  variant = 'primary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50',
        variant === 'primary' &&
          'bg-[var(--color-accent)] text-[#0b0d12] hover:opacity-90',
        variant === 'ghost' &&
          'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[color-mix(in_oklab,var(--color-border)_40%,transparent)]',
        className,
      )}
      {...props}
    />
  )
}
