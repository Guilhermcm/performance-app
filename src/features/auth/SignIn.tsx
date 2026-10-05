import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabaseConfigured } from '@/lib/supabase'
import { t } from '../../lib/i18n.js'
import { signInWithGoogle } from './auth'

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const

export default function SignIn() {
  const reduce = useReducedMotion()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      // On success the browser leaves for Google; the button stays busy until it does.
      await signInWithGoogle()
    } catch (e) {
      setError((e as Error).message || t('Could not start sign-in. Try again.'))
      setBusy(false)
    }
  }

  // Reduced motion keeps the fade and drops the travel.
  const enter = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0.15 : 0.3, ease: EASE_OUT, delay: reduce ? 0 : delay }
  })

  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background font-sans text-foreground">
      <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-between gap-12 px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))]">
        <motion.section {...enter(0)}>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary">Performance</p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-balance">
            {t('Train, track, keep the streak.')}
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground text-pretty">
            {t('Your workouts, your progress and your consistency — with your friends.')}
          </p>
        </motion.section>

        <motion.div {...enter(0.08)} className="flex flex-col gap-3">
          {!supabaseConfigured && (
            <p role="alert" className="rounded-xl bg-destructive/15 px-4 py-3 text-sm leading-snug text-destructive">
              {t('The server is not configured yet.')}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-destructive/15 px-4 py-3 text-sm leading-snug text-destructive">{error}</p>
          )}
          <Button
            size="lg"
            className="h-14 w-full gap-3 rounded-2xl text-base font-semibold active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
            onClick={start}
            disabled={busy || !supabaseConfigured}
            aria-busy={busy}
          >
            {busy ? <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" /> : <GoogleMark />}
            {busy ? t('Opening Google…') : t('Continue with Google')}
          </Button>
          {/* A plain link, not a route: the policy is a static page outside the hash router. */}
          <a href="/privacidade"
            className="mx-auto mt-2 inline-flex min-h-11 items-center px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            {t('Privacy policy')}
          </a>
        </motion.div>
      </div>
    </main>
  )
}
