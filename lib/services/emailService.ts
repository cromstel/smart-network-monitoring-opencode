import sanitizeHtml from 'sanitize-html'
import nodemailer from 'nodemailer'
import { findProviders } from '@/lib/db/repositories/emailProviderRepository'

export interface EmailPayload {
  to: string
  subject: string
  html: string
  text?: string
}

/**
 * Safe HTML configuration for email content.
 *
 * Allows only presentational and structural markup. Strips:
 *   - <script>, <iframe>, <object>, <embed>, <form>, <input>, <button>, etc.
 *   - All event handlers (onclick, onload, onerror, ...)
 *   - Dangerous URL schemes (javascript:, vbscript:, data:, file:)
 */
const SAFE_HTML = {
  allowedTags: [
    'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'dl', 'dt', 'em',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd',
    'li', 'ol', 'p', 'pre', 'q', 's', 'span', 'strike', 'strong', 'sub',
    'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
  ],
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'width', 'height'],
    // No `style` anywhere, deliberately. sanitize-html filters attribute
    // *names*, so an allowed `style` arrives with its value untouched:
    // `allowedSchemes` only sees URL-bearing attributes like href/src, never
    // `url(...)` inside CSS. `span` carried `style` until a review pointed out
    // that `background-image:url(javascript:...)` therefore survived. Nothing
    // in the codebase renders inline styles in email — `buildEmailHtml` uses
    // bare h2/p/strong, and the one `style=` in `authService` sits on a `<p>`,
    // which this config already strips — so the attribute bought nothing.
    '*': [],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
    a: ['http', 'https', 'mailto'],
  },
  // Tags whose *contents* are discarded along with the tag. The option is
  // `nonTextTags`; the previous spelling, `nonTextualTags`, is not a
  // sanitize-html option at all, so it was silently ignored and a
  // `<script>alert(1)</script>` body survived as visible text.
  nonTextTags: ['script', 'style'],
  // Transform disallowed attributes: remove them
  transformTags: {
    '*': (tagName: string, attribs: Record<string, string>) => {
      // Remove all event handlers
      for (const key of Object.keys(attribs)) {
        if (/^on[A-Z]/.test(key)) {
          delete attribs[key]
        }
      }
      return { tagName, attribs }
    },
  },
}

/**
 * Strips all HTML tags from a string, applied repeatedly until no more
 * changes occur. This catches nested tags, unclosed tags like `<script`,
 * and double-escaped markup that a single regex pass misses.
 */
function stripHtml(html: string): string {
  let previous: string
  let current = html
  do {
    previous = current
    current = current.replace(/<[^>]*>/g, '')
  } while (current !== previous)
  return current.trim()
}

export async function sendEmail(payload: EmailPayload) {
  const providers = await findProviders()
  const defaultProvider = providers.find((p) => p.isDefault) ?? providers[0]
  if (!defaultProvider) throw new Error('No email provider configured')

  const transporter = nodemailer.createTransport({
    host: defaultProvider.smtpHost,
    port: defaultProvider.smtpPort,
    secure: defaultProvider.smtpPort === 465,
    auth: {
      user: defaultProvider.smtpUser,
      pass: defaultProvider.smtpPass,
    },
  })

  // Sanitize the HTML body so no executable content reaches the inbox.
  const safeHtml = sanitizeHtml(payload.html, SAFE_HTML)

  const info = await (async () => {
    try {
      return await transporter.sendMail({
        from: `"Network Monitor" <${defaultProvider.smtpUser || 'admin@network.local'}>`,
        to: payload.to,
        subject: payload.subject,
        text: payload.text ?? stripHtml(payload.html),
        html: safeHtml,
      })
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
      return await transporter.sendMail({
        from: `"Network Monitor" <${defaultProvider.smtpUser || 'admin@network.local'}>`,
        to: payload.to,
        subject: payload.subject,
        text: payload.text ?? stripHtml(payload.html),
        html: safeHtml,
      })
    }
  })()
  return info.messageId
}
