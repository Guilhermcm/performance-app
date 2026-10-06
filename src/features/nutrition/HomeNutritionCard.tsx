import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Apple, Plus, RefreshCw, Target, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { classifyDay, dayTotals } from './classify'
import { shiftDay, todayIn } from './days'
import { fmtNumber } from './labels'
import { useNutrition } from './useNutrition'
import NutritionSetup from './NutritionSetup'
import type { FoodLog } from './types'

const DISMISSED = 'perf_nutrition_invite_dismissed_v1'
const NO_LOGS: FoodLog[] = []

// "confirms on Thursday": a whole sentence per weekday, since languages place the day differently
// ("confirma na quinta", "confirma no sábado").
const CONFIRMS_ON = [
  () => t('On target so far, confirms on Sunday'),
  () => t('On target so far, confirms on Monday'),
  () => t('On target so far, confirms on Tuesday'),
  () => t('On target so far, confirms on Wednesday'),
  () => t('On target so far, confirms on Thursday'),
  () => t('On target so far, confirms on Friday'),
  () => t('On target so far, confirms on Saturday')
]
const confirmsOn = (iso: string) => CONFIRMS_ON[new Date(iso + 'T12:00:00').getDay()]()

// The accounts that dismissed the invite on this device, so another account still sees it.
const dismissedBy = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED) || '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

// Home's "Nutrition today": a compact kcal ring, what is left and a way to log, with a preview when
// the day is on target so far. With the pillar off, an invite that goes away for good once dismissed.
// The setup lives here, outside both: turning the pillar on flips the profile before the target is
// written, and the sheet must stay open (with its retry) if that write fails.
export default function HomeNutritionCard() {
  const profile = useProfile(s => s.profile)
  const [setup, setSetup] = useState(false)
  if (!profile) return null
  return (
    <>
      {profile.nutrition_enabled
        ? <TodayCard timezone={profile.timezone} onSetTarget={() => setSetup(true)} />
        : <Invite userId={profile.id} onActivate={() => setSetup(true)} />}
      <NutritionSetup open={setup} onOpenChange={setSetup} />
    </>
  )
}

function TodayCard({ timezone, onSetTarget }: { timezone: string; onSetTarget: () => void }) {
  const nav = useNavigate()
  const today = todayIn(timezone)
  const status = useNutrition(s => s.status)
  const logs = useNutrition(s => s.logs[today] ?? NO_LOGS)
  const target = useNutrition(s => s.targetOn(today))
  // Today closes two days later (spec: confirms_on = today + 2), counted in the profile time zone.
  const confirms = shiftDay(today, 2)

  if (status === 'idle' || status === 'loading') {
    return (
      <section role="status" aria-busy="true" aria-label={t('Nutrition today')} className="flex items-center gap-4 rounded-3xl border border-border bg-card p-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-28" /><Skeleton className="h-4 w-20" /></div>
        <Skeleton className="h-11 w-24 rounded-xl" />
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section aria-label={t('Nutrition today')} className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-card p-4">
        <p className="text-[15px] font-medium leading-snug">{t('Could not load your food diary.')}</p>
        <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void useNutrition.getState().refresh()}>
          <RefreshCw aria-hidden className="size-4" />{t('Try again')}
        </Button>
      </section>
    )
  }

  const totals = dayTotals(logs)
  const eaten = Math.round(totals.kcal)
  const goal = target ? Math.round(target.kcal) : null
  const left = goal == null ? null : goal - eaten
  const share = goal ? Math.min(1, eaten / goal) : 0
  const onTarget = target ? classifyDay(totals, target).on_target : false

  return (
    <section aria-labelledby="home-nutrition-title" className="rounded-3xl border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-center gap-4">
        <Ring share={share} over={left != null && left < 0} />
        <div className="min-w-0 flex-1">
          <h2 id="home-nutrition-title" className="text-[15px] font-semibold">{t('Nutrition today')}</h2>
          <p className="font-mono text-sm tabular-nums text-muted-foreground">
            {left == null ? t('No target for this day yet.') : left >= 0 ? t('{0} kcal left', fmtNumber(left)) : t('{0} kcal over', fmtNumber(-left))}
          </p>
          {left == null && (
            <Button variant="link" className="h-11 px-0 text-sm" onClick={onSetTarget}>{t('Set target')}</Button>
          )}
        </div>
        <Button className="h-11 gap-1.5 rounded-xl px-4" onClick={() => nav('/nutricao')}>
          <Plus aria-hidden className="size-4" />{t('Log')}
        </Button>
      </div>
      {onTarget && (
        <p className="mt-3 flex items-center gap-2 rounded-2xl bg-pillar-nutrition/10 px-3 py-2 text-sm text-foreground">
          <Target aria-hidden className="size-4 shrink-0 text-pillar-nutrition" />{confirmsOn(confirms)}
        </p>
      )}
    </section>
  )
}

const R = 26
const C = 2 * Math.PI * R

function Ring({ share, over }: { share: number; over: boolean }) {
  return (
    <div data-testid="home-kcal-ring" className="relative size-16 shrink-0">
      <svg viewBox="0 0 64 64" aria-hidden className="size-full -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" className="stroke-secondary" />
        <circle cx="32" cy="32" r={R} fill="none" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - share)}
          className={cn('transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none', over ? 'stroke-foreground' : 'stroke-pillar-nutrition')} />
      </svg>
      <Apple aria-hidden className="absolute inset-0 m-auto size-5 text-pillar-nutrition" strokeWidth={1.75} />
    </div>
  )
}

function Invite({ userId, onActivate }: { userId: string; onActivate: () => void }) {
  const [hidden, setHidden] = useState(() => dismissedBy().includes(userId))
  if (hidden) return null
  const dismiss = () => {
    try { localStorage.setItem(DISMISSED, JSON.stringify([...dismissedBy(), userId])) } catch { /* storage blocked: hidden for this visit only */ }
    setHidden(true)
  }
  return (
    <section aria-labelledby="home-nutrition-invite" className="relative rounded-3xl border border-dashed border-border bg-card/50 p-4 pr-12">
      <Button variant="ghost" size="icon" className="absolute right-1 top-1 size-11 rounded-full text-muted-foreground"
        aria-label={t('Not now')} onClick={dismiss}>
        <X className="size-4" />
      </Button>
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-pillar-nutrition/15 text-pillar-nutrition">
          <Apple className="size-5" strokeWidth={1.75} />
        </span>
        <h2 id="home-nutrition-invite" className="text-[15px] font-semibold">{t('Track what you eat')}</h2>
      </div>
      <p className="mt-2 text-sm leading-snug text-muted-foreground">
        {t('Get a daily calorie and protein target based on your profile. Days on target earn XP, like workouts do.')}
      </p>
      <Button variant="outline" className="mt-3 h-11 rounded-xl" onClick={onActivate}>{t('Turn on Nutrition')}</Button>
    </section>
  )
}
