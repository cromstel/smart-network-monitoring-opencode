import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getDeviceById, updateDeviceById } from '@/lib/services/deviceService'
import { toDeviceDTO } from '@/lib/api/serialisers'
import { requireAuth } from '@/lib/api/auth'
import { db } from '@/lib/db/client'

interface RouteContext {
  params: Promise<{ id: string }>
}

const DEVICE_TYPES = [
  'phone', 'tablet', 'laptop', 'desktop', 'tv', 'speaker',
  'printer', 'camera', 'server', 'switch', 'router', 'iot', 'unknown',
] as const

/**
 * `API.md` promises `deviceName`, `deviceType`, `categoryId` and `isIgnored`;
 * the repository's `DevicePatch` accepts all four. Everything here is optional
 * and at least one key must be present, so an empty body is a 400 rather than a
 * no-op write that reports success.
 *
 * `macAddress`, `ipAddress`, `firstSeen` and `status` are immutable by design
 * and are absent from the schema — an unknown key is stripped by Zod, so a
 * client cannot smuggle them past the allowlist.
 */
const updateSchema = z
  .object({
    deviceName: z.string().max(100).optional(),
    deviceType: z.enum(DEVICE_TYPES).optional(),
    categoryId: z.string().min(1).max(64).nullable().optional(),
    isIgnored: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No valid fields to update',
  })

export async function GET(request: Request, context: RouteContext) {
  const authResult = await requireAuth(['VIEWER', 'MEMBER', 'ADMIN'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { id } = await context.params

  const device = await getDeviceById(id)
  if (!device) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Device not found.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ data: toDeviceDTO(device) })
}

export async function PATCH(request: Request, context: RouteContext) {
  const authResult = await requireAuth(['ADMIN', 'MEMBER'])

  if (authResult instanceof NextResponse) {
    return authResult
  }

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'INVALID_BODY',
        message: 'Invalid device patch',
        details: parsed.error.flatten(),
      },
      { status: 400 }
    )
  }

  // Built key by key on purpose. `deviceRepository.update()` decides what to
  // write with `'categoryId' in patch` — a key present but `undefined` would
  // match that test and null the stored category on a plain rename. Only keys
  // the caller actually sent are forwarded, so an untouched field is never
  // rewritten.
  const patch: {
    deviceName?: string | null
    deviceType?: string
    categoryId?: string | null
    isIgnored?: boolean
  } = {}
  const input = parsed.data

  if (input.deviceName !== undefined) patch.deviceName = input.deviceName || null
  if (input.deviceType !== undefined) patch.deviceType = input.deviceType
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId
  if (input.isIgnored !== undefined) patch.isIgnored = input.isIgnored

  // Deterministic rather than relying on `.refine` alone: an object whose keys
  // are all absent must not degrade into an `updated_at`-only no-op write.
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'INVALID_BODY', message: 'No valid fields to update' },
      { status: 400 }
    )
  }

  // `device_categories` has no CRUD of its own, so a category id can only come
  // from the client — and an unknown one would hit `fk_devices_category` and
  // throw out of the handler, surfacing as an unhandled 500. Checking first
  // keeps user input at 400 (`API.md`: never leak a raw exception).
  if (patch.categoryId != null) {
    const category = await db
      .selectFrom('device_categories')
      .select('id')
      .where('id', '=', patch.categoryId)
      .executeTakeFirst()
    if (!category) {
      return NextResponse.json(
        { error: 'INVALID_BODY', message: 'Unknown categoryId' },
        { status: 400 }
      )
    }
  }

  const updated = await updateDeviceById(id, patch)

  if (!updated) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Device not found.' },
      { status: 404 }
    )
  }

  const device = await getDeviceById(id)
  if (!device) {
    return NextResponse.json(
      { error: 'NOT_FOUND', message: 'Device not found after update.' },
      { status: 404 }
    )
  }

  return NextResponse.json({ data: toDeviceDTO(device) })
}