import { useEffect, type ReactNode } from 'react'
import { CloudOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import { useProfile } from './useProfile'
import Onboarding from './Onboarding'

type AppStore = { user: { id: string } | null; signOut?: () => Promise<unknown> }

// Between sign-in and the app: loads the profile, sends a new account through the onboarding
// (kept on screen until the plan suggestion is answered) and only then renders the app.
export default function ProfileGate({ children }: { children: ReactNode }) {
  const userId = useStore((s: AppStore) => s.user?.id ?? null)
  const signOut = useStore((s: AppStore) => s.signOut)
  const { status, userId: loadedFor, onboarding, load } = useProfile()

  useEffect(() => {
    if (userId && (loadedFor !== userId || status === 'idle')) load(userId)
  }, [userId, loadedFor, status, load])

  if (status === 'missing' || (status === 'ready' && onboarding)) return <Onboarding />
  if (status === 'ready') return <>{children}</>
  if (status === 'error') {
    return (
      <main className="flex min-h-dvh flex-col bg-background font-sans text-foreground">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-between gap-10 px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(5rem+env(safe-area-inset-top))]">
          <section role="alert" className="flex flex-col items-start gap-4">
            <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <CloudOff aria-hidden className="size-6" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{t('Could not load your profile.')}</h1>
            <p className="text-base leading-relaxed text-muted-foreground text-pretty">{t('Check your connection and try again.')}</p>
          </section>
          <div className="flex flex-col gap-2">
            <Button size="lg" className="h-14 w-full rounded-2xl text-base font-semibold" onClick={() => userId && load(userId)}>
              {t('Try again')}
            </Button>
            {signOut && (
              <Button size="lg" variant="ghost" className="h-12 w-full rounded-2xl text-base text-muted-foreground" onClick={() => signOut()}>
                {t('Sign out')}
              </Button>
            )}
          </div>
        </div>
      </main>
    )
  }
  // Loading: the shape of the first screen (header, hero card, two rows), not a spinner.
  return (
    <main aria-busy="true" aria-label={t('Loading…')} className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 pt-[calc(1.5rem+env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-36 rounded-lg" />
          <Skeleton className="size-11 rounded-full" />
        </div>
        <Skeleton className="mt-4 h-40 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-20 w-full rounded-2xl" />
      </div>
    </main>
  )
}
