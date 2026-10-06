import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, CircleCheck, LoaderCircle, Swords, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useProgress } from '../gamification/useProgress'
import { useProfile } from '../profile/useProfile'
import NutritionSetup from '../nutrition/NutritionSetup'
import { joinChallenge, leaveChallenge, toSocialError } from './social-api'
import { useSocial } from './useSocial'
import { MODE_TEXT, TEMPLATE_TEXT, amountText, nutritionOptInText, socialErrorText } from './labels'
import { canJoin, challengeShare, resultOn } from './templates'
import { fmtShortDay } from './format'
import { statusLine } from './ChallengesPanel'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, StaleNote } from './components/states'
import { ACCENT_TEXT } from '../gamification/components/accent'
import type { Challenge } from './types'

// /social/desafios/:id: the rule, where the team (or I) stand against the goal, each member, and
// the one action that fits: join or decline an invitation, leave (after a confirmation), or the
// result once it ended. After the last day there is no action at all. A nutrition challenge counts
// closed days only (up to the day before yesterday) and gives its result later; joining it asks for
// the opt-in, and with the pillar off the join button opens the pillar's setup instead.
export default function ChallengeDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const res = useSocial(s => s.challenges)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [shareVolume, setShareVolume] = useState(false)
  const [shareNutrition, setShareNutrition] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const nutritionOn = useProfile(s => s.profile?.nutrition_enabled ?? false)
  useEffect(() => { void useSocial.getState().load('challenges') }, [])
  const c = res.data?.find(x => x.id === id) ?? null
  const today = todayISO()

  const act = async (run: () => Promise<void>, done: string, after?: () => void) => {
    setBusy(true)
    try {
      await run()
      toast.success(done)
      await useSocial.getState().load('challenges')
      void useProgress.getState().refresh()
      after?.()
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
      void useSocial.getState().load('challenges')
    } finally {
      setBusy(false)
    }
  }
  const toList = () => navigate('/social/desafios', { replace: true })

  const header = (
    <header className="-ml-2 flex h-11 items-center">
      <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate(-1)}>
        <ArrowLeft className="size-5" />
      </Button>
    </header>
  )
  const page = (children: ReactNode) => <div className="mx-auto flex w-full max-w-md flex-col pb-6 font-sans text-foreground">{header}{children}</div>

  if (!c) {
    if (res.data) return page(<div className="mt-4"><EmptyState icon={Swords} title={socialErrorText('challenge_not_found')} /></div>)
    if (res.status === 'error' && res.error) return page(<div className="mt-4"><ErrorState code={res.error} onRetry={() => void useSocial.getState().load('challenges')} /></div>)
    return page(
      <div aria-busy="true" aria-label={t('Loading…')} className="mt-2 flex flex-col gap-3">
        <Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-64" /><Skeleton className="h-32 w-full rounded-3xl" />
        <Skeleton className="h-14 w-full rounded-2xl" /><Skeleton className="h-14 w-full rounded-2xl" />
      </div>
    )
  }

  const tx = TEMPLATE_TEXT[c.template]
  const Icon = tx.icon
  const mine = c.members.find(m => m.me)
  const value = c.mode === 'team' ? c.total : (mine?.progress ?? 0)
  const invited = c.status === 'active' && !c.me.joined
  const joinable = canJoin(c, today)
  const needsVolume = joinable && c.template === 'volume_total'
  const nutrition = c.template === 'nutrition_days_on_target'
  const needsNutrition = joinable && nutrition
  const blocked = (needsVolume && !shareVolume) || (needsNutrition && !shareNutrition)
  const optIn = nutritionOptInText()

  return page(
    <>
      <p className="mt-1 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Icon aria-hidden className={cn('size-4 shrink-0', ACCENT_TEXT)} />{tx.name()} · {MODE_TEXT[c.mode].name()}
      </p>
      <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight text-balance">{c.title}</h1>
      <p className="mt-1 text-sm tabular-nums text-muted-foreground">
        {t('{0} to {1}', fmtShortDay(c.starts_on), fmtShortDay(c.ends_on))} · {statusLine(c, today)}
      </p>
      {res.stale && <div className="mt-2"><StaleNote stale /></div>}
      <p className="mt-3 text-sm leading-snug text-muted-foreground text-pretty">{tx.rule()} {MODE_TEXT[c.mode].detail()}</p>
      {nutrition && c.status === 'active' && (
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {/* Nothing is counted before the first day. */}
          {today >= c.starts_on && <span>{t('Counting up to the day before yesterday')}</span>}
          {/* After the last day the header already says it. */}
          {today <= c.ends_on && <span className="tabular-nums">{t('Result on {0}', fmtShortDay(resultOn(c)))}</span>}
        </p>
      )}

      {c.status !== 'active' && <Result c={c} />}

      {!invited && (
        <section aria-labelledby="challenge-progress" className="mt-5 rounded-3xl border border-border bg-card p-5">
          <h2 id="challenge-progress" className="text-sm font-medium text-muted-foreground">{c.mode === 'team' ? t('Team total') : t('Your progress')}</h2>
          <p className="mt-1 font-mono text-3xl font-semibold tabular-nums">{amountText(c.template, value)}</p>
          <p className="text-sm tabular-nums text-muted-foreground">{t('Goal: {0}', amountText(c.template, c.target))}</p>
          <div role="progressbar" aria-label={c.mode === 'team' ? t('Team total') : t('Your progress')}
            aria-valuemin={0} aria-valuemax={c.target} aria-valuenow={value}
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-primary/15">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{ width: `${challengeShare(c) * 100}%` }} />
          </div>
        </section>
      )}

      <section aria-label={t('Members')} className="mt-6">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('Members')}</h2>
        <ul className="mt-2 flex list-none flex-col gap-2 p-0">
          {c.members.map(m => (
            <li key={m.id} className={cn('flex min-h-14 items-center gap-3 rounded-2xl px-3 py-2', m.me ? 'bg-primary/10' : 'bg-card')}>
              <PersonAvatar name={m.name} src={m.avatar_url} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[15px] font-medium">
                  <span className="truncate">{m.name}</span>
                  {m.me && <span className={cn('shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold', ACCENT_TEXT)}>{t('You')}</span>}
                </span>
                {/* The amount sits under the name, so a long name keeps the whole width. */}
                <span className="mt-0.5 flex items-center gap-3">
                  {m.joined ? (
                    <>
                      <span className="shrink-0 font-mono text-[13px] tabular-nums text-muted-foreground">{amountText(c.template, m.progress ?? 0)}</span>
                      {c.mode === 'solo' && (
                        <span aria-hidden className="block h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-primary/15">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(1, (m.progress ?? 0) / c.target) * 100}%` }} />
                        </span>
                      )}
                    </>
                  ) : <span className="text-[13px] text-muted-foreground">{t('Invited')}</span>}
                </span>
              </span>
              {m.won && <CircleCheck role="img" aria-label={t('Reached the goal')} className={cn('size-5 shrink-0', ACCENT_TEXT)} />}
            </li>
          ))}
        </ul>
      </section>

      {/* Past ends_on the server refuses join and leave (challenge_closed) even while a nutrition
          challenge stays active for its grace days, so no action is offered: only status and result. */}
      {c.status === 'active' && today <= c.ends_on && (
        <div className="mt-6 flex flex-col gap-2">
          {invited ? (
            <>
              {joinable && (
                <>
                  {needsVolume && (
                    <div className="flex items-start gap-3 rounded-2xl border border-border p-3">
                      <label htmlFor="join-volume" className="flex-1 cursor-pointer">
                        <span className="block text-[15px] font-medium">{t('Share my volume in this challenge')}</span>
                        <span className="block text-xs leading-snug text-muted-foreground">{t('People in this challenge see how many tonnes you lift. Never the load of each exercise.')}</span>
                      </label>
                      <Switch id="join-volume" checked={shareVolume} onCheckedChange={setShareVolume} />
                    </div>
                  )}
                  {needsNutrition && nutritionOn && (
                    <div className="flex items-start gap-3 rounded-2xl border border-border p-3">
                      <label htmlFor="join-nutrition" className="flex-1 cursor-pointer">
                        <span className="block text-[15px] font-medium">{optIn.label}</span>
                        <span className="block text-xs leading-snug text-muted-foreground">{optIn.detail}</span>
                      </label>
                      <Switch id="join-nutrition" checked={shareNutrition} onCheckedChange={setShareNutrition} />
                    </div>
                  )}
                  {needsNutrition && !nutritionOn ? (
                    <Button className="h-12 rounded-2xl text-[15px] font-semibold" onClick={() => setSetupOpen(true)}>
                      {t('Turn on the Nutrition pillar to join')}
                    </Button>
                  ) : (
                    <Button className="h-12 gap-2 rounded-2xl text-[15px] font-semibold" disabled={busy || blocked} aria-busy={busy}
                      onClick={() => act(() => joinChallenge(c.id, { shareVolume: needsVolume && shareVolume, shareNutrition: needsNutrition && shareNutrition }), t('You joined the challenge'))}>
                      {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}{t('Join challenge')}
                    </Button>
                  )}
                </>
              )}
              <Button variant="ghost" className="h-12 rounded-2xl" disabled={busy}
                onClick={() => act(() => leaveChallenge(c.id), t('Invitation declined'), toList)}>{t('Decline')}</Button>
            </>
          ) : leaving ? (
            <div role="alertdialog" aria-labelledby="leave-question" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
              <p id="leave-question" className="text-sm leading-snug">{t('Leave this challenge? Your progress stops counting for it.')}</p>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12 rounded-xl" autoFocus onClick={() => setLeaving(false)}>{t('Cancel')}</Button>
                <Button variant="destructive" className="h-12 rounded-xl" disabled={busy} aria-busy={busy}
                  onClick={() => act(() => leaveChallenge(c.id), t('You left the challenge'), toList)}>{t('Leave')}</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="h-12 rounded-2xl text-muted-foreground" onClick={() => setLeaving(true)}>{t('Leave challenge')}</Button>
          )}
        </div>
      )}
      {needsNutrition && <NutritionSetup open={setupOpen} onOpenChange={setSetupOpen} />}
    </>
  )
}

function Result({ c }: { c: Challenge }) {
  const good = c.me.won === true
  const text = c.status === 'cancelled' ? t('Cancelled: fewer than 2 people joined.')
    : good ? t('Challenge completed! +300 XP')
    : c.status === 'won' ? t('You did not reach the goal this time.')
    : t('The goal was not reached this time.')
  return (
    <div className={cn('mt-4 flex items-center gap-3 rounded-2xl p-4 animate-in fade-in-0 duration-200 motion-reduce:animate-none', good ? 'bg-primary/15' : 'bg-secondary/70')}>
      {good ? <Trophy aria-hidden className={cn('size-6 shrink-0', ACCENT_TEXT)} /> : <Swords aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
      <p role="status" className={cn('text-[15px] font-medium', !good && 'text-muted-foreground')}>{text}</p>
    </div>
  )
}
