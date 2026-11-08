import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import {
  deleteProvider,
  findProviders,
  upsertProvider,
} from '@/lib/db/repositories/emailProviderRepository'

async function withAuth(req: NextRequest, handler: () => Promise<NextResponse>) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth
  return handler()
}

export async function GET(req: NextRequest) {
  return withAuth(req, async () => {
    try {
      // No seed side effect on a read: GET must not mutate the database.
      const providers = await findProviders()
      // Strip smtpPass from the response (write-only credential).
      const safe = providers.map((p) => ({ ...p, smtpPass: '' }))
      return NextResponse.json({ success: true, data: safe })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 500 })
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuth(req, async () => {
    try {
      const body = await req.json().catch(() => ({}))
      // Create: no id → upsertProvider inserts a new row.
      const result = await upsertProvider({
        providerName: body.providerName,
        smtpHost: body.smtpHost,
        smtpPort: Number(body.smtpPort),
        smtpUser: body.smtpUser,
        smtpPass: body.smtpPass,
        isDefault: !!body.isDefault,
      })
      return NextResponse.json({ success: true, data: result })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'create failed' }, { status: 500 })
    }
  })
}

export async function PATCH(req: NextRequest) {
  return withAuth(req, async () => {
    try {
      const body = await req.json().catch(() => ({}))
      if (!body.id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 })
      }
      // Update an existing provider by id.
      const result = await upsertProvider({
        id: body.id,
        providerName: body.providerName,
        smtpHost: body.smtpHost,
        smtpPort: Number(body.smtpPort),
        smtpUser: body.smtpUser,
        smtpPass: body.smtpPass,
        isDefault: !!body.isDefault,
      })
      return NextResponse.json({ success: true, data: result })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'update failed' }, { status: 500 })
    }
  })
}

export async function DELETE(req: NextRequest) {
  return withAuth(req, async () => {
    try {
      const { searchParams } = new URL(req.url)
      const id = searchParams.get('id')
      if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 })
      }
      await deleteProvider(id)
      const providers = await findProviders()
      const safe = providers.map((p) => ({ ...p, smtpPass: '' }))
      return NextResponse.json({ success: true, data: safe })
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || 'delete failed' }, { status: 500 })
    }
  })
}
