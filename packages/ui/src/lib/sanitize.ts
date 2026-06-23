import DOMPurify from 'dompurify'

/**
 * Sanitize untrusted email HTML before rendering. Strips scripts, styles,
 * frames, forms, and event handlers; forces links to open safely.
 * (Remote-image proxying + a strict CSP are layered in Phase 9 hardening.)
 */
export function sanitizeEmailHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcset', 'onerror', 'onload', 'onclick', 'style'],
    ADD_ATTR: ['target', 'rel'],
  })
  return clean
}
