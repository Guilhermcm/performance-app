import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { LoaderCircle, Lock, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '../../lib/i18n.js'
import { signInWithGoogle } from '../auth/auth'
import { useProgress } from '../gamification/useProgress'
import { acceptInvite, getInvite, toSocialError } from './social-api'
import { clearPendingInvite, readPendingInvite, savePendingInvite } from './pending-invite'
import { socialErrorText } from './labels'
import { useSocial } from './useSocial'
import { PersonAvatar } from './components/PersonAvatar'
import type { InviteInfo, Person, SocialErrorCode } from './types'

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; code: SocialErrorCode }
  | { kind: 'open'; info: InviteInfo }
  | { kind: 'accepting'; info: InviteInfo }
  | { kind: 'friends'; friend: Person }

const STATUS_ERROR: Record<Exclude<InviteInfo['status'], 'open'>, SocialErrorCode> = {
  expired: 'invite_expired', used: 'invite_used', self: 'self_invite', already_friends: 'already_friends'
}
const EASE_OUT = [0.22, 1, 0.36, 1] as const

// /convite/:code, with or without a session (Decision 2). Signed out: who invited, a promise of
// privacy and "Continue with Google", keeping the code for after the round trip. Signed in: one
// tap to accept, or no tap at all when this is the invite that sent the person to Google.
export default function InviteScreen({ code, signedIn }: { code: string; signedIn: boolean }) {
  const navigate = useNavigate()
  const reduce = useReducedMotion() ?? false
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [opening, setOpening] = useState(false)
  const auto = useRef(signedIn && readPendingInvite() === code)
  // Only the latest lookup may move the screen on (StrictMode runs the first effect twice in dev).
  const seq = useRef(0)

  const accept = useCallback(async (info: InviteInfo) => {
    setPhase({ kind: 'accepting', info })
    try {
      const friend = await acceptInvite(code)
      clearPendingInvite()
      setPhase({ kind: 'friends', friend })
      const s = useSocial.getState()
      void s.load('friends'); void s.load('weekly'); void s.load('alltime')
      // first_friend and any level it reaches show up as celebrations (CelebrationHost, 1a).
      void useProgress.getState().refresh()
    } catch (e) {
      const err = toSocialError(e).code
      if (err !== 'network') clearPendingInvite()
      setPhase({ kind: 'error', code: err })
    }
  }, [code])

  const fetchInfo = useCallback(async () => {
    const mine = ++seq.current
    setPhase({ kind: 'loading' })
    try {
      const info = await getInvite(code)
      if (mine !== seq.current) return
      if (info.status !== 'open') {
        clearPendingInvite()
        setPhase({ kind: 'error', code: STATUS_ERROR[info.status] })
        return
      }
      if (!signedIn) savePendingInvite(code)
      if (auto.current) { auto.current = false; await accept(info); return }
      setPhase({ kind: 'open', info })
    } catch (e) {
      if (mine !== seq.current) return
      const err = toSocialError(e).code
      if (err !== 'network') clearPendingInvite()
      setPhase({ kind: 'error', code: err })
    }
  }, [code, signedIn, accept])

  useEffect(() => { void fetchInfo() }, [fetchInfo])

  const signIn = async () => {
    savePendingInvite(code)
    setOpening(true)
    try {
      await signInWithGoogle()
    } catch {
      setOpening(false)
      toast.error(t('Could not start sign-in. Try again.'))
    }
  }

  const enter = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduce ? 0.15 : 0.3, ease: EASE_OUT }
  }

  let body: ReactNode
  if (phase.kind === 'loading') {
    body = (
      <div aria-busy="true" aria-label={t('Loading…')} className="flex flex-col items-center gap-4">
        <Skeleton className="size-24 rounded-full" /><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-64" />
      </div>
    )
  } else if (phase.kind === 'error') {
    const home = () => navigate('/home', { replace: true })
    body = (
      <motion.div {...enter} role="alert" className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground"><Users aria-hidden className="size-7" /></span>
        <p className="max-w-xs text-lg font-semibold leading-snug text-balance">{socialErrorText(phase.code)}</p>
        <div className="mt-2 flex w-full flex-col gap-2">
          {phase.code === 'network' && (
            <Button className="h-12 gap-2 rounded-2xl" onClick={() => void fetchInfo()}><RefreshCw aria-hidden className="size-4" />{t('Try again')}</Button>
          )}
          {!signedIn ? (
            <Button variant={phase.code === 'network' ? 'ghost' : 'default'} className="h-12 rounded-2xl" onClick={home}>{t('Sign in')}</Button>
          ) : phase.code === 'already_friends' ? (
            <Button className="h-12 rounded-2xl" onClick={() => navigate('/social/ranking', { replace: true })}>{t('See ranking')}</Button>
          ) : (
            <Button variant={phase.code === 'network' ? 'ghost' : 'default'} className="h-12 rounded-2xl" onClick={home}>{t('Go to Home')}</Button>
          )}
        </div>
      </motion.div>
    )
  } else if (phase.kind === 'friends') {
    const f = phase.friend
    body = (
      <motion.div initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.26, ease: EASE_OUT }} className="flex flex-col items-center gap-4 text-center">
        <PersonAvatar name={f.name} src={f.avatar_url} className="size-24 text-2xl ring-4 ring-primary" />
        <h1 role="status" className="text-2xl font-semibold tracking-tight">{t('You are friends now')}</h1>
        <p className="text-base text-muted-foreground">{t('{0} is in your ranking now.', f.name)}</p>
        <div className="mt-4 flex w-full flex-col gap-2">
          <Button className="h-12 rounded-2xl text-[15px] font-semibold" onClick={() => navigate('/social/ranking', { replace: true })}>{t('See ranking')}</Button>
          <Button variant="outline" className="h-12 rounded-2xl" onClick={() => navigate('/social/desafios?novo=1', { replace: true })}>{t('Create a challenge')}</Button>
        </div>
      </motion.div>
    )
  } else {
    const { info } = phase
    const busy = phase.kind === 'accepting'
    body = (
      <motion.div {...enter} className="flex flex-col items-center gap-4 text-center">
        <PersonAvatar name={info.inviter.name} src={info.inviter.avatar_url} className="size-24 text-2xl ring-4 ring-primary/30" />
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-balance">{t('{0} invited you to train together', info.inviter.name)}</h1>
        <p className="max-w-sm text-base leading-relaxed text-muted-foreground text-pretty">
          {t('See how consistent you both are, compete in the weekly ranking and take on challenges together.')}
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock aria-hidden className="size-4" />{t('Your weight, diet and loads stay private.')}</p>
        <div className="mt-4 w-full">
          {signedIn ? (
            <Button size="lg" className="h-14 w-full gap-2 rounded-2xl text-base font-semibold" disabled={busy} aria-busy={busy} onClick={() => void accept(info)}>
              {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}
              {busy ? t('Becoming friends…') : t('Accept invite')}
            </Button>
          ) : (
            <Button size="lg" className="h-14 w-full gap-3 rounded-2xl text-base font-semibold" disabled={opening} aria-busy={opening} onClick={signIn}>
              {opening && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}
              {opening ? t('Opening Google…') : t('Continue with Google')}
            </Button>
          )}
        </div>
      </motion.div>
    )
  }

  if (!signedIn) {
    return (
      <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background font-sans text-foreground">
        <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))]">
          <p className="mb-8 text-center font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary">Performance</p>
          {body}
        </div>
      </main>
    )
  }
  return <div className="mx-auto flex w-full max-w-md flex-col justify-center py-10 font-sans text-foreground">{body}</div>
}

// The route inside the signed-in app.
export function InviteRoute() {
  const { code } = useParams()
  return <InviteScreen code={code ?? ''} signedIn />
}
