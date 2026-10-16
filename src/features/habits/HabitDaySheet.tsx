import { Check, Circle, CircleDashed, CircleDot, Sparkles, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useLocalNow } from '../sleep/use-local-now'
import { nightDate as dayDate } from '../sleep/labels'
import { shiftDay } from '../nutrition/days'
import { fmtNumber } from '../nutrition/labels'
import { HABIT_DAY_STATE, closedState, openChecks } from './history'
import { iconFor } from './icons'
import { useHabits } from './useHabits'
import type { Habit, HabitHistory } from './types'

// The calendar's shapes, so the sheet reads like the day it was opened from.
const STATUS_ICON: Record<'all' | 'partial' | 'none' | 'open' | 'pending', LucideIcon> = {
  all: Check, partial: CircleDot, none: Circle, open: CircleDashed, pending: CircleDashed,
}

type Props = {
  day: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // The calendar's month holding the day, when it is older than what the store keeps (recent).
  history?: HabitHistory | null
}

// A day of the habits calendar (spec 7.3, plan decision 14). A closed day lists the habits checked
// that day in list order, and says which check went over its habit's goal for the week and so did
// not count; it is read only. Today and yesterday list the active habits, each a check that goes
// through the store's queue (useHabits.toggleCheck): on a Monday this is how Sunday gets checked,
// since the seven dots of each row are the current week.
export default function HabitDaySheet({ day, open, onOpenChange, history }: Props) {
  const profile = useProfile(s => s.profile)
  const { today } = useLocalNow(profile?.timezone)
  const habits = useHabits(s => s.habits)
  const checks = useHabits(s => s.checks)
  const recent = useHabits(s => s.recent)
  const toggleCheck = useHabits(s => s.toggleCheck)

  const markable = day === today || day === shiftDay(today, -1)
  const source = [history, recent].find(s => s?.days.some(d => d.day === day)) ?? null
  const row = source?.days.find(d => d.day === day) ?? null

  let state: 'all' | 'partial' | 'none' | 'open' | 'pending'
  let list: { habit: Habit; over: boolean }[] = []
  if (markable) state = 'open'
  else if (row && source) {
    // The closed row speaks for the day; counted is false on a check past its habit's goal.
    const counted = new Map(source.checks.filter(c => c.day === day).map(c => [c.habit_id, c.counted]))
    list = habits.filter(h => counted.has(h.id)).map(habit => ({ habit, over: counted.get(habit.id) === false }))
    state = closedState(row, source.targets)
  } else {
    // Closed on the server but its row has not reached the phone: the checks known so far, to confirm.
    const ids = new Set(openChecks(day, [...(history?.checks ?? []), ...(recent?.checks ?? []), ...checks], habits))
    list = habits.filter(h => ids.has(h.id)).map(habit => ({ habit, over: false }))
    state = list.length ? 'pending' : 'none'
  }
  const StatusIcon = STATUS_ICON[state]
  const statusText = state === 'pending' ? t('To confirm') : HABIT_DAY_STATE[state].label()
  const done = new Set(openChecks(day, checks, habits))
  const active = habits.filter(h => !h.archived_at)

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl first-letter:uppercase">{dayDate(day)}</DrawerTitle>
          <DrawerDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className={cn('flex items-center gap-1.5', state === 'all' ? 'text-pillar-habits' : 'text-muted-foreground')}>
              <StatusIcon aria-hidden className="size-4" /><span>{statusText}</span>
            </span>
            {!markable && row && row.xp > 0 && (
              <span className="flex items-center gap-1.5 text-foreground">
                <Sparkles aria-hidden className="size-4 text-pillar-habits" />
                <span className="font-mono tabular-nums">{t('+{0} XP', fmtNumber(row.xp))}</span>
              </span>
            )}
          </DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4">
          {markable ? (
            <ul aria-label={t('Habits')} className="divide-y divide-border rounded-2xl bg-card px-2">
              {active.map(habit => {
                const Icon = iconFor(habit.icon)
                const checked = done.has(habit.id)
                return (
                  <li key={habit.id}>
                    <button type="button" aria-pressed={checked} aria-label={habit.name} onClick={() => toggleCheck(habit.id, day)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none">
                      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
                        <Icon className="size-[18px]" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{habit.name}</span>
                      <span aria-hidden className={cn(
                        'grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-150 motion-reduce:transition-none',
                        checked ? 'bg-pillar-habits text-background' : 'border-2 border-foreground/35'
                      )}>
                        {checked && <Check className="size-4" strokeWidth={2.75} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : list.length > 0 ? (
            <ul aria-label={t('Habits')} className="divide-y divide-border rounded-2xl bg-card px-4">
              {list.map(({ habit, over }) => {
                const Icon = iconFor(habit.icon)
                return (
                  <li key={habit.id} className="flex min-h-12 items-center gap-3 py-2">
                    <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
                      <Icon className="size-[18px]" strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{habit.name}</span>
                    {over && (
                      <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-dashed border-border px-2.5 text-xs font-medium text-muted-foreground">
                        {t('Over the goal')}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="rounded-2xl bg-card p-5 text-sm leading-snug text-muted-foreground">{t('No habit checked on this day.')}</p>
          )}
        </div>

        <DrawerFooter className="pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Button variant="outline" className="h-12 rounded-xl text-[15px]" onClick={() => onOpenChange(false)}>{t('Close')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
