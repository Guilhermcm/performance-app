import { useEffect, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { CloudOff, Sparkles } from 'lucide-react'
import { t } from '../../lib/i18n.js'
import { useProgress } from './useProgress'
import { linesFromProgress } from './preview'
import { levelFor } from './xp'
import { useCountUp } from './useCountUp'
import { LevelBar } from './components/LevelBar'
import { ACHIEVEMENT_TEXT } from './achievement-labels'
import { fmtInt } from './format'
import { ACCENT_TEXT } from './components/accent'
import { cn } from '@/lib/utils'
import type { AchievementCode } from './achievements'
import type { Progress, SyncResult, XpLine, XpPreview } from './types'

type Props = { before: Progress | null; preview: XpPreview | null; settled: Promise<SyncResult> }

function lineLabel(l: XpLine): string {
  switch (l.kind) {
    case 'workout': return t('Workout {0} of {1}', l.index, l.of)
    case 'extra': return t('Extra workout')
    case 'goal': return t('Weekly goal bonus')
    case 'pr': return t('Personal records ×{0}', l.count)
    case 'weight': return t('Weigh-in')
    case 'achievement': return t('Achievement: {0}', ACHIEVEMENT_TEXT[l.code as AchievementCode]?.title() ?? l.code)
    default: return t('Other gains')
  }
}

// The XP block at the top of the post-workout summary. The preview shows at once; when the queue
// is through and the server answers, its figures replace the preview and the number counts on to
// them. Level-ups and badges (CelebrationHost) wait until the count is done.
export default function WorkoutXpSummary({ before, preview, settled }: Props) {
  const instant = useReducedMotion() ?? false
  const [result, setResult] = useState<SyncResult | null>(null)
  // The figure the count last landed on: the celebrations wait for the final one, not the preview's.
  const [counted, setCounted] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    useProgress.getState().hold(true)
    settled.then(
      r => { if (live) setResult(r) },
      () => { if (live) setResult({ progress: null, confirmed: false }) }
    )
    return () => { live = false; useProgress.getState().hold(false) }
  }, [settled])

  const after = result?.confirmed ? result.progress : null
  const lines = after && before ? linesFromProgress(before, after) : preview?.lines ?? null
  const total = after && before ? after.total_xp - before.total_xp : preview?.total ?? null
  const value = useCountUp(total ?? 0, { instant, onDone: () => { if (total !== null) setCounted(total) } })

  const to = after?.level ?? (before && preview ? levelFor(before.total_xp + preview.total) : null)

  // The bar fills after the number (LevelBar: 600 ms, twice across a level-up), plus a short beat
  // so the full bar is seen before a card covers it. Reduced motion has nothing to wait for.
  const barMs = instant || !to || !before ? 0 : (to.level > before.level.level ? 1200 : 600) + 250
  const [barDone, setBarDone] = useState(barMs === 0)
  useEffect(() => {
    if (!barMs) { setBarDone(true); return }
    setBarDone(false)
    const id = window.setTimeout(() => setBarDone(true), barMs)
    return () => clearTimeout(id)
  }, [barMs, to?.level, to?.into])

  // Nothing to count (a past week) lets them through as soon as the answer is in.
  useEffect(() => {
    if (result && (total === null || (counted === total && barDone))) useProgress.getState().hold(false)
  }, [counted, result, total, barDone])
  const estimate = !after && preview !== null && result !== null

  return (
    <section data-slot="xp-summary" aria-label={t('XP earned')}
      className="mx-auto my-3 w-full max-w-sm rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 text-left font-sans text-foreground">
      {total === null ? (
        result === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles aria-hidden className="size-4 animate-pulse motion-reduce:animate-none" />{t('Counting your XP…')}
          </p>
        ) : !to ? (
          <p className="text-sm leading-snug text-muted-foreground">{t('This workout counts toward a past week. Its XP shows up once it syncs.')}</p>
        ) : null
      ) : total === 0 ? (
        <p className="text-sm leading-snug text-muted-foreground">{t('No XP this time. You already got the two extra workouts this week.')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-muted-foreground">{t('XP earned')}</span>
            <span aria-hidden className={cn('whitespace-nowrap font-mono text-2xl font-bold tabular-nums min-[360px]:text-3xl', ACCENT_TEXT)}>{t('+{0} XP', fmtInt(value))}</span>
            <span className="sr-only" aria-live="polite">{t('+{0} XP', fmtInt(total))}</span>
          </div>
          {lines && lines.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1.5 text-sm">
              {lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3">
                  <span>{lineLabel(l)}</span>
                  <span className="shrink-0 whitespace-nowrap font-mono tabular-nums text-muted-foreground">{t('+{0} XP', fmtInt(l.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {to && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{t('Level {0}', to.level)}</span>
            <span className="font-mono tabular-nums">{fmtInt(to.into)} / {fmtInt(to.need)}</span>
          </div>
          <LevelBar from={before?.level ?? null} to={to} instant={instant} label={t('Level {0}', to.level)} />
        </div>
      )}
      {estimate && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5" />{t('Estimate. It is confirmed when you are back online.')}
        </p>
      )}
    </section>
  )
}
