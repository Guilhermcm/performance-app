// After a running plan is applied (spec §6.3): the number of different training days of the week,
// strength and running together, and, when it differs from the profile's weekly goal, an offer to
// update the goal. Nothing is saved until the person taps it.
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { todayISO, weekStartOf } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { addDays } from './dates'
import { currentWeek, isReadable, strengthWeek, type RunState } from './run-actions'

type AppStore = { S: RunState }

/**
 * Different days with training in the week the goal change would apply to (next week; the target
 * freezes for the current one): strength days and the plan's run days of that week. A plan that
 * starts after next week counts its first week; next week past the plan's end has no runs.
 */
export function trainingDays(S: RunState, today: string): number {
  const plan = S.runPlan
  const days = new Set(Object.keys(strengthWeek(S)).map(Number))
  if (isReadable(plan)) {
    const next = addDays(today, 7)
    const week = currentWeek(plan, next, weekStartOf(S)) ?? (next < plan.startDate ? plan.weeks[0] : null)
    for (const s of week?.sessions ?? []) days.add(s.day)
  }
  return days.size
}

/** "Training days in your week: N. Your weekly goal: M." with "Update goal to N" and "Not now". */
export default function DaysGoalOffer({ onClose }: { onClose: () => void }) {
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
