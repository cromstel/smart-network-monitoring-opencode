import { isSafeRedirect, safeRedirect, DEFAULT_REDIRECT } from '../redirect'

describe('isSafeRedirect', () => {
  it('accepts same-origin paths', () => {
    for (const p of ['/', '/devices', '/devices/abc-123', '/alerts?filter=active', '/settings#s']) {
      expect(isSafeRedirect(p)).toBe(true)
    }
  })

  it('rejects absolute URLs', () => {
    for (const p of [
      'https://evil.example.com/pwn',
      'http://evil.example.com',
      'HTTPS://evil.example.com',
    ]) {
      expect(isSafeRedirect(p)).toBe(false)
    }
  })

  it('rejects protocol-relative and backslash authorities', () => {
    // `//host` and `/\host` both name an authority rather than a path. Some
    // browsers normalise the backslash form, so it is an authority too.
    for (const p of ['//evil.example.com', '//evil.example.com/pwn', '/\\evil.example.com', '\\evil.example.com']) {
      expect(isSafeRedirect(p)).toBe(false)
    }
  })

  it('rejects other schemes', () => {
    for (const p of ['javascript:alert(1)', 'data:text/html,x', 'mailto:a@b.c']) {
      expect(isSafeRedirect(p)).toBe(false)
    }
  })

  it('rejects non-strings and empty values', () => {
    for (const v of ['', null, undefined, 0, {}, [], true]) {
      expect(isSafeRedirect(v)).toBe(false)
    }
  })
})

describe('safeRedirect', () => {
  it('returns safe paths unchanged', () => {
    expect(safeRedirect('/devices')).toBe('/devices')
    expect(safeRedirect('/devices/a?b=c')).toBe('/devices/a?b=c')
  })

  it('falls back to the landing page for unsafe values', () => {
    // This is the open-redirect case, asserted at the unit level.
    expect(safeRedirect('https://evil.example.com/pwn')).toBe(DEFAULT_REDIRECT)
    expect(safeRedirect('//evil.example.com')).toBe(DEFAULT_REDIRECT)
    expect(safeRedirect('/\\evil.example.com')).toBe(DEFAULT_REDIRECT)
    expect(safeRedirect('javascript:alert(1)')).toBe(DEFAULT_REDIRECT)
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT)
    expect(safeRedirect(null)).toBe(DEFAULT_REDIRECT)
  })

  it('honours an explicit fallback', () => {
    expect(safeRedirect('https://evil.example.com', '/devices')).toBe('/devices')
  })
})
