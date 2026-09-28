import { toBool } from '../mappers'

/**
 * SQLite hands back integer columns as bigint, MySQL as number. A strict
 * `value === 1` therefore reads every flag as false (`1n !== 1`).
 *
 * This was not theoretical. mapRowToUser compared `row.is_active === 1`
 * directly, so mapRowToUser always produced isActive: false, and
 * authService.authenticate rejects inactive users — meaning no account could
 * ever sign in. The whole E2E suite failed on "Invalid email or password" for
 * that reason, and three sibling repositories already carried comments
 * warning about exactly this trap.
 */
describe('toBool', () => {
  it('reads a SQLite bigint flag as true', () => {
    expect(toBool(BigInt(1))).toBe(true)
  })

  it('reads a MySQL number flag as true', () => {
    expect(toBool(1)).toBe(true)
  })

  it.each([BigInt(0), 0])('reads %p as false', (value) => {
    expect(toBool(value)).toBe(false)
  })

  it.each([2 as number, BigInt(2)])('rejects the non-boolean value %p', (value) => {
    expect(toBool(value)).toBe(false)
  })
})
