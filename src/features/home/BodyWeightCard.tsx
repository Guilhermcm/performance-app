import type { ReactElement } from 'react'
import { ArrowDown, ArrowUp, ChevronRight, Plus, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '../../store/useStore.js'
import { lastBW } from '../../lib/history.js'
import { fmtNum, fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import { bwSheet, goalSheet, weighInsSheet, bwDeltaColor } from '../../sheets.jsx'
import LegacyLineChart from '../../components/LineChart.jsx'

type HomeStore = { S: Record<string, any> }
// The goal's yellow is ~1.6:1 on the light card; there it is pulled toward the text colour (as
// ACCENT_TEXT does for volt). The dark theme keeps the pure yellow.
const GOAL_TEXT = 'text-[color:color-mix(in_oklab,var(--yellow)_45%,var(--foreground))] dark:text-[var(--yellow)]'
type Point = { t: number; y: number; d: string }
const LineChart = LegacyLineChart as unknown as (p: { points: Point[]; h: number; unit: string; goal?: number }) => ReactElement

// Body weight at a glance: latest weigh-in, the change since the one before, the goal, the curve.
export function BodyWeightCard() {
  const S = useStore((s: HomeStore) => s.S)
  const bw = lastBW(S)
  const prev = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prev ? bw.w - prev.w : null
  const points: Point[] = S.bodyweight.slice(-30).map((b: any) => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const goal = S.targetW

  return (
    <section data-slot="card" aria-labelledby="bw-title" className="rounded-3xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bw-title" className="text-[17px] font-semibold">{t('Body weight')}</h2>
        <div className="flex gap-2">
          <Button variant="secondary" className={cn('h-11 gap-1.5 rounded-xl px-3', goal && GOAL_TEXT)} onClick={() => goalSheet()}>
            <Target aria-hidden className="size-4" />{goal ? fmtNum(goal) : t('Goal')}
          </Button>
          <Button variant="secondary" className="h-11 gap-1.5 rounded-xl px-3" onClick={() => bwSheet()}>
            <Plus aria-hidden className="size-4" />{t('Log')}
          </Button>
        </div>
      </div>
      {bw ? (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums">{fmtNum(bw.w)}</span>
            <span className="text-muted-foreground">{S.unit}</span>
            {/* only when it actually moved: an unchanged weight used to read as "− 0" */}
            {!!delta && (
              <span className="flex items-center gap-0.5 text-sm font-medium" style={{ color: bwDeltaColor(delta, bw.w) }}>
                {delta > 0 ? <ArrowUp aria-hidden className="size-3.5" /> : <ArrowDown aria-hidden className="size-3.5" />}{fmtNum(Math.abs(delta))}
              </span>
            )}
            <span className="ml-auto text-sm text-muted-foreground">{fmtDate(bw.d, true)}</span>
          </div>
          {goal && (
            <p className={cn('mt-1 flex items-center gap-1.5 text-sm', GOAL_TEXT)}>
              <Target aria-hidden className="size-3.5" />
              {t('Goal')} {fmtNum(goal)} {S.unit} · {Math.abs(goal - bw.w) < 0.05 ? t('reached!') : t(goal > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(goal - bw.w)) + ' ' + S.unit)}
            </p>
          )}
          <div className="chart mt-2"><LineChart points={points} h={130} unit={S.unit} goal={goal} /></div>
          <div className="flex justify-end">
            <Button variant="ghost" className="h-11 gap-1 rounded-xl" onClick={() => weighInsSheet()}>
              {t('All weigh-ins')}<ChevronRight aria-hidden className="size-4" />
            </Button>
          </div>
        </>
      ) : (
        <p className="mt-2 text-sm leading-snug text-muted-foreground">
          {S.weighIn === false
            ? t('No entries yet — log your weight to start the curve.')
            : t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}
        </p>
      )}
    </section>
  )
}
