import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { validateSession } from '@/lib/services/authService'
import { logger } from '@/lib/utils/logger'

// Next.js 16 renamed the `middleware` convention to `proxy` and fixed its
// runtime to Node.js. This file was middleware.ts through Next.js 15, where
// `export const runtime = 'nodejs'` was required to opt in; the export is gone
// because the runtime is no longer configurable.
//
// The Node.js runtime is load-bearing here, not incidental: validateSession
// opens the application database through the same repository layer the routes
// use. An edge runtime could not reach it.

// Authentication pages live under /auth/*. The API routes keep their own
// /api/* namespace and are listed separately below.
const ALLOWED_PATHS = [
  '/auth/login',
  '/auth/setup',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/setup',
]

function isAllowed(path: string): boolean {
  return ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/'))
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (isAllowed(path)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('session')?.value
  if (!token) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    logger.warn({ path }, 'unauthenticated access denied')
    return NextResponse.redirect(loginUrl)
  }

  const result = await validateSession(token)
  if (!result) {
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    logger.warn({ path }, 'invalid session')
    const response = NextResponse.redirect(loginUrl)
    response.cookies.set('session', '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 })
    return response
  }

  const response = NextResponse.next()
  response.headers.set('x-user-id', result.user.id)
  response.headers.set('x-user-role', result.user.role)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)',
  ],
}
