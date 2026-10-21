import { appName, requiredDbName, MissingAppIdentityError, RESERVED_DB_NAMES } from '../config/app'

/**
 * The identity accessors are the request-time readers for `APP_NAME` and
 * `DB_NAME`, so they are what a misconfigured deployment actually hits. Each
 * test saves and restores the variable it touches — these run in the same
 * process as `config.test.ts`, which asserts against explicit objects, but a
 * leaked global here would still make the next suite lie.
 */
describe('app identity', () => {
  const ORIGINAL = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL }
  })

  describe('appName', () => {
    it('returns the configured value, trimmed', () => {
      process.env.APP_NAME = '  Acme Monitor  '
      expect(appName()).toBe('Acme Monitor')
    })

    it('throws when APP_NAME is absent rather than inventing one', () => {
      delete process.env.APP_NAME
      // The failure names the variable. A default would hide the mistake: the
      // app would boot, look fine, and advertise the wrong product.
      expect(() => appName()).toThrow(MissingAppIdentityError)
      expect(() => appName()).toThrow(/APP_NAME/)
    })

    it('treats a whitespace-only name as absent', () => {
      process.env.APP_NAME = '   '
      expect(() => appName()).toThrow(/APP_NAME/)
    })

    it('does not read the value at import time', () => {
      // Set *after* the module was imported. A module-level read would have
      // captured the value present at import and this would fail.
      process.env.APP_NAME = 'Set Later'
      expect(appName()).toBe('Set Later')
    })

    it('accepts and rejects the same values as loadConfig', () => {
      // `appName()` and the `APP_NAME` field of the zod schema in
      // `lib/config.ts` implement one rule in two places — request-time
      // accessor versus boot-time fail-fast, neither able to use the other's
      // result (see the comments on both). Without this test the duplication
      // is free to drift: someone loosening the schema to accept a blank name
      // would still see green, while the login page kept throwing.
      const { loadConfig } = require('../config') as typeof import('../config')

      for (const value of [undefined, '', '   ']) {
        process.env.APP_NAME = value as string | undefined
        if (value === undefined) delete process.env.APP_NAME

        expect(() => appName()).toThrow(/APP_NAME/)
        expect(() => loadConfig({ ...process.env, APP_NAME: value })).toThrow(/APP_NAME/)
      }

      process.env.APP_NAME = '  Drift Guard, Inc.  '
      expect(appName()).toBe('Drift Guard, Inc.')
      expect(loadConfig({ ...process.env }).APP_NAME).toBe('Drift Guard, Inc.')
    })
  })

  describe('requiredDbName', () => {
    it('returns the configured schema name', () => {
      process.env.DB_NAME = 'home_monitor_test'
      expect(requiredDbName()).toBe('home_monitor_test')
    })

    it('throws when DB_NAME is absent on the MySQL path', () => {
      delete process.env.DB_NAME
      expect(() => requiredDbName()).toThrow(/DB_NAME/)
    })
  })

  describe('RESERVED_DB_NAMES', () => {
    it('is a rejection list, not a set of defaults', () => {
      // Nothing in it is ever assigned. Asserted so a future edit that turns
      // this into a fallback has to delete a test that says why it is not one.
      expect(RESERVED_DB_NAMES.length).toBeGreaterThan(0)
      expect(RESERVED_DB_NAMES).not.toContain('')
    })
  })
})
