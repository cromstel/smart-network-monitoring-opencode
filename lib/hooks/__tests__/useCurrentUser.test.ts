/**
 * `permissionsFor` is the only decision that hides a control in the UI, and
 * its two fields deliberately fail in opposite directions when the role is
 * unknown. A test is the cheapest way to stop a later reader from "tidying"
 * both to the obvious `{role === 'ADMIN' || role === 'MEMBER'}` — which is
 * correct-looking, and would hide the entire rule form until `/api/auth/me`
 * answered, then hide it for good if that request ever failed.
 *
 * These are pure assertions: no React, no fetch, no database.
 */

import { permissionsFor, type UserRole } from '@/lib/hooks/useCurrentUser'

describe('permissionsFor', () => {
  const cases: Array<[UserRole, { canManage: boolean; isAdmin: boolean }]> = [
    ['ADMIN', { canManage: true, isAdmin: true }],
    ['MEMBER', { canManage: true, isAdmin: false }],
    ['VIEWER', { canManage: false, isAdmin: false }],
  ]

  it.each(cases)('grants %s their documented permissions', (role, expected) => {
    expect(permissionsFor(role)).toEqual(expected)
  })

  it('fails open for canManage while the role is unknown', () => {
    // Covers both "query still in flight" and "query failed": the handler is
    // the enforcement layer (F-62), so a network hiccup must not cost the user
    // the ability to manage their own rules.
    expect(permissionsFor(undefined)).toEqual({ canManage: true, isAdmin: false })
  })

  it('fails closed for isAdmin while the role is unknown', () => {
    // These surfaces mutate global state, so a guess of "yes" briefly shows a
    // control that then disappears. Only a confirmed ADMIN gets them.
    expect(permissionsFor(undefined).isAdmin).toBe(false)
  })

  it('never grants VIEWER management, even as a default', () => {
    // The asymmetry must not collapse into "always true".
    expect(permissionsFor('VIEWER').canManage).toBe(false)
  })
})
