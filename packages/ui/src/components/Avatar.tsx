import { cn } from '../lib/cn'

/** Stable hue (0–359) derived from a string, so each address keeps its colour. */
function hueOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

/**
 * Round avatar for a user. Shows their Google picture when we have one,
 * otherwise a deterministic gradient with the email's first letter.
 */
export function Avatar({
  email,
  src,
  size = 28,
  className,
}: {
  email: string
  src?: string | null
  size?: number
  className?: string
}) {
  const initial = (email.trim()[0] ?? '?').toUpperCase()
  const hue = hueOf(email.toLowerCase())

  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={cn('shrink-0 rounded-full object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', className)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `linear-gradient(135deg, hsl(${hue} 68% 55%), hsl(${(hue + 40) % 360} 68% 42%))`,
      }}
    >
      {initial}
    </span>
  )
}
