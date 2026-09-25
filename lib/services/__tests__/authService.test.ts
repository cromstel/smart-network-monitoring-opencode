jest.mock('@/lib/utils/crypto', () => ({
  verifyPassword: jest.fn(),
  hashTokenAsync: jest.fn(),
  generateToken: jest.fn(),
  hashPassword: jest.fn(),
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/db/repositories/userRepository', () => ({
  findByEmail: jest.fn(),
  findByEmailWithPassword: jest.fn(),
  createUser: jest.fn(),
  findById: jest.fn(),
  findByIdOrThrow: jest.fn(),
  findSessionByTokenHash: jest.fn(),
  createSession: jest.fn(),
  setLastLogin: jest.fn(),
  deleteSession: jest.fn(),
  deleteSessionsForUser: jest.fn(),
  updatePassword: jest.fn(),
  updateUser: jest.fn(),
}))

import { createUser, authenticate, validateSession, logout, changePassword, requireRole } from '../authService'
import * as userRepo from '@/lib/db/repositories/userRepository'
import * as crypto from '@/lib/utils/crypto'
import { logger } from '@/lib/utils/logger'

const mockVerifyPassword = jest.mocked(crypto.verifyPassword)
const mockHashTokenAsync = jest.mocked(crypto.hashTokenAsync)
const mockGenerateToken = jest.mocked(crypto.generateToken)
const mockHashPassword = jest.mocked(crypto.hashPassword)
const mockedUserRepo = jest.mocked(userRepo)
const mockedLogger = logger

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyPassword.mockResolvedValue(false)
    mockHashTokenAsync.mockResolvedValue('hash')
    mockGenerateToken.mockReturnValue('token123')
    mockHashPassword.mockResolvedValue('hashed')
  })

  describe('createUser', () => {
    it('creates a new user', async () => {
      mockedUserRepo.findByEmail.mockResolvedValue(null)
      const user = {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'VIEWER' as const,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      mockedUserRepo.createUser.mockResolvedValue(user)

      const result = await createUser({ email: 'test@example.com', password: 'password123', name: 'Test User' })

      expect(result).toEqual(user)
      expect(mockedUserRepo.createUser).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        name: 'Test User',
      })
    })

    it('throws if email already exists', async () => {
      mockedUserRepo.findByEmail.mockResolvedValue({ id: 'u1' } as any)

      await expect(createUser({ email: 'existing@example.com', password: 'password123' })).rejects.toThrow('Email already registered')
    })
  })

  describe('authenticate', () => {
    it('returns user and session for valid credentials', async () => {
      const user = {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'VIEWER' as const,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const session = {
        id: 's1',
        userId: 'u1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
        token: 'token123',
      }

      mockedUserRepo.findByEmailWithPassword.mockResolvedValue({ user, passwordHash: 'hashed' })
      mockVerifyPassword.mockResolvedValue(true)
      mockGenerateToken.mockReturnValue('token123')
      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.createSession.mockResolvedValue({ ...session, token: 'token123' } as any)
      mockedUserRepo.setLastLogin.mockResolvedValue(undefined)

      const result = await authenticate('test@example.com', 'password123')

      expect(result).not.toBeNull()
      expect(result?.user).toEqual(user)
      expect(result?.session.token).toBe('token123')
    })

    it('returns null for invalid email', async () => {
      mockedUserRepo.findByEmailWithPassword.mockResolvedValue(null)

      const result = await authenticate('nonexistent@example.com', 'password123')

      expect(result).toBeNull()
    })

    it('returns null for wrong password', async () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'VIEWER' as const, isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }
      mockedUserRepo.findByEmailWithPassword.mockResolvedValue({ user, passwordHash: 'hashed' })
      mockVerifyPassword.mockResolvedValue(false)

      const result = await authenticate('test@example.com', 'wrongpassword')

      expect(result).toBeNull()
    })

    it('returns null for inactive user', async () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'VIEWER' as const, isActive: false, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }
      mockedUserRepo.findByEmailWithPassword.mockResolvedValue({ user, passwordHash: 'hashed' })
      mockVerifyPassword.mockResolvedValue(true)

      const result = await authenticate('test@example.com', 'password123')

      expect(result).toBeNull()
    })
  })

  describe('validateSession', () => {
    it('returns user and session for valid token', async () => {
      const user = {
        id: 'u1',
        email: 'test@example.com',
        name: 'Test User',
        role: 'VIEWER' as const,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const session = {
        id: 's1',
        userId: 'u1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      }

      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.findSessionByTokenHash.mockResolvedValue(session)
      mockedUserRepo.findById.mockResolvedValue(user)

      const result = await validateSession('token123')

      expect(result).not.toBeNull()
      expect(result?.user).toEqual(user)
      expect(result?.session).toEqual(session)
    })

    it('returns null for expired session', async () => {
      const session = {
        id: 's1',
        userId: 'u1',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() - 1000),
        ipAddress: null,
        userAgent: null,
        createdAt: new Date(),
      }

      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.findSessionByTokenHash.mockResolvedValue(session)

      const result = await validateSession('token123')

      expect(result).toBeNull()
      expect(mockedUserRepo.deleteSession).toHaveBeenCalledWith('s1')
    })

    it('returns null for invalid token', async () => {
      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.findSessionByTokenHash.mockResolvedValue(null)

      const result = await validateSession('invalid')

      expect(result).toBeNull()
    })

    it('returns null for inactive user', async () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'VIEWER' as const, isActive: false, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }
      const session = { id: 's1', userId: 'u1', tokenHash: 'hash', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), ipAddress: null, userAgent: null, createdAt: new Date() }

      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.findSessionByTokenHash.mockResolvedValue(session)
      mockedUserRepo.findById.mockResolvedValue(user)

      const result = await validateSession('token123')

      expect(result).toBeNull()
    })
  })

  describe('logout', () => {
    it('deletes session for valid token', async () => {
      const session = { id: 's1', userId: 'u1', tokenHash: 'hash', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), ipAddress: null, userAgent: null, createdAt: new Date() }

      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.findSessionByTokenHash.mockResolvedValue(session)

      await logout('token123')

      expect(mockedUserRepo.deleteSession).toHaveBeenCalledWith('s1')
    })

    it('does nothing for invalid token', async () => {
      mockHashTokenAsync.mockResolvedValue('hash')
      mockedUserRepo.findSessionByTokenHash.mockResolvedValue(null)

      await logout('invalid')

      expect(mockedUserRepo.deleteSession).not.toHaveBeenCalled()
    })
  })

  describe('changePassword', () => {
    it('changes password and revokes sessions', async () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'VIEWER' as const, isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }

      mockedUserRepo.findByIdOrThrow.mockResolvedValue(user)
      mockedUserRepo.findByEmailWithPassword.mockResolvedValue({ user, passwordHash: 'hashed' })
      mockVerifyPassword.mockResolvedValue(true)
      mockedUserRepo.updatePassword.mockResolvedValue(undefined)
      mockedUserRepo.deleteSessionsForUser.mockResolvedValue(undefined)

      const result = await changePassword('u1', 'oldpass', 'newpass')

      expect(result).toBe(true)
      expect(mockedUserRepo.updatePassword).toHaveBeenCalledWith('u1', 'newpass')
      expect(mockedUserRepo.deleteSessionsForUser).toHaveBeenCalledWith('u1')
    })

    it('returns false for wrong current password', async () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'VIEWER' as const, isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }

      mockedUserRepo.findByIdOrThrow.mockResolvedValue(user)
      mockedUserRepo.findByEmailWithPassword.mockResolvedValue({ user, passwordHash: 'hashed' })
      mockVerifyPassword.mockResolvedValue(false)

      const result = await changePassword('u1', 'wrong', 'newpass')

      expect(result).toBe(false)
    })
  })

  describe('requireRole', () => {
    it('passes for allowed role', () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'ADMIN' as const, isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }

      expect(() => requireRole(user, 'ADMIN', 'MEMBER')).not.toThrow()
    })

    it('throws for disallowed role', () => {
      const user = { id: 'u1', email: 'test@example.com', name: null, role: 'VIEWER' as const, isActive: true, lastLoginAt: null, createdAt: new Date(), updatedAt: new Date() }

      expect(() => requireRole(user, 'ADMIN')).toThrow('FORBIDDEN')
    })

    it('throws for null user', () => {
      expect(() => requireRole(null, 'VIEWER')).toThrow('UNAUTHENTICATED')
    })
  })
})