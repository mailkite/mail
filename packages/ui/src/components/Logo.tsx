/** The MailKite mark — the "sail kite": duotone blue/violet sails + a webhook
 *  string with a dot. Transparent, so it reads on light or dark. Used as the
 *  default logo and the favicon source. */
export function KiteMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="13 6 38 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={['overflow-visible', className].filter(Boolean).join(' ')}
    >
      <path d="M32 6 L32 46 L13 23 Z" fill="#5b9bff" />
      <path d="M32 6 L51 23 L32 46 Z" fill="#7c6cff" />
      <path d="M32 46 C 35 52 41 53 45 58" stroke="#5b9bff" strokeWidth={3} strokeLinecap="round" />
      <circle cx="45" cy="58" r="3" fill="#5b9bff" />
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
