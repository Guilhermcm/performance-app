import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import type { Profile } from '../profile/types'
import { shiftDay } from '../nutrition/days'
import { useLocalNow } from './use-local-now'
import { useSleep } from './useSleep'
import { DEFAULT_BED, DEFAULT_GOAL, DEFAULT_NIGHTS } from './goal'
import { fetchTargets } from './sleep-api'
import { fmtClock, fmtDuration, shiftClock } from './time'
import { BED_SLACK_MIN, GOAL_SLACK_MIN } from './classify'

// Spec 3.1: the goal from 6h to 10h and the bedtime both move 15 minutes at a time.
const STEP = 15
const MIN_GOAL = 360
const MAX_GOAL = 600
const NIGHTS = [3, 4, 5, 6, 7]

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

// Turning the sleep pillar on (spec 3.1) and editing its goal later: hours of sleep, bedtime and
// nights on target per week in one step. The first goal starts today, an edit tomorrow, and a new
// nights per week count the week after.
export default function SleepSetup({ open, onOpenChange }: Props) {
  const profile = useProfile(s => s.profile)
  // A fresh form each time the sheet opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  if (!profile) return null
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <SetupBody key={session} profile={profile} onDone={() => onOpenChange(false)} />
      </DrawerContent>
    </Drawer>
  )
}

function SetupBody({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const save = useProfile(s => s.save)
  // Fixed when the sheet opens: a retry after a failed first goal still writes it for today,
  // though the profile already says the pillar is on.
  const [activating] = useState(() => !profile.sleep_enabled)
  const today = useLocalNow(profile.timezone).today
  const tomorrow = shiftDay(today, 1)
  // Any goal row at all, in force or not: only the very first one may start today (server policy).
  const hasTarget = useSleep(s => s.targets.length > 0)
  // "No goal yet" only means that once the goals have loaded. The button never waits for them (a
  // failed pull left it stuck on "Loading your targets"): when the store is not ready, or only
  // holds a saved copy that may be out of date, finishing asks the server for the goals directly.
  const loaded = useSleep(s => s.status === 'ready')
  const stale = useSleep(s => s.stale)
  useEffect(() => {
    // A failed or idle first load is tried again when the sheet opens.
    const st = useSleep.getState().status
    if (st === 'error' || st === 'idle') void useSleep.getState().refresh()
  }, [])
  const ahead = useSleep(s => s.targetOn(tomorrow))

  // Until the person moves them, the goal and bedtime follow the goal in force from tomorrow, also
  // when it only loads after the sheet opened (otherwise saving a new count wrote the defaults).
  const [goalEdit, setGoal] = useState<number | null>(null)
  const [bedEdit, setBed] = useState<string | null>(null)
  const goal = goalEdit ?? ahead?.goal_min ?? DEFAULT_GOAL
  const bed = bedEdit ?? ahead?.bed_target ?? DEFAULT_BED
  const [nights, setNights] = useState(profile.sleep_nights_per_week ?? DEFAULT_NIGHTS)
  const [busy, setBusy] = useState(false)

  const targetChanged = !ahead || ahead.goal_min !== goal || ahead.bed_target !== bed
  const nightsChanged = nights !== profile.sleep_nights_per_week
  const canGo = !busy

  const finish = async () => {
    if (!canGo) return
    setBusy(true)
    // Whether any goal exists decides today or tomorrow; asked before anything is written.
    let anyTarget = hasTarget
    if (!loaded || stale) {
      try {
        anyTarget = (await fetchTargets()).length > 0
      } catch {
        toast(t('Could not save the target. Check your connection and try again.'))
        setBusy(false)
        return
      }
    }
    try {
      if (activating || nightsChanged) {
        await save({ ...(activating ? { sleep_enabled: true } : {}), sleep_nights_per_week: nights })
      }
    } catch {
      toast(t('Could not save. Your previous values were kept.'))
      setBusy(false)
      return
    }
    // The first goal ever (or one that never got saved) starts today; every later one tomorrow,
    // also when the pillar is turned back on. A goal that is already the one in force writes nothing.
    const from = anyTarget ? tomorrow : today
    const changed = from === today || targetChanged
    try {
      if (changed) await useSleep.getState().setTarget({ goal_min: goal, bed_target: bed }, from)
      toast(activating && from === today ? t('Sleep is on. Your goal starts today.') : changed && from === tomorrow ? t('New goal saved. It starts tomorrow.') : t('Saved'))
      onDone()
    } catch {
      toast(t('Could not save the target. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl">{activating ? t('Turn on Sleep') : t('Your sleep goal')}</DrawerTitle>
        <DrawerDescription>{t('Set how long you want to sleep and when you go to bed. Nights that hit both earn XP, like workouts do.')}</DrawerDescription>
      </DrawerHeader>

      <form id="sleep-setup" className="flex flex-col gap-6 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); void finish() }}>
        <Stepper id="sleep-goal" label={t('Sleep goal')} value={fmtDuration(goal)}
          lessLabel={t('Sleep 15 minutes less')} moreLabel={t('Sleep 15 minutes more')}
          lessDisabled={goal <= MIN_GOAL} moreDisabled={goal >= MAX_GOAL}
          onLess={() => setGoal(Math.max(MIN_GOAL, goal - STEP))} onMore={() => setGoal(Math.min(MAX_GOAL, goal + STEP))} />

        <Stepper id="sleep-bed" label={t('Bedtime')} value={fmtClock(bed)}
          lessLabel={t('Bedtime 15 minutes earlier')} moreLabel={t('Bedtime 15 minutes later')}
          onLess={() => setBed(shiftClock(bed, -STEP))} onMore={() => setBed(shiftClock(bed, STEP))} />

        <p className="-mt-2 text-sm leading-snug text-muted-foreground">
          {t('On target: at least {0} of sleep and in bed within {1} minutes of {2}.', fmtDuration(goal - GOAL_SLACK_MIN), BED_SLACK_MIN, fmtClock(bed))}
        </p>

        {hasTarget && targetChanged && (
          <p role="status" className="rounded-2xl bg-secondary/70 p-3 text-sm leading-snug">{t('Starts tomorrow')}</p>
        )}

        <div className="flex flex-col gap-2">
          <span id="sleep-nights-label" className="text-sm font-medium text-muted-foreground">{t('Nights on target per week')}</span>
          <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="sleep-nights-label"
            value={String(nights)} onValueChange={v => v && setNights(Number(v))}>
            {NIGHTS.map(n => (
              <ToggleGroupItem key={n} value={String(n)}
                className={cn('h-12 min-w-11 flex-1 px-0 font-mono text-base tabular-nums transition-colors duration-150', ON)}>{n}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-sm leading-snug text-muted-foreground">{t('Reach it on this many nights to meet the weekly goal.')}</p>
          {!activating && nightsChanged && (
            <p role="status" className="rounded-2xl bg-secondary/70 p-3 text-sm leading-snug">{t('The new weekly count starts next week.')}</p>
          )}
        </div>
      </form>

      <DrawerFooter className="flex-row gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <Button type="submit" form="sleep-setup" className="h-12 flex-1 rounded-xl text-[15px] font-semibold" disabled={!canGo}>
          {busy ? t('Saving…') : activating ? t('Turn on Sleep') : t('Save')}
        </Button>
      </DrawerFooter>
    </>
  )
}

type StepperProps = {
  id: string
  label: string
  value: string
  lessLabel: string
  moreLabel: string
  lessDisabled?: boolean
  moreDisabled?: boolean
  onLess: () => void
  onMore: () => void
}

// A value with a minus and a plus beside it. The buttons are 48 px; the value is a live region so
// a screen reader hears the new number after each tap.
function Stepper({ id, label, value, lessLabel, moreLabel, lessDisabled, moreDisabled, onLess, onMore }: StepperProps) {
  return (
    <div className="flex flex-col gap-2">
      <span id={id + '-label'} className="text-sm font-medium text-muted-foreground">{label}</span>
      <div role="group" aria-labelledby={id + '-label'} className="flex items-center justify-between gap-3 rounded-2xl bg-card p-2">
        <Button type="button" variant="outline" size="icon" className="size-12 rounded-xl" aria-label={lessLabel} disabled={lessDisabled} onClick={onLess}>
          <Minus aria-hidden className="size-5" />
        </Button>
        <span aria-live="polite" className="font-mono text-3xl font-semibold tabular-nums">{value}</span>
        <Button type="button" variant="outline" size="icon" className="size-12 rounded-xl" aria-label={moreLabel} disabled={moreDisabled} onClick={onMore}>
          <Plus aria-hidden className="size-5" />
        </Button>
      </div>
    </div>
  )
}
