// The progress of one exercise (spec §6), opened from the routine list in the Plan: the heaviest
// load and the estimated 1RM of each session, the record, and the last sessions set by set. Only
// for an exercise with a load logged (a check-in detail or a live workout); without one there is
// nothing to show, and the list offers no way in (hasProgress).
import { useId, useMemo } from 'react'
import { t, exerciseNameFor, exerciseNameClass } from '../../lib/i18n.js'
import { fmtDate, fmtNum } from '../../lib/format.js'
import { exOr } from '../../lib/exercises.js'
import { setLabel } from '../../lib/history.js'
import { speedUnitOf } from '../../lib/speed.js'
import { exerciseHistory } from '../../lib/exercise-history.js'
import { best1RM, e1rmSeries } from '../../lib/onerm.js'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import LineChart from '../../components/LineChart.jsx'

type State = { unit?: string; speedUnit?: string; workouts?: unknown[] }
type Point = { t: number; d: string; y: number }
type Session = { id: string; d: string; target: unknown; sets: unknown[]; value: number | null }
type History = { metric: string; best: number; total: number; points: Point[]; sessions: Session[] }

const historyOf = (S: State, exId: string) => exerciseHistory(S, exId) as History

// Whether the exercise has a load logged: its history is charted in weight and has a point.
export function hasProgress(S: State, exId: string): boolean {
  const h = historyOf(S, exId)
  return h.metric === 'weight' && h.points.length > 0
}

function Chart({ title, points, best, unit, color }: { title: string; points: Point[]; best: number; unit: string; color: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="chart"><LineChart points={points} h={130} unit={unit} color={color} /></div>
      <p className="text-sm text-muted-foreground">{t('Best: {0}', `${fmtNum(best)} ${unit}`)}</p>
    </section>
  )
}

export function ExerciseProgress({ exId }: { exId: string }) {
  const workouts = useStore((s: { S: State }) => s.S.workouts)
  const unit = useStore((s: { S: State }) => s.S.unit) === 'lb' ? 'lb' : 'kg'
  const speedUnit = useStore((s: { S: State }) => speedUnitOf(s.S))
  const listId = useId()
  // Derived once per log change: LineChart drops its hover whenever `points` changes identity.
  const { h, e1rm, e1Best } = useMemo(() => {
    const S = { workouts }
    const e1rm = (e1rmSeries(S, exId) as Point[]).slice().sort((a, b) => a.t - b.t)
    return { h: historyOf(S, exId), e1rm, e1Best: (best1RM(S, exId) as { est: number } | null)?.est ?? 0 }
  }, [workouts, exId])
  if (h.metric !== 'weight' || !h.points.length) return null

  const ex = exOr(exId)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className={`text-lg font-semibold ${exerciseNameClass(ex)}`}>{exerciseNameFor(ex)}</h3>
        <p className="text-sm text-muted-foreground">{t('Progress')}</p>
      </div>
      <Chart title={t('Heaviest load')} points={h.points} best={h.best} unit={unit} color="var(--blue)" />
      {e1rm.length > 0 && <Chart title={t('Estimated 1RM')} points={e1rm} best={e1Best} unit={unit} color="var(--acc)" />}
      <section className="flex flex-col gap-2">
        <h4 id={listId} className="text-sm font-semibold">
          {h.sessions.length < h.total ? t('Last {0} sessions', h.sessions.length) : t('Sessions')}
        </h4>
        <ul aria-labelledby={listId} className="flex list-none flex-col gap-2 p-0">
          {h.sessions.map(s => (
            <li key={s.id} className="flex items-start gap-3 rounded-xl bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{fmtDate(s.d, true)}</p>
                <p className="text-sm text-muted-foreground">{s.sets.map(x => setLabel(exId, x, s.target, speedUnit)).join('  ·  ')}</p>
              </div>
              {s.value != null && s.value > 0 && <span className="shrink-0 text-sm font-semibold tabular-nums">{fmtNum(s.value)} {unit}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// Opens the progress as a sheet, from the legacy routine list.
export function openExerciseProgress(exId: string) {
  return useUI.getState().openSheet(() => <ExerciseProgress exId={exId} />)
}
