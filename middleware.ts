import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { validateSession } from '@/lib/services/authService'
import { logger } from '@/lib/utils/logger'

export const runtime = 'nodejs'

const ALLOWED_PATHS = [
  '/login',
  '/setup',
  '/api/health',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/setup',
]

function isAllowed(path: string): boolean {
  return ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname

  if (isAllowed(path)) {
    return NextResponse.next()
  }

  const token = request.cookies.get('session')?.value
  if (!token) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', path)
    logger.warn({ path }, 'unauthenticated access denied')
    return NextResponse.redirect(loginUrl)
  }

  const result = await validateSession(token)
  if (!result) {
    const loginUrl = new URL('/login', request.url)
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