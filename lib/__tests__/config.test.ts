import { loadConfig } from '../config'

describe('loadConfig', () => {
  it('applies development defaults', () => {
    const cfg = loadConfig({ DB_CLIENT: 'sqlite' })
    expect(cfg.DB_CLIENT).toBe('sqlite')
    expect(cfg.SCAN_INTERVAL_SECONDS).toBe(30)
    expect(cfg.PORT).toBe(3000)
    expect(cfg.NODE_ENV).toBe('development')
    expect(cfg.LOG_LEVEL).toBe('info')
  })

  it('rejects an unknown DB_CLIENT', () => {
    expect(() => loadConfig({ DB_CLIENT: 'postgres' })).toThrow(/Invalid environment/)
  })

  it('rejects a scan interval below the minimum', () => {
    expect(() => loadConfig({ DB_CLIENT: 'sqlite', SCAN_INTERVAL_SECONDS: '10' })).toThrow(
      /SCAN_INTERVAL_SECONDS/
    )
  })

  it('requires SESSION_SECRET and ENCRYPTION_KEY in production', () => {
    expect(() =>
      loadConfig({
        DB_CLIENT: 'mysql',
        NODE_ENV: 'production',
        SESSION_SECRET: '',
        ENCRYPTION_KEY: '',
        // Provided so this test isolates the two secret checks rather than
        // tripping the DB_PASSWORD one first.
        DB_PASSWORD: 'a-real-password',
      })
    ).toThrow(/SESSION_SECRET.*ENCRYPTION_KEY|ENCRYPTION_KEY.*SESSION_SECRET/)
  })

  describe('DB_PASSWORD in production', () => {
    const prod = {
      NODE_ENV: 'production',
      SESSION_SECRET: 'x'.repeat(48),
      ENCRYPTION_KEY: 'y'.repeat(48),
    }

    it('is required when DB_CLIENT=mysql', () => {
      expect(() => loadConfig({ ...prod, DB_CLIENT: 'mysql' })).toThrow(/DB_PASSWORD/)
    })

    it('rejects a whitespace-only password', () => {
      expect(() => loadConfig({ ...prod, DB_CLIENT: 'mysql', DB_PASSWORD: '   ' })).toThrow(/DB_PASSWORD/)
    })

    it('is accepted when supplied', () => {
      const cfg = loadConfig({ ...prod, DB_CLIENT: 'mysql', DB_PASSWORD: 'a-real-password' })
      expect(cfg.DB_PASSWORD).toBe('a-real-password')
    })

    it('is not required for sqlite, which has no accounts', () => {
      const cfg = loadConfig({ ...prod, DB_CLIENT: 'sqlite' })
      expect(cfg.DB_PASSWORD).toBe('')
    })
  })

  it('never defaults DB_PASSWORD to a usable value', () => {
    expect(loadConfig({ DB_CLIENT: 'sqlite' }).DB_PASSWORD).toBe('')
    expect(loadConfig({ DB_CLIENT: 'mysql' }).DB_PASSWORD).toBe('')
  })

  it('defaults secrets in development so a clean clone starts without editing files', () => {
    const cfg = loadConfig({ DB_CLIENT: 'sqlite', NODE_ENV: 'development' })
    expect(cfg.SESSION_SECRET).toContain('dev-only')
  })
})