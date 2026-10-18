import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'

export const dynamic = 'force-dynamic'

/**
 * The caller's own account and role — `API.md` "GET /api/auth/me".
 *
 * Deliberately narrow: it returns only the four fields the client may render.
 * `passwordHash` exists on the underlying `User` record, so the shape is built
 * field by field rather than by spreading the record (the same reasoning as
 * `publicView` in the router-config route).
 */
export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  // `requireAuth` already guarantees a session; the optional chain only satisfies
  // the union `validateSession` is typed with.
  const user = auth.session?.user
  if (!user) return apiError(401, 'UNAUTHENTICATED', 'Authentication required')

  return NextResponse.json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    },
  })
}
