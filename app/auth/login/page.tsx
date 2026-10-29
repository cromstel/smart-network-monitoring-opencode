import { Instrument_Serif, Inter } from 'next/font/google'
import Link from 'next/link'
import { appName } from '@/lib/config/app'
import { LoginFormBoundary } from './LoginForm'

const instrumetal = Instrument_Serif({ subsets: ['latin'], weight: ['400'], display: 'swap' })
const inter = Inter({ subsets: ['latin'], display: 'swap' })

export default function LoginPage() {
  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070d1a] px-6 py-20 sm:px-10"
      style={{ fontFamily: inter.style.fontFamily }}
    >
      {/* Geometric atmospheric mesh */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.12),_transparent_60%),radial-gradient(ellipse_at_bottom_left,_rgba(245,158,11,0.08),_transparent_60%)]"
      />

      {/* Staggered reveal keyframes */}
      <style>{`
        @keyframes revealUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .reveal { animation: revealUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .reveal-d1 { animation-delay: 0.1s; }
        .reveal-d2 { animation-delay: 0.2s; }
        .reveal-d3 { animation-delay: 0.35s; }
      `}</style>

      {/* Asymmetric top: editorial headline left, logo right */}
      <section className="reveal reveal-d1 relative z-10 flex w-full max-w-md items-end gap-8 md:gap-12" aria-label="Brand">
        <div className="flex-1 min-w-0">
          <h1
            className={`${instrumetal.className} leading-[0.92] text-[3.5rem] tracking-[-0.04em] text-white sm:text-[4rem]`}
          >
            Sign in
          </h1>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.35em] text-amber-300/70">
            {appName()}
          </p>
        </div>
      </section>

      {/* Thin decorative rule */}
      <div aria-hidden="true" className="relative z-10 mt-8 h-px w-full max-w-sm bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Form — staggered reveal via CSS animation-class */}
      <section className="reveal reveal-d2 relative z-10 mt-8 w-full max-w-sm" aria-label="Login form">
        <LoginFormBoundary />
      </section>

      {/* Bottom link */}
      <p className="reveal reveal-d3 relative z-10 mt-6 text-xs text-slate-500" aria-label="Setup link">
        First run?{' '}
        <Link href="/auth/setup" className="text-blue-400 underline-offset-2 hover:text-blue-300 hover:underline">
          Create the admin account
        </Link>
      </p>
    </main>
  )
}
