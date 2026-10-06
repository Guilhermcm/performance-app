import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, CloudOff, RefreshCw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useOnline } from '@/lib/use-online'
import { t } from '../../lib/i18n.js'
import { useProgress } from '../gamification/useProgress'
import { displayStreak } from '../gamification/preview'
import { ACHIEVEMENTS } from '../gamification/achievements'
import { LevelBar } from '../gamification/components/LevelBar'
import { StreakBadge } from '../gamification/components/StreakBadge'
import { fmtInt } from '../gamification/format'
import { ACCENT_TEXT } from '../gamification/components/accent'
import { WEEK_MAX } from '../gamification/xp'
import type { WeekProgress } from '../gamification/types'

const CARD = 'relative overflow-hidden rounded-3xl border border-border bg-card p-5 text-card-foreground'

// Where you stand: level and what is left to the next, the weekly streak with its shields, this
// week's XP against the most any week can pay, and the sessions toward the goal. Designed states:
// loading (skeleton in the card's shape), first load failed (retry), no XP yet (first step),
// offline with a saved copy (a quiet line, nothing blocks).
export function ProgressHero() {
  const navigate = useNavigate()
  const progress = useProgress(s => s.progress)
  const status = useProgress(s => s.status)
  const stale = useProgress(s => s.stale)
  const online = useOnline()
  const [shieldsOpen, setShieldsOpen] = useState(false)

  if (!progress) {
    if (status === 'error') {
      return (
        <section data-slot="progress-hero" className={CARD}>
          <p className="text-[15px] font-medium">{t('Could not load your progress.')}</p>
          <Button variant="outline" className="mt-3 h-11 gap-2 rounded-xl" onClick={() => void useProgress.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </section>
      )
    }
    return (
      <section data-slot="progress-hero" aria-busy="true" className={CARD}>
        <div className="flex items-center gap-3">
          <Skeleton className="size-14 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-36" /></div>
          <Skeleton className="h-11 w-24 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-2.5 w-full rounded-full" />
        <Skeleton className="mt-6 h-4 w-full" />
        <Skeleton className="mt-4 h-12 w-full rounded-2xl" />
      </section>
    )
  }

  const lv = progress.level
  const week = progress.week
  const segments = weekSegments(week)

  return (
    <section data-slot="progress-hero" aria-labelledby="hero-level"
      className={cn(CARD, 'animate-in fade-in-0 duration-200 motion-reduce:animate-none')}>
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-60 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary font-mono text-2xl font-bold tabular-nums text-primary-foreground">
            {lv.level}
          </span>
          <div className="min-w-0">
            <h2 id="hero-level" className="text-lg font-semibold leading-tight">{t('Level {0}', lv.level)}</h2>
            <p className="text-sm tabular-nums text-muted-foreground">{t('{0} XP to level {1}', fmtInt(lv.need - lv.into), lv.level + 1)}</p>
          </div>
        </div>
        <StreakBadge current={displayStreak(progress)} shields={progress.streak.shields}
          expanded={shieldsOpen} onToggle={() => setShieldsOpen(o => !o)} controls="streak-help" />
      </div>

      {shieldsOpen && (
        <div id="streak-help" className="relative mt-3 rounded-2xl bg-secondary/70 p-3 text-sm leading-snug animate-in fade-in-0 duration-200 motion-reduce:animate-none">
          <p className="font-medium">{t('Streak shields')}</p>
          <p className="mt-1 text-muted-foreground">{t('A shield keeps your streak going when you miss a week. You get one every 4 weeks in a row, and can hold 2.')}</p>
          <p className="mt-2 tabular-nums text-muted-foreground">{t('Best: {0}', progress.streak.best)}</p>
        </div>
      )}

      <LevelBar className="relative mt-4" to={lv} instant label={t('Level {0}', lv.level)} />
      {progress.total_xp === 0 && <p className="relative mt-3 text-sm text-muted-foreground">{t('Finish a workout to earn your first XP.')}</p>}

      <div className="relative mt-5 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">{t('This week')}</span>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{t('{0} of {1} XP', fmtInt(week.xp), fmtInt(week.max))}</span>
        </div>
        <div aria-hidden className="flex h-1.5 gap-px overflow-hidden rounded-full bg-primary/15">
          {segments.filter(sg => sg.pct > 0).map(sg => (
            <div key={sg.key} data-slot="week-segment" data-pillar={sg.key} style={{ width: `${sg.pct}%` }}
              className={cn('h-full shrink-0 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none', SEGMENT[sg.key].fill)} />
          ))}
        </div>
        {segments.length > 1 && (
          <ul aria-label={t('XP this week by pillar')} className="flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted-foreground">
            {segments.map(sg => (
              <li key={sg.key} className="flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-full', SEGMENT[sg.key].fill)} />
                <span>{SEGMENT[sg.key].label()}</span>
                <span className="font-mono tabular-nums text-foreground">{fmtInt(sg.xp)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3">
          <SessionDots target={week.target} done={week.workouts} extras={week.extras} />
          <span className={cn('text-sm', week.target_hit ? cn('font-medium', ACCENT_TEXT) : 'text-muted-foreground')}>
            {week.target_hit ? t('Weekly goal met') : t('{0} of {1} workouts', week.workouts, week.target)}
          </span>
        </div>
      </div>

      <button type="button" onClick={() => navigate('/conquistas')}
        className="relative mt-4 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl bg-secondary/60 px-3.5 text-left outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex items-center gap-2 text-[15px] font-medium"><Trophy aria-hidden className={cn('size-4', ACCENT_TEXT)} />{t('Achievements')}</span>
        <span className="flex items-center gap-1 text-right text-sm leading-tight text-muted-foreground">
          {t('{0} of {1} unlocked', progress.achievements.length, ACHIEVEMENTS.length)}<ChevronRight aria-hidden className="size-4" />
        </span>
      </button>

      {stale && !online && (
        <p className="relative mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5" />{t('Offline. Showing your last saved progress.')}
        </p>
      )}
    </section>
  )
}

type SegmentKey = 'strength' | 'nutrition' | 'bonus'
const SEGMENT: Record<SegmentKey, { label: () => string; fill: string }> = {
  strength: { label: () => t('Strength'), fill: 'bg-[var(--pillar-strength)]' },
  nutrition: { label: () => t('Nutrition'), fill: 'bg-pillar-nutrition' },
  // Badges and challenges belong to no pillar: a neutral tone.
  bonus: { label: () => t('Bonus'), fill: 'bg-muted-foreground/60' }
}

// The week's XP split by pillar, each a share of the week's maximum, laid end to end and cut at
// 100%. Nutrition shows while it is part of the week (a second pillar raises the maximum), bonus
// once there is some. A cached week from an older build has no split: it is all strength.
export function weekSegments(week: WeekProgress): { key: SegmentKey; xp: number; pct: number }[] {
  const p = week.pillars ?? { strength: week.xp, nutrition: 0, bonus: 0 }
  const shown: [SegmentKey, number][] = [['strength', p.strength]]
  if (week.max > WEEK_MAX || p.nutrition > 0) shown.push(['nutrition', p.nutrition])
  if (p.bonus > 0) shown.push(['bonus', p.bonus])
  let room = 100
  return shown.map(([key, xp]) => {
    const pct = Math.min(room, Math.max(0, (xp / week.max) * 100))
    room -= pct
    return { key, xp, pct }
  })
}

// One pill per planned session of the week (filled once done), then a dot per extra session.
function SessionDots({ target, done, extras }: { target: number; done: number; extras: number }) {
  return (
    <span aria-hidden className="flex items-center gap-1">
      {Array.from({ length: target }, (_, i) => <span key={i} className={cn('h-2 w-5 rounded-full', i < done ? 'bg-primary' : 'bg-primary/15')} />)}
      {Array.from({ length: extras }, (_, i) => <span key={'x' + i} className="size-2 rounded-full bg-[var(--pillar-strength)]" />)}
    </span>
  )
}
