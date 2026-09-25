import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createUser } from '@/lib/services/authService'
import { db } from '@/lib/db/client'
import { apiError } from '@/lib/api/errors'
import { logger } from '@/lib/utils/logger'

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100).optional(),
})

export async function GET() {
  const existing = await db.selectFrom('users').select('id').executeTakeFirst()

  if (existing) {
    return NextResponse.json({ data: { setupComplete: true } })
  }

  return NextResponse.json({ data: { setupComplete: false } })
}

export async function POST(request: NextRequest) {
  try {
    const existing = await db.selectFrom('users').select('id').executeTakeFirst()
    if (existing) {
      return apiError(409, 'CONFLICT', 'Setup already completed')
    }

    const body = await request.json()
    const parsed = setupSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(400, 'INVALID_BODY', 'Invalid input', parsed.error.flatten())
    }

    const { email, password, name } = parsed.data
    const user = await createUser({ email, password, name, role: 'ADMIN' })

    logger.info({ userId: user.id }, 'initial admin created via setup')
    return NextResponse.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
    })
  } catch (err) {
    logger.error({ err }, 'setup error')
    return apiError(500, 'INTERNAL', 'Setup failed')
  }
}