export type UserRole = 'ADMIN' | 'MEMBER' | 'VIEWER'

export const USER_ROLES: readonly UserRole[] = ['ADMIN', 'MEMBER', 'VIEWER'] as const

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value)
}

export interface User {
  id: string
  email: string
  name: string | null
  role: UserRole
  isActive: boolean
  lastLoginAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Session {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
}

export interface SessionWithToken extends Session {
  token: string
}

export interface CreateUserInput {
  email: string
  password: string
  name?: string | null
  role?: UserRole
}

export interface UserPatch {
  name?: string | null
  role?: UserRole
  isActive?: boolean
}