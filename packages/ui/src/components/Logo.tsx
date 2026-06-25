import { useId } from 'react'

/** The MailKite kite mark — a gradient diamond kite with spars + a wavy tail.
 *  Used as the default logo and the favicon source. */
export function KiteMark({ className }: { className?: string }) {
  const id = useId()
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={id} x1="4" y1="3" x2="20" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6ea8fe" />
          <stop offset="1" stopColor="#7c6cff" />
        </linearGradient>
      </defs>
      <path d="M12 2.5 19 9 12 17 5 9Z" fill={`url(#${id})`} />
      <path d="M12 2.5V17M5 9h14" stroke="#fff" strokeOpacity=".5" strokeWidth=".7" />
      <path d="M12 17q2 1.4 0 2.8t0 2.8" stroke={`url(#${id})`} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </svg>
  )
}

/** App logo: the configured logo image (or the default kite mark) + the app
 *  name. Both are configurable in Settings; defaults to the MailKite kite +
 *  "MailKite Mail". */
export function Logo({
  name = 'MailKite Mail',
  logoUrl,
  className,
}: {
  name?: string
  logoUrl?: string
  className?: string
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      {logoUrl ? (
        <img src={logoUrl} alt={name} className="h-6 w-6 rounded object-contain" />
      ) : (
        <KiteMark className="h-6 w-6" />
      )}
      <span className="text-gradient text-lg font-semibold whitespace-nowrap">{name}</span>
    </span>
  )
}
