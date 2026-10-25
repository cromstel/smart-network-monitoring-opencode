import { randomUUID } from 'node:crypto'
import { db } from '../client'

export interface EmailProviderInput {
  providerName: string
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPass: string
  isDefault?: boolean
}

export async function seedDefaultGmail() {
  const existing = await db.selectFrom('email_providers').where('provider_name', '=', 'Gmail').selectAll().execute()
  if (existing.length > 0) return

  const id = randomUUID()
  await db.insertInto('email_providers').values({
    id,
    provider_name: 'Gmail',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_user: '',
    smtp_pass: '',
    is_default: 1,
    created_at: new Date().toISOString(),
  }).execute()
}

export async function findProviders() {
  const rows = await db.selectFrom('email_providers').selectAll().execute()
  return rows.map((r) => ({
    id: r.id as string,
    providerName: r.provider_name as string,
    smtpHost: r.smtp_host as string,
    smtpPort: Number(r.smtp_port),
    smtpUser: r.smtp_user as string,
    smtpPass: r.smtp_pass as string,
    isDefault: Number(r.is_default) === 1,
    createdAt: r.created_at as string,
  }))
}

export async function upsertProvider(input: EmailProviderInput & { id?: string }) {
  const now = new Date().toISOString()
  if (input.id) {
    await db.updateTable('email_providers').set({
      provider_name: input.providerName,
      smtp_host: input.smtpHost,
      smtp_port: input.smtpPort,
      smtp_user: input.smtpUser,
      smtp_pass: input.smtpPass,
      is_default: input.isDefault ? 1 : 0,
    }).where('id', '=', input.id).execute()
  } else {
    const id = randomUUID()
    await db.insertInto('email_providers').values({
      id,
      provider_name: input.providerName,
      smtp_host: input.smtpHost,
      smtp_port: input.smtpPort,
      smtp_user: input.smtpUser,
      smtp_pass: input.smtpPass,
      is_default: input.isDefault ? 1 : 0,
      created_at: now,
    }).execute()
    input.id = id
  }
  return await findProviders()
}
