import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { confirmPasswordReset } from '@/lib/services/authService'
import { apiError } from '@/lib/api/errors'
import { logger } from '@/lib/utils/logger'
import { createRateLimiter } from '@/lib/utils/rateLimit'

const confirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
})

const CONFIRM_RATE_LIMIT = Number(process.env.PASSWORD_RESET_CONFIRM_RATE_LIMIT_MAX ?? 5)
const confirmRateLimiter = createRateLimiter(
  '/api/auth/password-reset/confirm',
  CONFIRM_RATE_LIMIT,
  15 * 60 * 1000
)

export async function POST(request: NextRequest) {
  const rateLimitResponse = await confirmRateLimiter(request)
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = await request.json()
    const parsed = confirmSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(400, 'INVALID_BODY', 'Invalid token or password', parsed.error.flatten())
    }

    const { token, newPassword } = parsed.data
    const ok = await confirmPasswordReset(token, newPassword)

    if (!ok) {
      return apiError(400, 'INVALID_TOKEN', 'Reset code is invalid, expired, or already used')
    }

    logger.info({}, 'password reset confirmed')
    return NextResponse.json({
      data: { message: 'Password reset successfully. Please sign in.' },
    })
  } catch (err) {
    logger.error({ err }, 'password reset confirm error')
    return apiError(500, 'INTERNAL', 'Password reset confirmation failed')
  }
}
