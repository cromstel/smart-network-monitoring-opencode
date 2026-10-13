import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/api/auth'
import { apiError } from '@/lib/api/errors'
import { findRouterConfig, upsertRouterConfig } from '@/lib/db/repositories/settingsRepository'
import { encrypt } from '@/lib/utils/encryption'
import type { RouterConfig, RouterType } from '@/lib/types/router'

export const dynamic = 'force-dynamic'

const ROUTER_TYPES = ['asus', 'tplink', 'netgear', 'generic'] as const satisfies readonly RouterType[]

const saveSchema = z.object({
  routerType: z.enum(ROUTER_TYPES),
  routerName: z.string().max(120).optional(),
  routerIp: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'Expected a dotted-quad IPv4 address'),
  port: z.number().int().min(1).max(65535).default(80),
  username: z.string().min(1).default('admin'),
  password: z.string().min(1, 'Password is required'),
})

/**
 * The stored ciphertext never leaves the server: GET returns the connection
 * fields so the form can show what is configured, minus the credential.
 *
 * Allow-listed field by field on purpose — a future credential column added to
 * RouterConfig must be dropped here deliberately, not leaked by a spread.
 */
function publicView(config: RouterConfig): Omit<RouterConfig, 'passwordEncrypted'> {
  return {
    id: config.id,
    routerType: config.routerType,
    routerName: config.routerName,
    routerIp: config.routerIp,
    port: config.port,
    username: config.username,
    macAddress: config.macAddress,
    modelNumber: config.modelNumber,
    firmwareVersion: config.firmwareVersion,
    isConnected: config.isConnected,
    lastCheckAt: config.lastCheckAt,
    lastSuccessAt: config.lastSuccessAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

export async function GET() {
  const auth = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])
  if (auth instanceof NextResponse) return auth

  const config = await findRouterConfig()
  return NextResponse.json({ data: config ? publicView(config) : null })
}

export async function POST(request: Request) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError(400, 'INVALID_BODY', 'Invalid JSON in request body')
  }

  const parsed = saveSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'INVALID_BODY', 'Invalid router configuration', parsed.error.flatten())
  }

  const data = parsed.data

  // Password in, ciphertext out — the plaintext exists only inside this call.
  const fields = {
    routerType: data.routerType,
    routerName: data.routerName ?? null,
    routerIp: data.routerIp,
    port: data.port,
    username: data.username,
    passwordEncrypted: encrypt(data.password),
    // Both consumers of this row (findRouterConfig() and asusScanner's
    // config query) select on is_connected = 1, and nothing else ever sets
    // it: a saved-but-unflagged row would be invisible and SCANNER_MODE=asus
    // could never activate. The scanner re-verifies reachability with a live
    // request before it is selected, so a wrong address degrades to "not
    // available" rather than to a failing scan loop.
    isConnected: true,
  }

  // Idempotent: a second save updates the active config instead of leaving
  // two is_connected = 1 rows behind for findRouterConfig() to arbitrate.
  const existing = await findRouterConfig()
  const saved = await upsertRouterConfig(existing ? { id: existing.id, ...fields } : fields)

  return NextResponse.json({ data: publicView(saved) })
}
