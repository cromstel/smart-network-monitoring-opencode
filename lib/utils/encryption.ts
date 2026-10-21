import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getConfig } from '@/lib/config'

/**
 * AES-256-GCM for values at rest (router credentials).
 *
 * Wire format is `iv:authTag:ciphertext`, each hex-encoded and colon-joined,
 * per ARCHITECTURE.md §8. A fresh 96-bit IV is generated per encryption and
 * the GCM tag is verified on decrypt, so tampering fails loudly.
 *
 * The key is `ENCRYPTION_KEY`. A 64-hex-char value is used verbatim (the
 * documented production form). Anything else is folded to 32 bytes with
 * SHA-256, so the value need not be hex — but it must still be at least 32
 * characters, in every environment: `assertSecretStrength` in `lib/config.ts`
 * checks that at boot. This used to say the folding was "so development works
 * without hand-generating a key", which stopped being true the moment weak
 * dev defaults were removed.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32
const HEX_KEY_LENGTH = KEY_BYTES * 2

let cachedKey: Buffer | null = null

function resolveKeyMaterial(): string {
  const key = getConfig().ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY is not set — cannot encrypt or decrypt')
  }
  return key
}

function getKey(): Buffer {
  const material = resolveKeyMaterial()
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    return Buffer.from(material, 'hex')
  }
  return createHash('sha256').update(material, 'utf8').digest()
}

function toHex(buffer: Buffer): string {
  return buffer.toString('hex')
}

function fromHex(hex: string, label: string): Buffer {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`Malformed ${label}: expected hex characters`)
  }
  return Buffer.from(hex, 'hex')
}

/** Test seam — forces the next call to re-read configuration. */
export function resetKeyCache(): void {
  cachedKey = null
}

export function encrypt(plaintext: string): string {
  const key = cachedKey ?? (cachedKey = getKey())
  const iv = randomBytes(IV_BYTES)

  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `${toHex(iv)}:${toHex(authTag)}:${toHex(ciphertext)}`
}

export function decrypt(payload: string): string {
  const parts = payload.split(':')
  if (parts.length !== 3) {
    throw new Error('Malformed ciphertext: expected iv:authTag:ciphertext')
  }

  const [ivHex, authTagHex, ciphertextHex] = parts
  const iv = fromHex(ivHex, 'iv')
  const authTag = fromHex(authTagHex, 'authTag')
  const ciphertext = fromHex(ciphertextHex, 'ciphertext')

  if (iv.length !== IV_BYTES) {
    throw new Error(`Malformed iv: expected ${IV_BYTES} bytes, got ${iv.length}`)
  }
  if (authTag.length !== TAG_BYTES) {
    throw new Error(`Malformed authTag: expected ${TAG_BYTES} bytes, got ${authTag.length}`)
  }

  const key = cachedKey ?? (cachedKey = getKey())

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Decryption failed: wrong key or tampered ciphertext')
  }
}

/** Constant-time comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
