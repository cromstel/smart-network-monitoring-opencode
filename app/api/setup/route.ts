import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createUser } from '@/lib/services/authService'
import { db } from '@/lib/db/client'
import { apiError } from '@/lib/api/errors'
import { createRateLimiter } from '@/lib/utils/rateLimit'
import { logger } from '@/lib/utils/logger'

const setupSchema = z.object({
  email: z.string().email().max(255),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .max(200)
    .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p), {
      message: 'Password needs an uppercase letter, a lowercase letter and a digit',
    }),
  name: z.string().min(1).max(100).optional(),
})

/**
 * Bootstrap endpoint. It is intentionally reachable without a session —
 * otherwise first run is impossible, because the very first account is the
 * one that grants ADMIN. Safety comes from three things instead:
 *   1. it 409s as soon as any user exists (see `countUsers`),
 *   2. it is aggressively rate limited,
 *   3. the password policy is enforced by Zod before any write.
 */
const setupRateLimiter = createRateLimiter('/api/setup', 5, 60 * 60 * 1000)

async function countUsers(): Promise<number> {
  const row = await db.selectFrom('users').select(db.fn.countAll<number>().as('count')).executeTakeFirst()
  return Number(row?.count ?? 0)
}

export async function GET() {
  const count = await countUsers()
  return NextResponse.json({ data: { setupComplete: count > 0 } })
}

export async function POST(request: NextRequest) {
  const limited = await setupRateLimiter(request)
  if (limited) return limited

  try {
    if ((await countUsers()) > 0) {
      return apiError(409, 'CONFLICT', 'Setup already completed')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return apiError(400, 'INVALID_BODY', 'Invalid JSON body')
    }

    const parsed = setupSchema.safeParse(body)
    if (!parsed.success) {
      return apiError(400, 'INVALID_BODY', 'Invalid input', parsed.error.flatten())
    }

    const { email, password, name } = parsed.data
    const user = await createUser({ email, password, name, role: 'ADMIN' })

    logger.info({ userId: user.id }, 'initial admin created via setup')
    return NextResponse.json(
      { data: { user: { id: user.id, email: user.email, name: user.name, role: user.role } } },
      { status: 201 }
    )
  } catch (err) {
    logger.error({ err }, 'setup error')
    return apiError(500, 'INTERNAL', 'Setup failed')
  }
}
