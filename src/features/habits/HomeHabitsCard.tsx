import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useLocalNow } from '../sleep/use-local-now'
import { SLEEP_CARD as CARD } from '../sleep/card'
import { fmtNumber } from '../nutrition/labels'
import { useHabits } from './useHabits'
import { cardOrder, lateness } from './week'
import { iconFor } from './icons'
import { weekCountLabel } from './labels'
import type { Habit } from './types'

// More than this and the card shows the first ones and "See all" (spec 7.2).
const MAX_ROWS = 6

type Row = { habit: Habit; sort: number; target: number; done: number; today: boolean; late: string | null }

// "2 left in 2 days" for a late habit (plan decision 11). With no day left after today's check
// (Sunday, already checked) there is nothing to prompt, so no text: only habits that can still move.
function lateText(missing: number, days: number): string | null {
  if (days <= 0) return null
  if (days === 1) return missing === 1 ? t('1 left in 1 day') : tn(missing, '{0} left in 1 day', missing)
  return tn(missing, '{0} left in {1} days', missing, days)
}

// Home's card for the habits pillar (spec 7.2), right under the sleep card: one row per active
// habit with its week count and a check for today, the ones still missing checks first. The check
// is optimistic and goes through the queue (useHabits.toggleCheck); a second tap undoes it. The
// footer sums the week as the client predicts it (plan decision 12). With the pillar off or no
// active habit, nothing.
export default function HomeHabitsCard() {
  const nav = useNavigate()
  const profile = useProfile(s => s.profile)
  const enabled = !!profile?.habits_enabled
  const { today } = useLocalNow(profile?.timezone)
  const status = useHabits(s => s.status)
  const habits = useHabits(s => s.habits)
  const checks = useHabits(s => s.checks)
  // Not read here, but week() uses them: subscribing re-renders the card when they change.
  useHabits(s => s.targets)
  useHabits(s => s.targetsWeek)
  const toggleCheck = useHabits(s => s.toggleCheck)

  const week = useHabits.getState().week(today)
  const rows: Row[] = cardOrder(habits.filter(h => !h.archived_at).map(habit => {
    const { target = 0, done = 0 } = week.byHabit[habit.id] ?? {}
    const checked = checks.some(c => c.habit_id === habit.id && c.day === today)
    const l = lateness(target, done, checked, today)
    return { habit, sort: habit.sort, target, done, today: checked, late: l.late ? lateText(l.missing, l.days) : null }
  }))

  if (!enabled) return null
  if (!rows.length) {
    if (status !== 'idle' && status !== 'loading') return null
    return (
      <section data-testid="home-habits-card" role="status" aria-busy="true" aria-label={t('Habits')} className={CARD}>
        <div className="mb-3 flex items-center gap-3"><Skeleton className="size-10 rounded-xl" /><Skeleton className="h-5 w-36" /></div>
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3 py-1.5">
            <Skeleton className="size-9 rounded-xl" />
            <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-3.5 w-24" /></div>
            <Skeleton className="size-11 rounded-full" />
          </div>
        ))}
      </section>
    )
  }

  const shown = rows.slice(0, MAX_ROWS)
  return (
    <section data-testid="home-habits-card" aria-labelledby="home-habits-title" className={CARD}>
      <div className="mb-2 flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-pillar-habits/15 text-pillar-habits">
          <ListChecks className="size-5" strokeWidth={1.75} />
        </span>
        <h2 id="home-habits-title" className="text-[15px] font-semibold">{t("Today's habits")}</h2>
      </div>
      <ul className="flex flex-col">
        {shown.map(row => <HabitRow key={row.habit.id} row={row} onToggle={() => toggleCheck(row.habit.id, today)} />)}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <p className="min-w-0 text-sm text-muted-foreground tabular-nums">
          {t('Week: {0} of {1} · +{2} XP so far', week.c, week.q, fmtNumber(week.xp))}
        </p>
        <Button variant="ghost" className="-mr-2 h-11 shrink-0 gap-1 rounded-xl px-3 text-sm" onClick={() => nav('/habitos')}>
          {rows.length > MAX_ROWS ? t('See all') : t('Open Habits')}
          <ChevronRight aria-hidden className="size-4" />
        </Button>
      </div>
    </section>
  )
}

// Icon, name, "2 of 3 this week", the late text when it applies, and the check for today. A habit
// that met its week reads quieter, with the count saying so in words.
function HabitRow({ row, onToggle }: { row: Row; onToggle: () => void }) {
  const Icon = iconFor(row.habit.icon)
  const complete = row.target > 0 && row.done >= row.target
  const name = row.habit.name
  return (
    <li className={cn('flex items-center gap-3 py-1.5', complete && 'text-muted-foreground')}>
      <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-secondary', complete ? 'opacity-70' : 'text-foreground')}>
        <Icon className="size-[18px]" strokeWidth={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-snug">{name}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1 tabular-nums">
            {complete && <Check aria-hidden className="size-3.5" strokeWidth={2.25} />}
            {weekCountLabel(row.done, row.target)}
          </span>
          {row.late && <span className="font-semibold text-foreground">{`· ${row.late}`}</span>}
        </span>
      </span>
      <button type="button" onClick={onToggle}
        aria-label={row.today ? t('Unmark {0} today', name) : t('Mark {0} done today', name)}
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full border-2 outline-none transition-[background-color,border-color,transform] duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
          row.today ? 'border-pillar-habits bg-pillar-habits text-background' : 'border-border text-muted-foreground/40 hover:border-pillar-habits/60'
        )}>
        <Check aria-hidden className="size-5" strokeWidth={row.today ? 2.75 : 2} />
      </button>
    </li>
  )
}
