import { getConfig } from '@/lib/config'
import * as userRepo from '@/lib/db/repositories/userRepository'
import { hashTokenAsync, verifyPassword, generateToken } from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'
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