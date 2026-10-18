'use client'

import { useQuery } from '@tanstack/react-query'

export type UserRole = 'VIEWER' | 'MEMBER' | 'ADMIN'

export interface CurrentUser {
  id: string
  email: string
  name: string | null
  role: UserRole
}

export interface Permissions {
  /**
   * Create/edit/delete alert rules, rename devices. `true` for ADMIN and
   * MEMBER, and also for `undefined` (unknown role) — see `permissionsFor`.
   * Only VIEWER is denied.
   */
  canManage: boolean
  /** Global configuration: settings, router credentials, user administration (ADMIN). */
  isAdmin: boolean
}

/**
 * Derive UI affordances from a role that may not have loaded yet.
 *
 * The two fields deliberately fail in opposite directions while `role` is
 * `undefined` — that covers both "still loading" and "the request failed":
 *
 * - `canManage` fails **open**. These controls act on the caller's *own*
 *   resources, and every handler re-checks the session (`lib/api/auth.ts`).
 *   Failing closed instead would hide the rule form until `GET /api/auth/me`
 *   answered and leave it permanently hidden if that request ever failed —
 *   a cosmetic nicety costing a whole feature. It also made the control set
 *   depend on a race: readers would count delete buttons before the role
 *   arrived and get a different number than after.
 * - `isAdmin` fails **closed**. These surfaces mutate global state (router
 *   credentials, every account), so guessing "yes" briefly flashes a control
 *   that then vanishes; guessing "no" only delays it.
 */
export function permissionsFor(role: UserRole | undefined): Permissions {
  return {
    canManage: role === undefined || role === 'ADMIN' || role === 'MEMBER',
    isAdmin: role === 'ADMIN',
  }
}

/**
 * The signed-in account from `GET /api/auth/me`.
 *
 * Role is used to *hide* controls the caller cannot use — never to enforce
 * anything. Every handler re-checks the session itself (`lib/api/auth.ts`,
 * PRD F-62); this only stops a VIEWER from being shown a button that would
 * answer 403.
 */
export function useCurrentUser() {
  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me')
      if (!response.ok) {
        throw new Error('Failed to load the current user')
      }
      const body = (await response.json()) as { data: { user: CurrentUser } }
      return body.data.user
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })

  return { ...query, permissions: permissionsFor(query.data?.role) }
}
