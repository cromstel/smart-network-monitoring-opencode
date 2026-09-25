import { hashPassword, verifyPassword, hashTokenAsync, generateToken } from '../crypto'

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
  })

  it('generates consistent hashes for same password with different salts', async () => {
    const password = 'same-password'
    const hash1 = await hashPassword(password)
    const hash2 = await hashPassword(password)

    expect(hash1).not.toBe(hash2)
    expect(await verifyPassword(password, hash1)).toBe(true)
    expect(await verifyPassword(password, hash2)).toBe(true)
  })

  it('generates tokens of correct length', () => {
    const token = generateToken()
    expect(token).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true)
  })

  it('generates unique tokens', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 100; i++) {
      tokens.add(generateToken())
    }
    expect(tokens.size).toBe(100)
  })

  it('hashes tokens consistently', async () => {
    const token = 'test-token-123'
    const hash1 = await hashTokenAsync(token)
    const hash2 = await hashTokenAsync(token)

    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64)
  })

  it('produces different hashes for different tokens', async () => {
    const hash1 = await hashTokenAsync('token-1')
    const hash2 = await hashTokenAsync('token-2')

    expect(hash1).not.toBe(hash2)
  })
})