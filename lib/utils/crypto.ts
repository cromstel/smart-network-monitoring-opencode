import bcrypt from 'bcryptjs'

import { getConfig } from '@/lib/config'

const BCRYPT_COST = 12

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Keyed cache for the HMAC key, so a request-rate function does not re-import
 * the key material on every call. The key is rebuilt only if the underlying
 * secret actually changes (tests swap `process.env` mid-process); production
 * secrets are immutable for the life of the process.
 */
let cachedKey: { secret: string; key: CryptoKey } | null = null

async function sessionKey(): Promise<CryptoKey> {
  const secret = getConfig().SESSION_SECRET
  if (cachedKey && cachedKey.secret === secret) return cachedKey.key

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  cachedKey = { secret, key }
  return key
}

/**
 * Session-token hash: HMAC-SHA256 keyed with `SESSION_SECRET`.
 *
 * This is what `SESSION_SECRET` is *for*. It used to be required by
 * `lib/config.ts` and read by nothing, while tokens were stored under a bare
 * SHA-256 — the secret and the sessions were unrelated, and the configuration
 * screen promised a protection the code did not deliver.
 *
 * Keying matters beyond "hashing the token": an attacker who can *write* to
 * the sessions table (SQL injection elsewhere, a leaked backup restored over
 * production) cannot forge a valid row, because computing the stored hash of a
 * token they chose requires the secret. With unkeyed SHA-256 the digest is a
 * one-command computation and the planted session is accepted.
 *
 * Consequence worth knowing: rotating `SESSION_SECRET` invalidates every
 * session (all stored hashes stop matching). That is a feature — it is the
 * kill switch for a leaked secret — but it is a logout-everyone deploy step.
 */
export async function hashTokenAsync(token: string): Promise<string> {
  const key = await sessionKey()
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token))
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, '0')).join('')
}
