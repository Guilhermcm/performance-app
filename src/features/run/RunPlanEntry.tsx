// The running plan's row on /plan (spec §6.4): "Build a running plan" opens the questionnaire when
// there is none; with a plan, the row says where it stands (this week, when it starts, finished or
// unreadable) and opens /plan/corrida. After a plan is applied, DaysGoalOffer offers to update the
// weekly days goal when the week now has another number of training days (spec §6.3).
import { useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { fmtDate, todayISO, weekStartOf } from '../../lib/format.js'
import { tappable } from '../../lib/use-sheet-keyboard.js'
import LegacyIcon from '../../components/Icon.jsx'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { goalName } from './labels'
import { currentWeek, isReadable, strengthWeek, type RunState } from './run-actions'
import RunQuestionnaire from './RunQuestionnaire'
import type { RunPlan } from './types'

type AppStore = { S: RunState }
const Icon = LegacyIcon as unknown as (p: { name: string; className?: string }) => ReactElement

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** A date shown to the person, with the year only when it is not this year's. */
export const dayText = (iso: string, today: string) => fmtDate(iso, false, iso.slice(0, 4) !== today.slice(0, 4))

/**
 * Different days with training in the week the goal change would apply to (next week, the target
 * freezes for the current one): strength days and the plan's run days of that week. A plan that
 * starts later counts its first week.
 */
export function trainingDays(S: RunState, today: string): number {
  const plan = S.runPlan
  const days = new Set(Object.keys(strengthWeek(S)).map(Number))
  if (isReadable(plan)) {
    const week = currentWeek(plan, addDays(today, 7), weekStartOf(S)) ?? plan.weeks[0]
    for (const s of week.sessions) days.add(s.day)
  }
  return days.size
}

/** Where the plan stands, in a few words. */
export function planStatus(plan: RunPlan, today: string, ws: 0 | 1): string {
  if (!isReadable(plan)) return t('This plan can’t be read in this version of the app.')
  if (today < plan.startDate) return t('Starts on {0}', dayText(plan.startDate, today))
  const week = currentWeek(plan, today, ws)
  if (!week) return t('Plan finished')
  return `${goalName(plan.goal)} · ${t('Week {0} of {1}', week.index, plan.weeks.length)}`
}

/** After a new plan: "the week now has N training days; your goal is M", and update only on a tap. */
export function DaysGoalOffer({ onClose }: { onClose: () => void }) {
  const S = useStore((s: AppStore) => s.S)
  const goal = useProfile(s => s.profile?.days_per_week)
  const [busy, setBusy] = useState(false)
  const n = trainingDays(S, todayISO())
  if (goal == null || n === goal || n < 1) return null

  const accept = async () => {
    setBusy(true)
    try {
      await useProfile.getState().save({ days_per_week: n })
      onClose()
    } catch {
      toast(t('Could not save. Your previous values were kept.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="status" className="mb-3.5 flex flex-col gap-2 rounded-2xl border border-border bg-card px-4 py-3 font-sans">
      <p className="text-[15px]">{t('Training days in your week, strength and running together: {0}. Your weekly goal: {1}.', n, goal)}</p>
      <p className="text-sm text-muted-foreground">{t('The change applies from next week.')}</p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 rounded-lg" disabled={busy} onClick={accept}>{t('Update goal to {0}', n)}</Button>
        <Button variant="ghost" className="h-11 rounded-lg" onClick={onClose}>{t('Not now')}</Button>
      </div>
    </div>
  )
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
