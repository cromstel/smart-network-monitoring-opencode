import { encrypt, decrypt, resetKeyCache } from '../encryption'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({
    ENCRYPTION_KEY: 'a'.repeat(64),
  })),
}))

const { getConfig } = require('@/lib/config')

describe('encryption', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetKeyCache()
    getConfig.mockReturnValue({ ENCRYPTION_KEY: 'a'.repeat(64) })
  })

  it('round-trips a plaintext', () => {
    const secret = 'hunter2-correct-horse'
    expect(decrypt(encrypt(secret))).toBe(secret)
  })

  it('round-trips unicode and empty strings', () => {
    for (const value of ['', 'pässwörd-日本語-🔐', 'x'.repeat(5000)]) {
      expect(decrypt(encrypt(value))).toBe(value)
    }
  })

  it('emits iv:authTag:ciphertext as hex', () => {
    const payload = encrypt('secret')
    const parts = payload.split(':')
    expect(parts).toHaveLength(3)
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]*$/)
    }
    // 12-byte IV and 16-byte tag.
    expect(parts[0]).toHaveLength(24)
    expect(parts[1]).toHaveLength(32)
  })

  it('never contains the plaintext', () => {
    expect(encrypt('super-secret-value')).not.toContain('super-secret-value')
  })

  it('uses a fresh IV per call', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
    expect(a.split(':')[0]).not.toBe(b.split(':')[0])
  })

  it('rejects a tampered ciphertext', () => {
    const [iv, tag, ct] = encrypt('secret').split(':')
    const flipped = ct!.slice(0, -1) + (ct!.endsWith('0') ? '1' : '0')
    expect(() => decrypt(`${iv}:${tag}:${flipped}`)).toThrow(/Decryption failed/)
  })

  it('rejects a tampered auth tag', () => {
    const [iv, tag, ct] = encrypt('secret').split(':')
    const flipped = tag!.slice(0, -1) + (tag!.endsWith('0') ? '1' : '0')
    expect(() => decrypt(`${iv}:${flipped}:${ct}`)).toThrow(/Decryption failed/)
  })

  it('rejects a ciphertext encrypted under a different key', () => {
    const payload = encrypt('secret')

    resetKeyCache()
    getConfig.mockReturnValue({ ENCRYPTION_KEY: 'b'.repeat(64) })

    expect(() => decrypt(payload)).toThrow(/Decryption failed/)
  })

  it('rejects malformed payloads', () => {
    expect(() => decrypt('no-colons')).toThrow(/expected iv:authTag:ciphertext/)
    expect(() => decrypt('a:b:c:d')).toThrow(/expected iv:authTag:ciphertext/)
    expect(() => decrypt('zz:aa:bb')).toThrow(/Malformed/)
    expect(() => decrypt('aa:bb:cc')).toThrow(/Malformed iv/)
    expect(() => decrypt(`${'aa'.repeat(12)}:${'bb'.repeat(8)}:cc`)).toThrow(/Malformed authTag/)
  })

  it('derives a 32-byte key from a non-hex passphrase', () => {
    resetKeyCache()
    getConfig.mockReturnValue({ ENCRYPTION_KEY: 'a-short-dev-passphrase' })

    const payload = encrypt('works in dev')
    expect(decrypt(payload)).toBe('works in dev')
  })

  it('fails loudly when no key is configured', () => {
    resetKeyCache()
    getConfig.mockReturnValue({ ENCRYPTION_KEY: '' })
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY is not set/)
  })
})
