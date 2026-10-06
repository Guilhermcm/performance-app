import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronRight, CloudOff } from 'lucide-react'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { useOnline } from '@/lib/use-online'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { fmtShortDay } from '../social/format'
import { shiftDay, todayIn } from './days'
import { WINDOW_DAYS, useNutrition } from './useNutrition'
import { fetchLogs } from './nutrition-api'
import { MEAL_LABEL, fmtKcal, weekdayName } from './labels'
import type { FoodLog, Meal } from './types'

const DAYS_BACK = 30

type Props = { day: string; meal: Meal | 'all'; open: boolean; onOpenChange: (open: boolean) => void }
type Row = { day: string; count: number; kcal: number }

const itemsText = (n: number) => (n === 1 ? t('1 item') : t('{0} items', n))

const byDay = (logs: FoodLog[]) => {
  const out: Record<string, FoodLog[]> = {}
  for (const l of logs) (out[l.day] ??= []).push(l)
  return out
}

// "Copy from…": the days of the last 30 that have something in this meal (or anything, for a
// whole day), newest first, each with its item count and kcal. Tapping one copies its items into
// `day` as new items, the food and its numbers kept as they were. The phone keeps two weeks; the
// older days are fetched when the sheet opens online, and offline a line says they need a connection.
export default function CopyFromSheet({ day, meal, open, onOpenChange }: Props) {
  const tz = useProfile(s => s.profile?.timezone)
  const local = useNutrition(s => s.logs)
  const online = useOnline()
  const today = todayIn(tz)
  const yesterday = shiftDay(today, -1)
  const from = shiftDay(today, -DAYS_BACK)
  const [older, setOlder] = useState<Record<string, FoodLog[]>>({})

  useEffect(() => {
    if (!open || !online) return
    let live = true
    fetchLogs(from, shiftDay(today, -(WINDOW_DAYS + 1))).then(
      ls => { if (live) setOlder(byDay(ls)) },
      () => { /* the days on the phone are still listed */ }
    )
    return () => { live = false }
  }, [open, online, from, today])

  // The phone's copy of a day wins over the fetched one: it has the changes not yet sent.
  const logs = useMemo(() => ({ ...older, ...local }), [older, local])

  const rows = useMemo<Row[]>(() => Object.entries(logs)
    .filter(([d]) => d !== day && d >= from && d <= today)
    .map(([d, ls]) => {
      const items = meal === 'all' ? ls : ls.filter(l => l.meal === meal)
      return { day: d, count: items.length, kcal: items.reduce((n, l) => n + l.kcal, 0) }
    })
    .filter(r => r.count > 0)
    .sort((a, b) => (a.day < b.day ? 1 : -1)), [logs, day, meal, from, today])

  const copy = (from: string) => {
    const s = useNutrition.getState()
    const source = logs[from]
    const n = meal === 'all' ? s.copyDay(from, day, source) : s.copyMeal(from, meal, day, meal, source)
    toast(n === 1 ? t('1 item copied') : t('{0} items copied', n))
    onOpenChange(false)
  }

  const dayName = (d: string) => (d === today ? t('Today') : d === yesterday ? t('Yesterday') : weekdayName(d))

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{meal === 'all' ? t('Copy a whole day') : t('Copy to {0}', MEAL_LABEL[meal]())}</DrawerTitle>
          <DrawerDescription>{t('Pick a day from the last 30.')}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {rows.length ? (
            <ul className="flex list-none flex-col gap-1 p-0">
              {rows.map(r => (
                <li key={r.day}>
                  <button type="button" onClick={() => copy(r.day)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-card px-4 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]">{dayName(r.day)}</span>
                      <span className="block text-xs text-muted-foreground">{`${fmtShortDay(r.day)}, ${itemsText(r.count)}`}</span>
                    </span>
                    <span className="font-mono text-sm tabular-nums">{fmtKcal(r.kcal)}</span>
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">{t('Nothing to copy from the last 30 days.')}</p>
          )}
          {!online && (
            <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <CloudOff aria-hidden className="size-3.5 shrink-0" />{t('Days older than two weeks need a connection.')}
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
