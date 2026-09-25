import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { db } from '@/lib/db/client'
import { logger } from '@/lib/utils/logger'

interface RateLimitEntry {
  count: number
  resetAt: number
}

const memoryStore = new Map<string, RateLimitEntry>()

function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return 'unknown'
}

function makeKey(identifier: string, endpoint: string): string {
  return `${endpoint}:${identifier}`
}

export async function checkRateLimit(
  request: Request,
  endpoint: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const ip = getClientIp(request)
  const key = makeKey(ip, endpoint)
  const now = Date.now()

  let entry = memoryStore.get(key)
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs }
    memoryStore.set(key, entry)
  }

  entry.count += 1

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfter }
  }

  return { allowed: true }
}

export function createRateLimiter(
  endpoint: string,
  maxRequests: number,
  windowMs: number
) {
  return async (request: Request): Promise<NextResponse | null> => {
    const { allowed, retryAfter } = await checkRateLimit(request, endpoint, maxRequests, windowMs)

    if (!allowed) {
      logger.warn({ endpoint, ip: getClientIp(new Request(request.url, request)), retryAfter }, 'rate limit exceeded')
      return NextResponse.json(
        { error: 'RATE_LIMITED', message: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfter) },
        }
      )
    }
    return null
  }
}

export async function cleanupRateLimitStore(): Promise<number> {
  const now = Date.now()
  let cleaned = 0
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt < now) {
      memoryStore.delete(key)
      cleaned++
    }
  }
  return cleaned
}