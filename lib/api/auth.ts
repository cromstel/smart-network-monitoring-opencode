import { cookies } from 'next/headers'
import { validateSession } from '@/lib/services/authService'
import { requireRole, AuthContext } from '@/lib/services/authService'
import { apiError } from './errors'
import { NextResponse } from 'next/server'

export interface AuthResult {
  user: AuthContext['id'] extends string ? { id: string; role: AuthContext['role'] } : never
  session: ReturnType<typeof validateSession> extends Promise<infer T> ? T : never
}

/**
 * Validates the session cookie from the request.
 * Returns the authenticated user context or null if not authenticated.
 * This provides defense-in-depth by not trusting middleware headers.
 */
export async function getAuthContext(): Promise<{ user: { id: string; role: AuthContext['role'] }; session: ReturnType<typeof validateSession> extends Promise<infer T> ? T : never } | null> {
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('session')?.value

  if (!sessionToken) {
    return null
  }

  const session = await validateSession(sessionToken)
  if (!session) {
    return null
  }

  return {
    user: { id: session.user.id, role: session.user.role },
    session,
  }
}

/**
 * Validates authentication and required role.
 * Returns the auth context if successful, or a NextResponse error if not.
 */
export async function requireAuth(
  allowedRoles: AuthContext['role'][]
): Promise<{ user: { id: string; role: AuthContext['role'] }; session: ReturnType<typeof validateSession> extends Promise<infer T> ? T : never } | NextResponse> {
  const auth = await getAuthContext()

  if (!auth) {
    return apiError(401, 'UNAUTHENTICATED', 'Authentication required')
  }

  try {
    requireRole({ id: auth.user.id, role: auth.user.role }, ...allowedRoles)
  } catch {
    return apiError(403, 'FORBIDDEN', 'Insufficient permissions')
  }

  return auth
}