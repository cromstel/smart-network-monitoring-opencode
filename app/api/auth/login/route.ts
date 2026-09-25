import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { authenticate } from '@/lib/services/authService'
import { apiError } from '@/lib/api/errors'
import { logger } from '@/lib/utils/logger'
import { createRateLimiter } from '@/lib/utils/rateLimit'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const loginRateLimiter = createRateLimiter('/api/auth/login', 5, 15 * 60 * 1000)

export async function POST(request: NextRequest) {
  const rateLimitResponse = await loginRateLimiter(request)
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = await request.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(400, 'INVALID_BODY', 'Invalid email or password', parsed.error.flatten())
    }

    const { email, password } = parsed.data
    const result = await authenticate(email, password)

    if (!result) {
      logger.warn({ email }, 'failed login attempt')
      return apiError(401, 'UNAUTHENTICATED', 'Invalid email or password')
    }

    const { user, session } = result

    const response = NextResponse.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
    })

    response.cookies.set('session', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    logger.info({ userId: user.id }, 'user logged in')
    return response
  } catch (err) {
    logger.error({ err }, 'login error')
    return apiError(500, 'INTERNAL', 'Login failed')
  }
}