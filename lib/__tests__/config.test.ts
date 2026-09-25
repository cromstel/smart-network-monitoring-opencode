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
      })
    ).toThrow(/SESSION_SECRET.*ENCRYPTION_KEY|ENCRYPTION_KEY.*SESSION_SECRET/)
  })

  it('defaults secrets in development so a clean clone starts without editing files', () => {
    const cfg = loadConfig({ DB_CLIENT: 'sqlite', NODE_ENV: 'development' })
    expect(cfg.SESSION_SECRET).toContain('dev-only')
  })
})