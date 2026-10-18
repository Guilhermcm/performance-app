// The running plan's row on /plan (spec §6.4): "Build a running plan" opens the questionnaire when
// there is none; with a plan, the row says where it stands (this week, when it starts, finished or
// unreadable) and opens /plan/corrida. After a plan is applied, DaysGoalOffer offers to update the
// weekly days goal (spec §6.3).
import { useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../../lib/i18n.js'
import { todayISO, weekStartOf } from '../../lib/format.js'
import { tappable } from '../../lib/use-sheet-keyboard.js'
import LegacyIcon from '../../components/Icon.jsx'
import { useStore } from '../../store/useStore.js'
import DaysGoalOffer from './DaysGoalOffer'
import { dayText, goalName } from './labels'
import { currentWeek, isReadable, raceWeeksStart, type RunState } from './run-actions'
import RunQuestionnaire from './RunQuestionnaire'
import type { RunPlan } from './types'

type AppStore = { S: RunState }
const Icon = LegacyIcon as unknown as (p: { name: string; className?: string }) => ReactElement

/** Where the plan stands, in a few words. */
export function planStatus(plan: RunPlan, today: string, ws: 0 | 1): string {
  if (!isReadable(plan)) return t('This plan can’t be read in this version of the app.')
  if (today < plan.startDate) return t('Starts on {0}', dayText(plan.startDate, today))
  const week = currentWeek(plan, today, ws)
  if (!week) return t('Plan finished')
  // The maintain weeks before a race plan that starts later.
  const race = raceWeeksStart(plan, ws)
  if (week.phase === 'maintain' && race && today < race) return `${goalName('maintain')} · ${t('Race plan starts on {0}', dayText(race, today))}`
  return `${goalName(plan.goal)} · ${t('Week {0} of {1}', week.index, plan.weeks.length)}`
}

export default function RunPlanEntry() {
  const nav = useNavigate()
  const plan = useStore((s: AppStore) => s.S.runPlan)
  const ws = useStore((s: AppStore) => weekStartOf(s.S))
  const [open, setOpen] = useState(false)
  const [offer, setOffer] = useState(false)

  return <>
    <div className="list" style={{ marginBottom: 14 }}>
      {plan
        ? <div className="item" data-testid="run-plan-entry" {...tappable(() => nav('/plan/corrida'))}>
          <span className="lrow-i"><Icon name="figureRun" /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tt">{t('Running plan')}</div>
            <div className="ss">{planStatus(plan, todayISO(), ws)}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>
        : <div className="item" data-testid="run-plan-entry" {...tappable(() => setOpen(true))}>
          <span className="lrow-i"><Icon name="figureRun" /></span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tt">{t('Build a running plan')}</div>
            <div className="ss">{t('The app fits your runs around your strength training.')}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>}
    </div>
    {offer && <DaysGoalOffer onClose={() => setOffer(false)} />}
    <RunQuestionnaire open={open} onOpenChange={setOpen} onCreated={() => setOffer(true)} />
  </>
}
