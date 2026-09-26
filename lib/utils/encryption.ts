import { getConfig } from '@/lib/config'

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12
const TAG_LENGTH = 16

async function getCryptoKey(): Promise<CryptoKey> {
  const config = getConfig()
  const keyHex = config.ENCRYPTION_KEY
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex characters)')
  }
  const keyData = new Uint8Array(keyHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)))
  return crypto.subtle.importKey('raw', keyData, ALGORITHM, false, ['encrypt', 'decrypt'])
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await getCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  )

  const cipherArray = new Uint8Array(ciphertext)
  const encryptedData = new Uint8Array(IV_LENGTH + cipherArray.length)
  encryptedData.set(iv, 0)
  encryptedData.set(cipherArray, IV_LENGTH)

  return Array.from(encryptedData, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function decrypt(encryptedHex: string): Promise<string> {
  const key = await getCryptoKey()
  const encryptedData = new Uint8Array(
    encryptedHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  )

  if (encryptedData.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Invalid encrypted data: too short')
  }

  const iv = encryptedData.slice(0, IV_LENGTH)
  const ciphertext = encryptedData.slice(IV_LENGTH)

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  )

  const decoder = new TextDecoder()
  return decoder.decode(plaintext)
}