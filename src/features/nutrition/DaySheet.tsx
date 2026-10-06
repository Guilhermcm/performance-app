import { useEffect, useState } from 'react'
import { CircleDashed, CloudOff, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { fmtShortDay } from '../social/format'
import { dayTotals } from './classify'
import { shiftDay, todayIn } from './days'
import { fetchLogs } from './nutrition-api'
import { WINDOW_DAYS, useNutrition } from './useNutrition'
import { MEALS, dayStatus, fmtDecimal, fmtGrams, fmtKcal, fmtNumber, weekdayName } from './labels'
import MealCard from './MealCard'
import type { MonthCell } from './history'
import type { FoodLog, Macros } from './types'

type Props = { cell: MonthCell | null; open: boolean; onOpenChange: (open: boolean) => void }
type Items = { status: 'loading' | 'ready' | 'error' | 'offline'; logs: FoodLog[] }

const NO_LOGS: FoodLog[] = []
const noop = () => {}

// A day of the history calendar: kcal and macros against that day's target, the day's class, the
// XP it earned and its items per meal, read only. The phone keeps the last two weeks; an older day's
// items are fetched (the same read as "Copy from…"), and offline the summary stays with a line
// saying the items need a connection.
export default function DaySheet({ cell, open, onOpenChange }: Props) {
  const tz = useProfile(s => s.profile?.timezone)
  const online = useOnline()
  const today = todayIn(tz)
  const day = cell?.day ?? null
  const local = useNutrition(s => (day ? s.logs[day] ?? NO_LOGS : NO_LOGS))
  const dayTarget = useNutrition(s => (day ? s.targetOn(day) : null))
  const remote = day != null && day < shiftDay(today, -WINDOW_DAYS)
  const [fetched, setFetched] = useState<Items>({ status: 'loading', logs: [] })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open || !remote || !day) return
    if (!online) { setFetched({ status: 'offline', logs: [] }); return }
    let live = true
    setFetched({ status: 'loading', logs: [] })
    fetchLogs(day, day).then(
      logs => { if (live) setFetched({ status: 'ready', logs }) },
      () => { if (live) setFetched({ status: 'error', logs: [] }) }
    )
    return () => { live = false }
  }, [open, remote, day, online, attempt])

  if (!cell) return null
  const items: Items = remote ? fetched : { status: 'ready', logs: local }
  const data = cell.data
  // An open day has no closed row yet: its numbers come from the phone, as the diary shows them.
  const totals: Macros = data ?? dayTotals(local)
  const target = data ? data.target : dayTarget
  const status = data && cell.state !== 'open' ? dayStatus(data) : { text: t('Still open'), icon: CircleDashed, on: false }
  const StatusIcon = status.icon

  const rows: [string, string][] = [
    [t('Calories'), target ? `${fmtNumber(totals.kcal)} / ${fmtKcal(target.kcal)}` : fmtKcal(totals.kcal)],
    [t('Protein'), target ? `${fmtDecimal(totals.protein_g)} / ${fmtGrams(target.protein_g)}` : fmtGrams(totals.protein_g)],
    [t('Carbs'), target ? `${fmtDecimal(totals.carbs_g)} / ${fmtGrams(target.carbs_g)}` : fmtGrams(totals.carbs_g)],
    [t('Fat'), target ? `${fmtDecimal(totals.fat_g)} / ${fmtGrams(target.fat_g)}` : fmtGrams(totals.fat_g)],
  ]
  const meals = MEALS.filter(m => items.logs.some(l => l.meal === m))

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{`${weekdayName(cell.day)}, ${fmtShortDay(cell.day)}`}</DrawerTitle>
          <DrawerDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={cn('flex items-center gap-1.5', status.on ? 'text-pillar-nutrition' : 'text-muted-foreground')}>
              <StatusIcon aria-hidden className="size-4" /><span>{status.text}</span>
            </span>
            {data && cell.state !== 'open' && data.xp != null && (
              <span className="flex items-center gap-1.5 text-foreground">
                <Sparkles aria-hidden className="size-4 text-pillar-nutrition" />
                <span className="font-mono tabular-nums">{t('+{0} XP', fmtNumber(data.xp))}</span>
              </span>
            )}
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <dl className="grid grid-cols-2 gap-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex flex-col rounded-2xl bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-mono text-[15px] font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {items.status === 'loading' ? (
            <div role="status" aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-2">
              <Skeleton className="h-14 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" />
            </div>
          ) : items.status === 'offline' ? (
            <p className="flex items-center gap-2 rounded-2xl bg-card p-4 text-sm text-muted-foreground">
              <CloudOff aria-hidden className="size-4 shrink-0" />{t("This day's items need a connection.")}
            </p>
          ) : items.status === 'error' ? (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-card p-4">
              <p className="text-sm">{t("Could not load this day's items.")}</p>
              <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => setAttempt(n => n + 1)}>
                <RefreshCw aria-hidden className="size-4" />{t('Try again')}
              </Button>
            </div>
          ) : meals.length ? (
            meals.map(m => (
              <MealCard key={m} meal={m} logs={items.logs.filter(l => l.meal === m)} editable={false} onAdd={noop} onEdit={noop} onDelete={noop} />
            ))
          ) : (
            <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{t('Nothing logged on this day.')}</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
