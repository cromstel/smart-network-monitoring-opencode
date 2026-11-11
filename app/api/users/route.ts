import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import * as userRepo from '@/lib/db/repositories/userRepository'

export const dynamic = 'force-dynamic'

interface UserListItem {
  id: string
  email: string
  name: string | null
  role: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
}

export async function GET() {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const users = await userRepo.listUsers()
  return NextResponse.json({
    data: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  })
}

interface CreateUserBody {
  email: string
  password: string
  name?: string | null
  role?: 'ADMIN' | 'MEMBER' | 'VIEWER'
}

export async function POST(request: Request) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => ({}))
  const { email, password, name, role } = body as CreateUserBody

  if (!email || !password) {
    return NextResponse.json({ error: 'MISSING_FIELDS', message: 'email and password are required' }, { status: 400 })
  }

  try {
    const user = await userRepo.createUser({
      email,
      password,
      name,
      role: role ?? 'VIEWER',
    })
    return NextResponse.json(
      {
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          isActive: user.isActive,
          createdAt: user.createdAt.toISOString(),
        },
      },
      { status: 201 }
    )
  } catch (err: any) {
    if (err.message?.includes('already registered') || err.message?.includes('duplicate')) {
      return NextResponse.json({ error: 'DUPLICATE_EMAIL', message: 'Email already registered' }, { status: 409 })
    }
    return NextResponse.json({ error: 'INTERNAL', message: 'Failed to create user' }, { status: 500 })
  }
}

interface PatchUserBody {
  email?: string
  name?: string | null
  role?: 'ADMIN' | 'MEMBER' | 'VIEWER'
  isActive?: boolean
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID', message: 'id query parameter is required' }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const { email, name, role, isActive } = body as PatchUserBody

  const patch: Record<string, unknown> = {}
  if (email !== undefined) patch.email = email
  if (name !== undefined) patch.name = name
  if (role !== undefined) patch.role = role
  if (isActive !== undefined) patch.isActive = isActive

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'NO_CHANGES', message: 'No fields to update' }, { status: 400 })
  }

  const updated = await userRepo.updateUser(id, patch)
  if (!updated) {
    return NextResponse.json({ error: 'NOT_FOUND', message: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    data: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      isActive: updated.isActive,
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  })
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'MISSING_ID', message: 'id query parameter is required' }, { status: 400 })
  }

  // Prevent self-deletion
  if (id === auth.user.id) {
    return NextResponse.json({ error: 'SELF_DELETE', message: 'Cannot delete your own account' }, { status: 400 })
  }

  await userRepo.deleteUser(id)
  return NextResponse.json({ data: { deleted: true } })
}
