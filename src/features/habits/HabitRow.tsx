import { Check, ChevronDown, ChevronUp, Flame } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { dateLocale, t, tn } from '../../lib/i18n.js'
import { iconFor } from './icons'
import { perWeekLabel, weekCountLabel } from './labels'
import { RUN_CAP, type WeekDot } from './week'
import type { Habit } from './types'

const noon = (iso: string) => new Date(iso + 'T12:00:00')
const weekday = (iso: string, style: 'long' | 'narrow') => noon(iso).toLocaleDateString(dateLocale(), { weekday: style })

// The habit's run of weeks with its goal met (habitRun), or null without one.
export function runLabel(run: number): string | null {
  if (run <= 0) return null
  if (run >= RUN_CAP) return t('{0}+ weeks in a row', RUN_CAP)
  return run === 1 ? t('1 week in a row') : tn(run, '{0} weeks in a row', run)
}

type Props = {
  habit: Habit
  // This week's target and checks of the habit (useHabits.week().byHabit).
  week: { target: number; done: number }
  // The seven days of this week, Monday first (weekDots).
  days: WeekDot[]
  // Weeks in a row with the goal met (habitRun).
  run: number
  // Whether the habit can go up or down: not past the first or the last active habit.
  canMove: { up: boolean; down: boolean }
  onMove: (dir: -1 | 1) => void
  onToggle: (day: string) => void
  onEdit: () => void
}

// One active habit on /habitos (spec 7.3): icon, name, "3 times a week", this week's count and run,
// the arrows that reorder it (plan decision 13), and the week's seven days. Today and yesterday
// (while inside a period of the pillar) are buttons that check or uncheck; the other days only show. Each day says its name and state, and a
// check shows a mark, never colour alone. Tapping the name opens the habit to edit.
export default function HabitRow({ habit, week, days, run, canMove, onMove, onToggle, onEdit }: Props) {
  const Icon = iconFor(habit.icon)
  const name = habit.name
  const complete = week.target > 0 && week.done >= week.target
  const streak = runLabel(run)
  const todayAt = days.findIndex(d => d.today)
  return (
    <li className="flex flex-col gap-1 border-b border-border px-2 py-2 last:border-b-0">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onEdit} aria-label={t('Edit {0}', name)}
          className="-ml-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none">
          <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-foreground">
            <Icon className="size-[18px]" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-medium leading-snug">{name}</span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{perWeekLabel(habit.per_week)}</span>
              <span aria-hidden>·</span>
              <span className={cn('inline-flex items-center gap-1 tabular-nums', complete && 'text-foreground')}>
                {complete && <Check aria-hidden className="size-3.5" strokeWidth={2.25} />}
                {weekCountLabel(week.done, week.target)}
              </span>
              {streak && (
                <span className="inline-flex items-center gap-1 tabular-nums">
                  <Flame aria-hidden className="size-3.5 text-pillar-habits" />{streak}
                </span>
              )}
            </span>
          </span>
        </button>
        <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Move up')}
          disabled={!canMove.up} onClick={() => onMove(-1)}>
          <ChevronUp aria-hidden className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Move down')}
          disabled={!canMove.down} onClick={() => onMove(1)}>
          <ChevronDown aria-hidden className="size-5" />
        </Button>
      </div>
      <div role="group" aria-label={name} className="-mx-2 grid grid-cols-7">
        {days.map((d, i) => {
          const isToday = d.today
          const future = i > todayAt
          const dayName = isToday ? t('Today') : d.markable ? t('Yesterday') : weekday(d.day, 'long')
          const label = d.checked ? t('{0}, done', dayName) : future ? t('{0}, still ahead', dayName) : t('{0}, not done', dayName)
          const body = (
            <>
              <span aria-hidden className={cn(
                'grid size-8 place-items-center rounded-full transition-colors duration-150 motion-reduce:transition-none',
                d.checked ? 'bg-pillar-habits text-background'
                  : d.markable ? 'border-2 border-foreground/35'
                    : future ? 'border border-dotted border-border' : 'border border-border bg-secondary/50'
              )}>
                {d.checked && <Check className="size-4" strokeWidth={2.75} />}
              </span>
              <span aria-hidden className={cn('text-[11px] leading-none', isToday ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                {weekday(d.day, 'narrow')}
              </span>
            </>
          )
          const cell = 'flex h-14 min-w-0 flex-col items-center justify-center gap-1'
          return d.markable ? (
            <button key={d.day} type="button" aria-label={label} aria-pressed={d.checked} onClick={() => onToggle(d.day)}
              className={cn(cell, 'rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-95 motion-reduce:active:scale-100')}>
              {body}
            </button>
          ) : (
            <span key={d.day} role="img" aria-label={label} className={cn(cell, future && 'opacity-60')}>{body}</span>
          )
        })}
      </div>
    </li>
  )
}
