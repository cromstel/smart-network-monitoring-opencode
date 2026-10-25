import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { seedDefaultGmail, findProviders, upsertProvider } from '@/lib/db/repositories/emailProviderRepository'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  try {
    await seedDefaultGmail()
    const providers = await findProviders()
    // Strip smtpPass from response
    const safe = providers.map((p) => ({ ...p, smtpPass: '' }))
    return NextResponse.json({ success: true, data: safe })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(['ADMIN'])
  if (auth instanceof NextResponse) return auth

  const body = await req.json().catch(() => ({}))
  const result = await upsertProvider({
    providerName: body.providerName,
    smtpHost: body.smtpHost,
    smtpPort: Number(body.smtpPort),
    smtpUser: body.smtpUser,
    smtpPass: body.smtpPass,
    isDefault: !!body.isDefault,
  })
  return NextResponse.json({ success: true, data: result })
}
