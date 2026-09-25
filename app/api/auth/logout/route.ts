import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { logout } from '@/lib/services/authService'
import { logger } from '@/lib/utils/logger'

export async function POST() {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('session')?.value

    if (token) {
      await logout(token)
    }

    const response = NextResponse.json({ data: { success: true } })
    response.cookies.set('session', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })

    logger.info('user logged out')
    return response
  } catch (err) {
    logger.error({ err }, 'logout error')
    return NextResponse.json({ error: 'INTERNAL', message: 'Logout failed' }, { status: 500 })
  }
}