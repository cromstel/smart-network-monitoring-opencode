import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/Providers'
import { ThemeScript } from '@/components/ThemeSync'

export const metadata: Metadata = {
  title: 'Home Network Monitor',
  description: 'Discover and monitor every device on your local network.',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* F-53: applies the remembered palette before first paint. */}
        <ThemeScript />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}