import { hashPassword, verifyPassword, hashTokenAsync, generateToken } from '../crypto'

// bcrypt cost 12 is deliberately expensive (PRD F-60): a single hash takes
// seconds on modest hardware. Two hashes plus verifications blow past Jest's
// 5s default, so every test that touches bcrypt gets an explicit budget.
const BCRYPT_TIMEOUT = 60_000

describe('crypto utilities', () => {
  it('hashes and verifies passwords', async () => {
    const password = 'test-password-123'
    const hash = await hashPassword(password)

    expect(hash).toBeDefined()
    expect(hash.startsWith('$2a$')).toBe(true)

    const valid = await verifyPassword(password, hash)
    expect(valid).toBe(true)

    const invalid = await verifyPassword('wrong-password', hash)
    expect(invalid).toBe(false)
  }, BCRYPT_TIMEOUT)

  it('generates consistent hashes for same password with different salts', async () => {
    const password = 'same-password'
    const hash1 = await hashPassword(password)
    const hash2 = await hashPassword(password)

    expect(hash1).not.toBe(hash2)
    expect(await verifyPassword(password, hash1)).toBe(true)
    expect(await verifyPassword(password, hash2)).toBe(true)
  }, BCRYPT_TIMEOUT)

  it('generates tokens of correct length', () => {
    const token = generateToken()
    expect(token).toHaveLength(64)
  })

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()))
    expect(tokens.size).toBe(100)
  })

  it('hashes tokens consistently', async () => {
    const token = generateToken()
    const hash1 = await hashTokenAsync(token)
    const hash2 = await hashTokenAsync(token)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  it('produces different hashes for different tokens', async () => {
    const hash1 = await hashTokenAsync(generateToken())
    const hash2 = await hashTokenAsync(generateToken())

    expect(hash1).not.toBe(hash2)
  })
})
