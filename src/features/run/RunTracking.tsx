// The tracking part of /plan/corrida (spec §8.1): this week's workouts done against planned with
// its minutes and km, the minutes per week against the plan (RunProgress, loaded on demand) and the
// milestones: the longest Longão, the longest distance and the easy pace over the last 4 weeks.
// Without runs the numbers stay at zero and the chart and the milestones say so in text (review
// focus 5). `logs` and `status` come from useRunLogs: when the read failed (`offline`) a short
// notice says the runs shown are only the phone's, and while it loads or after a failure nothing
// claims there are no runs (final review I2).
import { lazy, Suspense } from 'react'
import { t, tn } from '../../lib/i18n.js'
import { todayISO, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { milestones, volumeSeries, weekOffsetOf, weekSummary } from './progress'
import { currentWeek, type RunState } from './run-actions'
import { formatKm } from './run-detail'
import type { RunLog, RunLogStatus } from './run-log'
import { RunProgressSkeleton } from './RunProgressSkeleton'
import type { RunPlan } from './types'
import { formatPace } from './vdot'

const RunProgress = lazy(() => import('./RunProgress'))

type AppStore = { S: RunState }

/** "2 of 3 workouts". */
export const workoutsText = (done: number, planned: number) =>
  planned === 1 ? t('{0} of 1 workout', done) : tn(planned, '{0} of {1} workouts', done, planned)

export default function RunTracking({ plan, logs, status }: { plan: RunPlan; logs: RunLog[]; status: RunLogStatus }) {
  const ws = useStore((s: AppStore) => weekStartOf(s.S)) as 0 | 1
  // Every run of the plan is in `logs`: read from the server, or none to read without an account.
  const known = status === 'ready' || status === 'idle'
  const today = todayISO()
  const week = currentWeek(plan, today, ws)
  const offset = weekOffsetOf(plan, today, ws)
  const summary = weekSummary(plan, offset, logs, ws)
  const series = volumeSeries(plan, logs, ws, today)
  // The chart's last week is this one, still going on (not once the plan is over).
  const inProgress = series.length > 0 && series.length - 1 === offset
  const marks = milestones(plan, logs, ws, today)
  const items = [
    marks.longestLong != null && { label: t('Longest long run'), value: t('{0} min', marks.longestLong) },
    marks.maxKm != null && { label: t('Longest distance'), value: t('{0} km', formatKm(marks.maxKm)) },
    marks.easyPace != null && { label: t('Average pace on easy runs'), hint: t('Last 4 weeks'), value: t('{0} /km', formatPace(marks.easyPace)) },
  ].filter((m): m is { label: string; hint?: string; value: string } => !!m)

  return (
    <section aria-labelledby="run-plan-tracking" className="flex flex-col gap-3">
      <h2 id="run-plan-tracking" className="text-lg font-semibold tracking-tight">{t('Tracking')}</h2>
      {status === 'offline' && (
        <p data-slot="run-history-offline" role="status" className="text-sm text-muted-foreground">
          {t('Couldn’t load your run history. Only the runs saved on this phone are shown.')}
        </p>
      )}

      {week && (
        <div data-slot="run-week" className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">{t('This week')}</span>
          <span className="text-[17px] font-semibold tabular-nums">{workoutsText(summary.done, summary.planned)}</span>
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {t('{0} min', summary.minutes)} · {t('{0} km', formatKm(summary.km))}
          </span>
        </div>
      )}

      <Suspense fallback={<RunProgressSkeleton />}>
        <RunProgress series={series} inProgress={inProgress} known={known} />
      </Suspense>

      <div className="flex flex-col gap-2">
        <h3 className="text-[15px] font-semibold">{t('Milestones')}</h3>
        {items.length
          ? <dl className="grid gap-2">
            {items.map(m => (
              <div key={m.label} className="flex items-baseline justify-between gap-3 rounded-xl bg-muted px-3 py-2">
                <dt className="flex flex-col text-sm">
                  <span className="font-medium text-foreground">{m.label}</span>
                  {m.hint && <span className="text-xs text-muted-foreground">{m.hint}</span>}
                </dt>
                <dd className="font-mono text-[15px] text-foreground tabular-nums">{m.value}</dd>
              </div>
            ))}
          </dl>
          : known && <p className="text-sm text-muted-foreground">{t('No milestones yet. Log your runs with distance and time to see them here.')}</p>}
      </div>
    </section>
  )
}
