import { Inter } from 'next/font/google'
import Link from 'next/link'
import { appName } from '@/lib/config/app'
import { LoginFormBoundary } from './LoginForm'

const inter = Inter({ subsets: ['latin'], display: 'swap' })

const revealCSS = `
  @keyframes revealUp {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes radarSweep {
    0%   { background-position: 0% 50%; opacity: 0.65; }
    50%  { background-position: 100% 0%; opacity: 0.9; }
    100% { background-position: 0% 50%; opacity: 0.65; }
  }
  .reveal { animation: revealUp 0.7s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .reveal-d1 { animation-delay: 0.1s; }
  .reveal-d2 { animation-delay: 0.2s; }
  .reveal-d3 { animation-delay: 0.35s; }
  @media (prefers-reduced-motion: reduce) {
    .reveal { animation: none; }
  }
`;

export default function LoginPage() {
  return (
    <main
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070d1a] px-6 py-20 sm:px-10"
      style={{ fontFamily: inter.style.fontFamily }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-[-1] -inset-8 bg-[length:150%_150%] bg-[radial-gradient(circle_at_50%_40%,_rgba(74,222,128,0.55),_transparent_55%)] animate-[radarSweep_6s_linear_infinite]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute z-[-1] -inset-8 bg-[length:150%_150%] bg-[radial-gradient(circle_at_50%_60%,_rgba(163,230,53,0.45),_transparent_55%)] animate-[radarSweep_6s_linear_infinite]"
      />

      {/* Geometric atmospheric mesh */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_rgba(59,130,246,0.12),_transparent_60%),radial-gradient(ellipse_at_bottom_left,_rgba(245,158,11,0.08),_transparent_60%)]"
      />

      {/* Staggered reveal keyframes */}
      <style dangerouslySetInnerHTML={{ __html: revealCSS }} />

      {/* The page <h1> is the app name inside the form card (LoginForm.tsx);
          no separate headline or rule above the card. */}

      {/* Form — staggered reveal via CSS animation-class */}
      <section className="reveal reveal-d2 relative z-10 mt-8 w-full max-w-sm" aria-label="Login form">
        <LoginFormBoundary appName={appName()} />
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
