import type { InputHTMLAttributes, ReactNode } from 'react'
import { Logo } from './Logo'

// Centered card used by the auth screens — same chrome, different form.
export function AuthScreen({
  title,
  subtitle,
  brandName,
  logoUrl,
  children,
}: {
  title: string
  subtitle?: ReactNode
  brandName?: string
  logoUrl?: string
  children: ReactNode
}) {
  return (
    <div className="h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)] p-4">
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] p-6 shadow-lg">
        <div className="mb-5 text-center">
          <div className="flex justify-center">
            <Logo name={brandName} logoUrl={logoUrl} />
          </div>
          <h1 className="mt-3 text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-[var(--color-muted)]">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-[var(--color-muted)]">{label}</span>
      <input
        {...props}
        className="w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  )
}
