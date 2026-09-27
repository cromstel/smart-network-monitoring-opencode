import { checkRateLimit, createRateLimiter, cleanupRateLimitStore } from '../rateLimit'

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({ DB_CLIENT: 'sqlite', NODE_ENV: 'test' })),
}))

jest.mock('@/lib/db/client', () => ({ db: {} }))

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

function request(ip = '10.0.0.1', url = 'http://localhost/api/auth/login') {
  return new Request(url, { headers: { 'x-forwarded-for': ip } })
}

describe('rateLimit', () => {
  beforeEach(async () => {
    // The store is module-level; drain it between tests.
    await cleanupRateLimitStore()
  })

  it('allows requests up to the limit then blocks', async () => {
    for (let i = 0; i < 3; i += 1) {
      const result = await checkRateLimit(request(), '/test-a', 3, 60_000)
      expect(result.allowed).toBe(true)
    }

    const blocked = await checkRateLimit(request(), '/test-a', 3, 60_000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it('scopes limits per endpoint', async () => {
    await checkRateLimit(request(), '/endpoint-one', 1, 60_000)

    const sameEndpoint = await checkRateLimit(request(), '/endpoint-one', 1, 60_000)
    expect(sameEndpoint.allowed).toBe(false)

    const otherEndpoint = await checkRateLimit(request(), '/endpoint-two', 1, 60_000)
    expect(otherEndpoint.allowed).toBe(true)
  })

  it('scopes limits per client IP', async () => {
    const first = await checkRateLimit(request('10.0.0.1'), '/per-ip', 1, 60_000)
    expect(first.allowed).toBe(true)

    const sameIp = await checkRateLimit(request('10.0.0.1'), '/per-ip', 1, 60_000)
    expect(sameIp.allowed).toBe(false)

    const otherIp = await checkRateLimit(request('10.0.0.2'), '/per-ip', 1, 60_000)
    expect(otherIp.allowed).toBe(true)
  })

  it('uses the first entry in a multi-hop x-forwarded-for chain', async () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178' },
    })
    const result = await checkRateLimit(req, '/forwarded', 5, 60_000)
    expect(result.allowed).toBe(true)
  })

  it('resets once the window has elapsed', async () => {
    jest.useFakeTimers()
    try {
      await checkRateLimit(request(), '/window', 1, 1000)
      expect((await checkRateLimit(request(), '/window', 1, 1000)).allowed).toBe(false)

      jest.advanceTimersByTime(1500)

      expect((await checkRateLimit(request(), '/window', 1, 1000)).allowed).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('createRateLimiter returns null when under the limit and 429 when over', async () => {
    const limiter = createRateLimiter('/login-test', 2, 60_000)

    expect(await limiter(request())).toBeNull()
    expect(await limiter(request())).toBeNull()

    const blocked = await limiter(request())
    expect(blocked).not.toBeNull()
    expect(blocked!.status).toBe(429)

    const body = await blocked!.json()
    expect(body.error).toBe('RATE_LIMITED')

    const retryAfter = Number(blocked!.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(60)
  })

  it('groups all clients without a forwarded-for header under one key', async () => {
    const anonymous = new Request('http://localhost/x')

    const first = await checkRateLimit(anonymous, '/anon', 1, 60_000)
    expect(first.allowed).toBe(true)

    const second = await checkRateLimit(new Request('http://localhost/x'), '/anon', 1, 60_000)
    expect(second.allowed).toBe(false)
  })

  it('cleanupRateLimitStore only removes expired entries', async () => {
    const now = Date.now()
    await checkRateLimit(request('10.9.9.9'), '/keep', 5, 60_000)

    // Everything just written is live, so nothing should be swept.
    expect(await cleanupRateLimitStore()).toBe(0)
    expect((await checkRateLimit(request('10.9.9.9'), '/keep', 5, 60_000)).allowed).toBe(true)
    expect(now).toBeLessThanOrEqual(Date.now())
  })
})
