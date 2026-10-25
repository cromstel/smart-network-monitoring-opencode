import nodemailer from 'nodemailer'
import { findProviders } from '@/lib/db/repositories/emailProviderRepository'

export interface EmailPayload {
  to: string
  subject: string
  html: string
  text?: string
}

export async function sendEmail(payload: EmailPayload) {
  const providers = await findProviders()
  const defaultProvider = providers.find((p) => p.isDefault) ?? providers[0]
  if (!defaultProvider) throw new Error('No email provider configured')

  const transporter = nodemailer.createTransport({
    host: defaultProvider.smtpHost,
    port: defaultProvider.smtpPort,
    secure: defaultProvider.smtpPort === 465,
    auth: {
      user: defaultProvider.smtpUser,
      pass: defaultProvider.smtpPass,
    },
  })

  const info = await (async () => {
    try {
      return await transporter.sendMail({
        from: `"Network Monitor" <${defaultProvider.smtpUser || 'admin@network.local'}>`,
        to: payload.to,
        subject: payload.subject,
        text: payload.text ?? payload.html.replace(/<[^>]*>/g, ''),
        html: payload.html,
      })
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
      return await transporter.sendMail({
        from: `"Network Monitor" <${defaultProvider.smtpUser || 'admin@network.local'}>`,
        to: payload.to,
        subject: payload.subject,
        text: payload.text ?? payload.html.replace(/<[^>]*>/g, ''),
        html: payload.html,
      })
    }
  })()
  return info.messageId
}
