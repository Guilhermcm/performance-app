import { useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CircleCheck, CircleDashed, CloudOff, Copy, RefreshCw, Scale, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useOnline } from '@/lib/use-online'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { fmtShortDay } from '../social/format'
import { dayTotals } from './classify'
import { shiftDay, todayIn } from './days'
import { useNutrition } from './useNutrition'
import { MEALS, fmtDecimal, fmtGrams, fmtKcal, fmtNumber, weekdayName } from './labels'
import NutritionInvite from './NutritionInvite'
import MealCard from './MealCard'
import PortionSheet from './PortionSheet'
import QuickAddSheet from './QuickAddSheet'
import FoodSearchSheet from './FoodSearchSheet'
import CopyFromSheet from './CopyFromSheet'
import type { DayTotals, FoodItem, FoodLog, Macros, Meal, NutritionDay } from './types'

type Which = 'today' | 'yesterday'
const EARLIER = 7
const NO_LOGS: FoodLog[] = []

// A logged food as a food again, per 100 g, so its portion can be changed. Quick and imported
// entries have no food behind them and edit as numbers.
function itemOfLog(l: FoodLog): FoodItem | null {
  if (l.source !== 'taco' && l.source !== 'off' && l.source !== 'custom') return null
  if (!l.grams || l.grams <= 0) return null
  const per = (v: number) => (v * 100) / l.grams!
  return {
    source: l.source, source_id: l.source_id, name: l.name, brand: l.brand,
    per100: { kcal: per(l.kcal), protein: per(l.protein_g), carbs: per(l.carbs_g), fat: per(l.fat_g), fiber: l.fiber_g == null ? null : per(l.fiber_g) },
    serving_g: null, serving_label: null, barcode: null
  }
}

// /nutricao: today or yesterday (the only days that can change, in the profile's time zone),
// the kcal ring, the macros, the four meals and a summary of the days before.
export default function NutritionScreen() {
  const nav = useNavigate()
  const profile = useProfile(s => s.profile)
  const online = useOnline()
  const status = useNutrition(s => s.status)
  const dropped = useNutrition(s => (s.droppedNotice ? s.droppedReason ?? 'refused' : null))
  const [which, setWhich] = useState<Which>('today')
  const today = todayIn(profile?.timezone)
  const day = which === 'today' ? today : shiftDay(today, -1)
  const logs = useNutrition(s => s.logs[day] ?? NO_LOGS)
  const target = useNutrition(s => s.targetOn(day))
  const closed = useNutrition(s => s.closed)

  const [quick, setQuick] = useState<{ meal: Meal; log?: FoodLog }>({ meal: 'breakfast' })
  const [quickOpen, setQuickOpen] = useState(false)
  const [edit, setEdit] = useState<{ item: FoodItem; log: FoodLog } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [searchMeal, setSearchMeal] = useState<Meal>('breakfast')
  const [searchOpen, setSearchOpen] = useState(false)
  const [copyInto, setCopyInto] = useState<Meal | 'all'>('all')
  const [copyOpen, setCopyOpen] = useState(false)

  // Items the server refused while offline: said once, then forgotten.
  useEffect(() => {
    if (!dropped) return
    toast(dropped === 'day_closed' ? t('Some items from days that already closed were not saved.') : t('Some items could not be saved.'))
    useNutrition.getState().dismissDropped()
  }, [dropped])

  if (!profile?.nutrition_enabled) {
    return (
      <Page>
        <h1 className="text-2xl font-semibold tracking-tight">{t('Nutrition')}</h1>
        <NutritionInvite onActivate={() => nav('/perfil')} />
      </Page>
    )
  }

  // The "+" of a meal opens the food search for it.
  const onAdd = (meal: Meal) => { setSearchMeal(meal); setSearchOpen(true) }
  const onCopy = (into: Meal | 'all') => { setCopyInto(into); setCopyOpen(true) }
  // Yesterday's item again today, same meal, same food and numbers.
  const onRepeat = (log: FoodLog) => {
    const { id: _id, updated_at: _at, day: _day, ...rest } = log
    useNutrition.getState().addLog({ ...rest, day: today })
    toast(t('Added to today: {0}', log.name))
  }
  const onEdit = (log: FoodLog) => {
    const item = itemOfLog(log)
    if (item) { setEdit({ item, log }); setEditOpen(true) } else { setQuick({ meal: log.meal, log }); setQuickOpen(true) }
  }
  const onDelete = (log: FoodLog) => {
    const s = useNutrition.getState()
    const removed = s.removeLog(log.id)
    if (!removed) return
    toast(t('{0} removed', removed.name), { action: { label: t('Undo'), onClick: () => useNutrition.getState().restoreLog(removed) } })
  }

  const earlier = closed.filter(d => d.day < shiftDay(today, -1)).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, EARLIER)

  return (
    <Page>
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Nutrition')}</h1>
        <ToggleGroup type="single" value={which} aria-label={t('Day')} onValueChange={v => { if (v) setWhich(v as Which) }}
          className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
          {(['today', 'yesterday'] as const).map(w => (
            <ToggleGroupItem key={w} value={w}
              className="h-11 rounded-xl text-sm font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm">
              {w === 'today' ? t('Today') : t('Yesterday')}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>

      {!online && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5 shrink-0" />{t('Offline. What you log stays on this phone and syncs when you reconnect.')}
        </p>
      )}

      {status === 'loading' || status === 'idle' ? <DaySkeleton /> : status === 'error' ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] font-medium leading-snug">{t('Could not load your food diary.')}</p>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void useNutrition.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      ) : (
        <>
          <DaySummary totals={dayTotals(logs)} target={target} />
          {MEALS.map(m => (
            <MealCard key={m} meal={m} logs={logs.filter(l => l.meal === m)} editable onAdd={onAdd} onEdit={onEdit} onDelete={onDelete}
              onCopy={onCopy} onRepeat={day === today ? undefined : onRepeat} />
          ))}
          <Button variant="outline" className="h-11 gap-2 self-start rounded-xl" onClick={() => onCopy('all')}>
            <Copy aria-hidden className="size-4" />{t('Copy a whole day')}
          </Button>
          {earlier.length > 0 && <EarlierDays days={earlier} />}
        </>
      )}

      <FoodSearchSheet day={day} meal={searchMeal} open={searchOpen} onOpenChange={setSearchOpen} />
      <CopyFromSheet day={day} meal={copyInto} open={copyOpen} onOpenChange={setCopyOpen} />
      <QuickAddSheet meal={quick.meal} log={quick.log} day={day} open={quickOpen} onOpenChange={setQuickOpen} />
      {edit && <PortionSheet item={edit.item} log={edit.log} meal={edit.log.meal} day={edit.log.day} open={editOpen} onOpenChange={setEditOpen} />}
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">{children}</div>
}

const R = 52
const C = 2 * Math.PI * R

// The kcal ring with what was eaten, the goal and what is left (or how far over), and the three
// macro bars, each with its name and grams.
function DaySummary({ totals, target }: { totals: DayTotals; target: Macros | null }) {
  const eaten = Math.round(totals.kcal)
  const goal = target ? Math.round(target.kcal) : null
  const left = goal == null ? null : goal - eaten
  const share = goal ? Math.min(1, eaten / goal) : 0
  const over = left != null && left < 0
  const macros: [string, number, number | null][] = [
    [t('Protein'), totals.protein_g, target?.protein_g ?? null],
    [t('Carbs'), totals.carbs_g, target?.carbs_g ?? null],
    [t('Fat'), totals.fat_g, target?.fat_g ?? null],
  ]

  return (
    <section aria-label={t('Day summary')} className="flex flex-col gap-5 rounded-3xl bg-card p-5">
      <div data-testid="kcal-ring" className="flex items-center gap-5">
        <div className="relative size-32 shrink-0">
          <svg viewBox="0 0 128 128" aria-hidden className="size-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" strokeWidth="12" className="stroke-secondary" />
            <circle cx="64" cy="64" r={R} fill="none" strokeWidth="12" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - share)}
              className={cn('transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none', over ? 'stroke-foreground' : 'stroke-pillar-nutrition')} />
          </svg>
          {left != null && (
            <dl className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col-reverse items-center">
                <dt className="text-xs text-muted-foreground">{over ? t('Over') : t('Left')}</dt>
                <dd className="font-mono text-2xl font-semibold leading-tight tabular-nums">{fmtNumber(Math.abs(left))}</dd>
              </div>
            </dl>
          )}
        </div>
        <dl className="flex flex-1 flex-col gap-3">
          <div className="flex flex-col">
            <dt className="text-xs text-muted-foreground">{t('Eaten')}</dt>
            <dd className="font-mono text-xl font-semibold tabular-nums">{fmtNumber(eaten)}</dd>
          </div>
          {goal != null && (
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{t('Goal')}</dt>
              <dd className="font-mono text-xl font-semibold tabular-nums">{fmtNumber(goal)}</dd>
            </div>
          )}
          {goal == null && <p className="text-xs text-muted-foreground">{t('No target for this day yet.')}</p>}
        </dl>
      </div>

      <div className="flex flex-col gap-3">
        {macros.map(([label, value, of]) => (
          <div key={label} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between text-sm">
              <span>{label}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{of == null ? fmtGrams(value) : `${fmtDecimal(value)} / ${fmtGrams(of)}`}</span>
            </div>
            <Progress aria-label={label} value={of ? Math.min(100, (value / of) * 100) : 0}
              className="h-2 bg-secondary [&>[data-slot=progress-indicator]]:bg-pillar-nutrition [&>[data-slot=progress-indicator]]:duration-300 motion-reduce:[&>[data-slot=progress-indicator]]:transition-none" />
          </div>
        ))}
      </div>
    </section>
  )
}

// What a closed day reached, with an icon and a word: never by colour alone.
function dayStatus(d: NutritionDay): { text: string; icon: typeof Target; on: boolean } {
  if (d.balanced) return { text: t('Balanced macros'), icon: Scale, on: true }
  if (d.on_target) return { text: t('On target'), icon: Target, on: true }
  if (d.logged) return { text: t('Logged'), icon: CircleCheck, on: false }
  return { text: t('Not enough logged'), icon: CircleDashed, on: false }
}

// Days that can no longer change: a read-only line each.
function EarlierDays({ days }: { days: NutritionDay[] }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 pt-2">
      <h2 id={id} className="text-sm font-medium text-muted-foreground">{t('Earlier days')}</h2>
      <ul className="flex list-none flex-col gap-1 p-0">
        {days.map(d => {
          const s = dayStatus(d)
          const Icon = s.icon
          return (
            <li key={d.day} className="flex min-h-14 items-center gap-3 rounded-2xl bg-card px-4 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]">{weekdayName(d.day)}</span>
                <span className="block text-xs text-muted-foreground">{fmtShortDay(d.day)}</span>
              </span>
              <span className="flex flex-col items-end gap-0.5">
                <span className="font-mono text-sm tabular-nums">{d.target ? `${fmtNumber(d.kcal)} / ${fmtKcal(d.target.kcal)}` : fmtKcal(d.kcal)}</span>
                <span className={cn('flex items-center gap-1 text-xs', s.on ? 'text-pillar-nutrition' : 'text-muted-foreground')}>
                  <Icon aria-hidden className="size-3.5" />{s.text}
                </span>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// The shape of the day while the first load runs.
function DaySkeleton() {
  return (
    <div aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-4">
      <div className="flex items-center gap-5 rounded-3xl bg-card p-5">
        <Skeleton className="size-32 rounded-full" />
        <div className="flex flex-1 flex-col gap-3"><Skeleton className="h-6 w-20" /><Skeleton className="h-6 w-24" /></div>
      </div>
      {MEALS.map(m => <Skeleton key={m} className="h-14 rounded-2xl" />)}
    </div>
  )
}
