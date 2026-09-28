import { randomUUID } from 'node:crypto'
import { db } from '../client'
import { toBool } from './mappers'
import type { DB } from '../schema'
import type { User, Session, CreateUserInput, UserPatch } from '@/lib/types/user'
import { hashPassword, verifyPassword } from '@/lib/utils/crypto'

export async function createUser(input: CreateUserInput): Promise<User> {
  const now = new Date().toISOString()
  const passwordHash = await hashPassword(input.password)
  const id = randomUUID()

  await db
    .insertInto('users')
    .values({
      id,
      email: input.email.toLowerCase(),
      password_hash: passwordHash,
      name: input.name ?? null,
      role: input.role ?? 'VIEWER',
      is_active: 1,
      last_login_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute()

  return findByIdOrThrow(id)
}

export async function findById(id: string): Promise<User | null> {
  const row = await db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  return row ? mapRowToUser(row) : null
}

export async function findByIdOrThrow(id: string): Promise<User> {
  const user = await findById(id)
  if (!user) throw new Error(`User ${id} not found`)
  return user
}

export async function findByEmail(email: string): Promise<User | null> {
  const row = await db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst()

  return row ? mapRowToUser(row) : null
}

export async function findByEmailWithPassword(email: string): Promise<{ user: User; passwordHash: string } | null> {
  const row = await db
    .selectFrom('users')
    .selectAll()
    .where('email', '=', email.toLowerCase())
    .executeTakeFirst()

  if (!row) return null
  return {
    user: mapRowToUser(row),
    passwordHash: row.password_hash,
  }
}

export async function listUsers(): Promise<User[]> {
  const rows = await db
    .selectFrom('users')
    .selectAll()
    .orderBy('created_at', 'asc')
    .execute()

  return rows.map(mapRowToUser)
}

export async function updateUser(id: string, patch: UserPatch): Promise<User | null> {
  const existing = await findById(id)
  if (!existing) return null

  const now = new Date().toISOString()
  const set: Record<string, unknown> = { updated_at: now }

  if ('name' in patch) set.name = patch.name ?? null
  if ('role' in patch) set.role = patch.role
  if ('isActive' in patch) set.is_active = patch.isActive ? 1 : 0

  await db.updateTable('users').set(set).where('id', '=', id).execute()

  return findById(id)
}

export async function updatePassword(id: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword)
  await db
    .updateTable('users')
    .set({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
}

export async function setLastLogin(id: string): Promise<void> {
  await db
    .updateTable('users')
    .set({ last_login_at: new Date().toISOString() })
    .where('id', '=', id)
    .execute()
}

export async function deleteUser(id: string): Promise<void> {
  await db.deleteFrom('users').where('id', '=', id).execute()
}

export async function createSession(userId: string, tokenHash: string, expiresAt: Date, ipAddress: string | null, userAgent: string | null): Promise<Session> {
  const id = randomUUID()
  const now = new Date().toISOString()

  await db
    .insertInto('sessions')
    .values({
      id,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
      ip_address: ipAddress,
      user_agent: userAgent,
      created_at: now,
    })
    .execute()

  return findSessionByIdOrThrow(id)
}

export async function findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
  const row = await db
    .selectFrom('sessions')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst()

  return row ? mapRowToSession(row) : null
}

export async function findSessionById(id: string): Promise<Session | null> {
  const row = await db
    .selectFrom('sessions')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()

  return row ? mapRowToSession(row) : null
}

export async function findSessionByIdOrThrow(id: string): Promise<Session> {
  const session = await findSessionById(id)
  if (!session) throw new Error(`Session ${id} not found`)
  return session
}

export async function deleteSession(id: string): Promise<void> {
  await db.deleteFrom('sessions').where('id', '=', id).execute()
}

export async function deleteSessionsForUser(userId: string): Promise<void> {
  await db.deleteFrom('sessions').where('user_id', '=', userId).execute()
}

export async function deleteExpiredSessions(): Promise<number> {
  const result = await db
    .deleteFrom('sessions')
    .where('expires_at', '<', new Date().toISOString())
    .executeTakeFirst()

  return Number(result?.numDeletedRows ?? 0)
}

function mapRowToUser(row: { id: string; email: string; password_hash: string; name: string | null; role: string; is_active: number; last_login_at: string | null; created_at: string; updated_at: string }): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as User['role'],
    isActive: toBool(row.is_active),
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function mapRowToSession(row: { id: string; user_id: string; token_hash: string; expires_at: string; ip_address: string | null; user_agent: string | null; created_at: string }): Session {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: new Date(row.expires_at),
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: new Date(row.created_at),
  }
}