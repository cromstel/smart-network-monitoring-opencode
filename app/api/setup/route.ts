import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { createUser } from '@/lib/services/authService'
import { db } from '@/lib/db/client'
import { requireAuth } from '@/lib/api/auth'
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
  const authResult = await requireAuth(['ADMIN'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  try {
    const existing = await db.selectFrom('users').select('id').executeTakeFirst()
    if (existing) {
      return NextResponse.json(
        { error: 'CONFLICT', message: 'Setup already completed' },
        { status: 409 }
      )
    }

    const body = await request.json()
    const parsed = setupSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'INVALID_BODY',
          message: 'Invalid input',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const { email, password, name } = parsed.data
    const user = await createUser({ email, password, name, role: 'ADMIN' })

    logger.info({ userId: user.id }, 'admin created via setup')
    return NextResponse.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
      },
    })
  } catch (err) {
    logger.error({ err }, 'setup error')
    return NextResponse.json(
      { error: 'INTERNAL', message: 'Setup failed' },
      { status: 500 }
    )
  }
}