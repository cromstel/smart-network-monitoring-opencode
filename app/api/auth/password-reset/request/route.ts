import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { requestPasswordReset } from '@/lib/services/authService'
import { apiError } from '@/lib/api/errors'
import { logger } from '@/lib/utils/logger'
import { createRateLimiter } from '@/lib/utils/rateLimit'

const requestSchema = z.object({
  email: z.string().email(),
})

const REQUEST_RATE_LIMIT = Number(process.env.PASSWORD_RESET_REQUEST_RATE_LIMIT_MAX ?? 3)
const requestRateLimiter = createRateLimiter(
  '/api/auth/password-reset/request',
  REQUEST_RATE_LIMIT,
  15 * 60 * 1000
)

export async function POST(request: NextRequest) {
  const rateLimitResponse = await requestRateLimiter(request)
  if (rateLimitResponse) return rateLimitResponse

  try {
    const body = await request.json()
    const parsed = requestSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(400, 'INVALID_BODY', 'Invalid email', parsed.error.flatten())
    }

    // Always returns true regardless of whether the email exists, so the
    // endpoint cannot be used to enumerate registered addresses.
    await requestPasswordReset(parsed.data.email)
    logger.info({ email: parsed.data.email }, 'password reset requested')

    return NextResponse.json({
      data: {
        message: 'If an account exists for that email, a reset code has been sent.',
      },
    })
  } catch (err) {
    logger.error({ err }, 'password reset request error')
    return apiError(500, 'INTERNAL', 'Password reset request failed')
  }
}
