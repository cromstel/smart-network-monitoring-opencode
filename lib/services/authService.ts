import { getConfig } from '@/lib/config'
import * as userRepo from '@/lib/db/repositories/userRepository'
import { hashTokenAsync, verifyPassword, generateToken } from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'
import { sendEmail } from '@/lib/services/emailService'
import type { User, Session, SessionWithToken, CreateUserInput, UserPatch, UserRole } from '@/lib/types/user'

const SESSION_TTL_DAYS = 7

export async function createUser(input: CreateUserInput): Promise<User> {
  const existing = await userRepo.findByEmail(input.email)
  if (existing) throw new Error('Email already registered')

  return userRepo.createUser(input)
}

export async function authenticate(email: string, password: string): Promise<{ user: User; session: SessionWithToken } | null> {
  const record = await userRepo.findByEmailWithPassword(email.toLowerCase())
  if (!record) return null

  const valid = await verifyPassword(password, record.passwordHash)
  if (!valid) return null

  if (!record.user.isActive) return null

  const session = await createSession(record.user.id, null, null)
  await userRepo.setLastLogin(record.user.id)

  logger.info({ userId: record.user.id }, 'user authenticated')
  return { user: record.user, session }
}

export async function createSession(userId: string, ipAddress: string | null, userAgent: string | null): Promise<SessionWithToken> {
  const token = generateToken()
  const tokenHash = await hashTokenAsync(token)
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  const session = await userRepo.createSession(userId, tokenHash, expiresAt, ipAddress, userAgent)

  return { ...session, token }
}

export async function validateSession(token: string): Promise<{ user: User; session: Session } | null> {
  const tokenHash = await hashTokenAsync(token)
  const session = await userRepo.findSessionByTokenHash(tokenHash)

  if (!session) return null
  if (session.expiresAt < new Date()) {
    await userRepo.deleteSession(session.id)
    return null
  }

  const user = await userRepo.findById(session.userId)
  if (!user || !user.isActive) return null

  return { user, session }
}

export async function logout(token: string): Promise<void> {
  const tokenHash = await hashTokenAsync(token)
  const session = await userRepo.findSessionByTokenHash(tokenHash)
  if (session) {
    await userRepo.deleteSession(session.id)
  }
}

export async function logoutAll(userId: string): Promise<void> {
  await userRepo.deleteSessionsForUser(userId)
}

export async function getUserById(id: string): Promise<User | null> {
  return userRepo.findById(id)
}

export async function updateUser(id: string, patch: UserPatch): Promise<User | null> {
  return userRepo.updateUser(id, patch)
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
  const user = await userRepo.findByIdOrThrow(userId)
  const record = await userRepo.findByEmailWithPassword(user.email)
  if (!record) return false

  const valid = await verifyPassword(currentPassword, record.passwordHash)
  if (!valid) return false

  await userRepo.updatePassword(userId, newPassword)
  await userRepo.deleteSessionsForUser(userId)
  return true
}

/**
 * F-64: password reset by email.
 *
 * requestPasswordReset: generates a single-use, time-bound token, hashes it
 * (HMAC with SESSION_SECRET, same as session tokens), stores it, and emails
 * the raw token to the user. Returns true whether or not the email exists —
 * never leaks whether an address is registered.
 *
 * confirmPasswordReset: validates the token (unexpired, unused), sets the new
 * password, invalidates all sessions, and marks the token used. Returns false
 * for an invalid/expired/already-used token.
 */

export async function requestPasswordReset(email: string): Promise<boolean> {
  const user = await userRepo.findByEmail(email)
  if (!user) return false

  const token = generateToken()
  const tokenHash = await hashTokenAsync(token)
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  await userRepo.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
  })

  // Best-effort email: a misconfigured SMTP provider must not leak whether
  // the address exists, so we swallow email errors here.
  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset your Network Monitor password',
      html: `
        <p>You requested a password reset for your Network Monitor account.</p>
        <p>Use this code to reset your password:</p>
        <p style="font-size:1.25rem;font-family:monospace;letter-spacing:2px">${token}</p>
        <p>The code expires in 1 hour and can only be used once.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      `,
      text: `You requested a password reset for your Network Monitor account.\n\nUse this code to reset your password:\n\n${token}\n\nThe code expires in 1 hour and can only be used once.\n\nIf you did not request this, you can safely ignore this email.`,
    })
  } catch (err) {
    logger.error({ err, userId: user.id }, 'password reset email failed')
  }

  return true
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<boolean> {
  const tokenHash = await hashTokenAsync(token)
  const record = await userRepo.findPasswordResetTokenByHash(tokenHash)

  if (!record) return false

  const now = new Date()
  if (new Date(record.expiresAt) < now) return false
  if (record.usedAt !== null) return false

  const user = await userRepo.findById(record.userId)
  if (!user || !user.isActive) return false

  await userRepo.updatePassword(record.userId, newPassword)
  await userRepo.markPasswordResetTokenUsed(tokenHash)
  await userRepo.deleteSessionsForUser(record.userId)

  logger.info({ userId: record.userId }, 'password reset confirmed')
  return true
}

export async function cleanupExpiredSessions(): Promise<number> {
  return userRepo.deleteExpiredSessions()
}

export interface AuthContext {
  id: string
  role: UserRole
}

export function requireRole(user: AuthContext | null, ...allowedRoles: UserRole[]): asserts user is AuthContext {
  if (!user) throw new Error('UNAUTHENTICATED')
  if (!allowedRoles.includes(user.role)) throw new Error('FORBIDDEN')
}