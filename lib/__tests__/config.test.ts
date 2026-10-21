import { loadConfig } from '../config'

/**
 * `loadConfig` is called with an explicit object rather than the real
 * environment so each case is hermetic. Since the secrets became required
 * everywhere, every call must supply them — except the cases that are
 * *testing* the requirement.
 */
const SECRETS = {
  SESSION_SECRET: 'x'.repeat(48),
  ENCRYPTION_KEY: 'y'.repeat(48),
  APP_NAME: 'Test Network Monitor',
}

describe('loadConfig', () => {
  it('applies non-secret development defaults', () => {
    const cfg = loadConfig({ DB_CLIENT: 'sqlite', ...SECRETS })
    expect(cfg.DB_CLIENT).toBe('sqlite')
    expect(cfg.SCAN_INTERVAL_SECONDS).toBe(30)
    expect(cfg.NODE_ENV).toBe('development')
    expect(cfg.LOG_LEVEL).toBe('info')
  })

  it('rejects an unknown DB_CLIENT', () => {
    expect(() => loadConfig({ DB_CLIENT: 'postgres', ...SECRETS })).toThrow(/Invalid environment/)
  })

  it('rejects a scan interval below the minimum', () => {
    expect(() =>
      loadConfig({ DB_CLIENT: 'sqlite', SCAN_INTERVAL_SECONDS: '10', ...SECRETS })
    ).toThrow(/SCAN_INTERVAL_SECONDS/)
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

  describe('database identity in production', () => {
    const prod = {
      NODE_ENV: 'production',
      ...SECRETS,
    }
    const mysql = {
      ...prod,
      DB_CLIENT: 'mysql',
      DB_NAME: 'home_monitor',
      DB_USER: 'monitor',
      DB_PASSWORD: 'a-real-password',
    }

    it('requires DB_NAME, DB_USER and DB_PASSWORD when DB_CLIENT=mysql', () => {
      // All three are reported together, so one restart fixes all of them.
      expect(() => loadConfig({ ...prod, DB_CLIENT: 'mysql' })).toThrow(
        /DB_NAME[\s\S]*DB_USER[\s\S]*DB_PASSWORD/
      )
    })

    it('rejects a whitespace-only value', () => {
      expect(() => loadConfig({ ...mysql, DB_PASSWORD: '   ' })).toThrow(/DB_PASSWORD/)
      expect(() => loadConfig({ ...mysql, DB_USER: '   ' })).toThrow(/DB_USER/)
    })

    it('is accepted when all three are supplied', () => {
      const cfg = loadConfig(mysql)
      expect(cfg.DB_NAME).toBe('home_monitor')
      expect(cfg.DB_USER).toBe('monitor')
      expect(cfg.DB_PASSWORD).toBe('a-real-password')
    })

    it('is not required for sqlite, which has no accounts or schema', () => {
      const cfg = loadConfig({ ...prod, DB_CLIENT: 'sqlite' })
      expect(cfg.DB_PASSWORD).toBe('')
      expect(cfg.DB_NAME).toBeUndefined()
      expect(cfg.DB_USER).toBeUndefined()
    })
  })

  describe('database identity has no default', () => {
    // Previously `DB_NAME` defaulted to 'home_monitor' and `DB_USER` to
    // 'monitor'. A deployment that forgot either silently connected to
    // whatever schema and account happened to exist under those names, which
    // is a wrong-database bug that looks like a working connection. There is
    // now no value to fall back to.
    it('leaves DB_NAME and DB_USER undefined when unset', () => {
      expect(loadConfig({ DB_CLIENT: 'sqlite', ...SECRETS }).DB_NAME).toBeUndefined()
      expect(loadConfig({ DB_CLIENT: 'mysql', ...SECRETS }).DB_USER).toBeUndefined()
    })

    it('never defaults DB_PASSWORD to a usable value', () => {
      expect(loadConfig({ DB_CLIENT: 'sqlite', ...SECRETS }).DB_PASSWORD).toBe('')
    })
  })

  describe('APP_NAME', () => {
    it('is required, so no deployment inherits another product name', () => {
      expect(() => loadConfig({ DB_CLIENT: 'sqlite', ...SECRETS, APP_NAME: undefined })).toThrow(
        /APP_NAME/
      )
    })

    it('rejects an empty or whitespace-only name', () => {
      expect(() => loadConfig({ DB_CLIENT: 'sqlite', ...SECRETS, APP_NAME: '   ' })).toThrow(
        /APP_NAME/
      )
    })

    it('is carried through when supplied', () => {
      const cfg = loadConfig({ DB_CLIENT: 'sqlite', ...SECRETS, APP_NAME: 'Acme Monitor' })
      expect(cfg.APP_NAME).toBe('Acme Monitor')
    })
  })

  describe('secrets have no default in any environment', () => {
    // This replaced a test asserting the opposite ("defaults secrets in
    // development so a clean clone starts without editing files"). That
    // convenience meant every developer and every CI run encrypted sessions
    // and router credentials under the same literal string, committed to this
    // repository — a default that is usable is a published key, not a
    // fallback. The cost is one line in `.env.local`; the alternative is a
    // shared secret.

    it('rejects a development environment with no secrets', () => {
      expect(() => loadConfig({ DB_CLIENT: 'sqlite', NODE_ENV: 'development' })).toThrow(
        /SESSION_SECRET.*ENCRYPTION_KEY|ENCRYPTION_KEY.*SESSION_SECRET/
      )
    })

    it('rejects a test environment with no secrets', () => {
      expect(() => loadConfig({ DB_CLIENT: 'sqlite', NODE_ENV: 'test' })).toThrow(/SESSION_SECRET/)
    })

    it('names both variables when neither is set', () => {
      // The failure has to name what is missing. "Invalid environment" alone
      // sends a reader looking through the schema for a variable the message
      // never mentions. Both are reported together so one boot fixes both.
      expect(() => loadConfig({ DB_CLIENT: 'sqlite' })).toThrow(
        /SESSION_SECRET[\s\S]*ENCRYPTION_KEY|ENCRYPTION_KEY[\s\S]*SESSION_SECRET/
      )
    })

    it('rejects a secret shorter than the minimum outside production too', () => {
      // Length is cheap to check and the only defence against a placeholder
      // like "secret". Enforcing it in development as well stops a weak value
      // from being promoted to production by copying an env file.
      expect(() =>
        loadConfig({ DB_CLIENT: 'sqlite', NODE_ENV: 'test', SESSION_SECRET: 'short', ENCRYPTION_KEY: SECRETS.ENCRYPTION_KEY })
      ).toThrow(/SESSION_SECRET/)
    })

    it('accepts secrets that meet the length requirement', () => {
      const cfg = loadConfig({ DB_CLIENT: 'sqlite', NODE_ENV: 'test', ...SECRETS })
      expect(cfg.SESSION_SECRET).toBe(SECRETS.SESSION_SECRET)
    })
  })
})