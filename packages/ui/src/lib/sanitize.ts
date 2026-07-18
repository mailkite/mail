import DOMPurify from 'dompurify'
import type { AttachmentMeta } from '@mailkite/core'

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

// Normalize a Content-ID for matching: strip an optional `cid:` scheme, the surrounding angle
// brackets headers store (`<id@host>` vs the body's `cid:id@host`), and case.
function normalizeCid(raw: string): string {
  return raw.trim().replace(/^cid:/i, '').replace(/^<|>$/g, '').toLowerCase()
}

/**
 * Rewrite inline `<img src="cid:...">` references to their attachment byte urls, so inline images
 * actually load. Run this on the raw HTML BEFORE sanitizeEmailHtml. Inline parts carry a
 * `contentId`; the body points at them with `cid:<contentId>`. Unmatched cids get their src
 * stripped so the browser doesn't fire a doomed request to a `cid:` URL (a broken image).
 */
export function rewriteInlineCids(html: string, attachments?: AttachmentMeta[]): string {
  if (!/cid:/i.test(html)) return html
  const byCid = new Map<string, string>()
  for (const a of attachments ?? []) {
    if (a.contentId) byCid.set(normalizeCid(a.contentId), a.url)
  }
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (!src || !/^cid:/i.test(src)) continue
    const url = byCid.get(normalizeCid(src))
    if (url) img.setAttribute('src', url)
    else img.removeAttribute('src')
  }
  return doc.body.innerHTML
}
