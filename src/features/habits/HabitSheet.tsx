import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { todayIn } from '../nutrition/days'
import { MAX_ACTIVE_HABITS, useHabits } from './useHabits'
import { toHabitError } from './habits-api'
import { HABIT_ICONS, iconFor } from './icons'
import { iconLabel, perWeekLabel } from './labels'
import { newTarget } from './week'
import { weekStartOf } from '../gamification/xp'
import type { Habit } from './types'

// Spec 3.2: a name of 1 to 40 characters (trimmed), N from 1 to 7.
const NAME_MAX = 40
const PER_WEEK = [1, 2, 3, 4, 5, 6, 7]
const DEFAULT_PER_WEEK = 7
const DEFAULT_ICON = 'check'

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'

// Characters as people count them (and as the server's char_length does), not UTF-16 units.
const chars = (s: string) => Array.from(s)

export const fullText = () => t('You already have {0} active habits, the most allowed. Archive one to make room.', MAX_ACTIVE_HABITS)

type Props = { habit?: Habit; open: boolean; onOpenChange: (open: boolean) => void }

// Creating and editing a habit (spec 3.2, 3.3 and 7.3): name, icon and N. An archived habit can be
// edited and brought back; an active one can be archived after a confirmation.
export default function HabitSheet({ habit, open, onOpenChange }: Props) {
  // A fresh form each time the sheet opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <SheetBody key={session} habit={habit} onDone={() => onOpenChange(false)} />
      </DrawerContent>
    </Drawer>
  )
}

function SheetBody({ habit, onDone }: { habit?: Habit; onDone: () => void }) {
  const timezone = useProfile(s => s.profile?.timezone)
  const activeCount = useHabits(s => s.habits.filter(h => !h.archived_at).length)
  const [name, setName] = useState(habit?.name ?? '')
  const [icon, setIcon] = useState(habit && HABIT_ICONS.includes(habit.icon) ? habit.icon : DEFAULT_ICON)
  const [perWeek, setPerWeek] = useState(habit?.per_week ?? DEFAULT_PER_WEEK)
  const [asking, setAsking] = useState(false)
  const id = useId()

  const creating = !habit
  const archived = !!habit?.archived_at
  // Creating and reactivating both add an active habit: the 20 limit and the days left apply.
  const adds = creating || archived
  const full = adds && activeCount >= MAX_ACTIVE_HABITS
  const trimmed = name.trim()
  const today = todayIn(timezone)
  // Reactivating never goes below the target the week already kept (the server's
  // greatest(existing, min(N, days left))), e.g. archived on Thursday with 2 checks.
  const kept = useHabits(s => (habit && s.targetsWeek === weekStartOf(today) ? s.targets[habit.id] ?? 0 : 0))
  const thisWeek = archived ? Math.max(kept, newTarget(perWeek, today)) : newTarget(perWeek, today)
  const newN = !!habit && !archived && perWeek !== habit.per_week
  const changed = !habit || trimmed !== habit.name || icon !== habit.icon || perWeek !== habit.per_week
  const canGo = trimmed.length > 0 && !full

  const submit = () => {
    if (!canGo) return
    const { saveHabit, reactivateHabit } = useHabits.getState()
    const fields = { name: trimmed, icon, per_week: perWeek }
    try {
      if (!habit) {
        saveHabit(fields)
        toast(t('Habit created'))
      } else if (archived) {
        // The edits first, so the habit comes back with the N it counts by this week.
        if (changed) saveHabit({ id: habit.id, ...fields })
        reactivateHabit(habit.id)
        toast(t('Habit reactivated'))
      } else if (changed) {
        saveHabit({ id: habit.id, ...fields })
        toast(t('Saved'))
      }
      onDone()
    } catch (e) {
      toast(toHabitError(e) === 'too_many_habits' ? fullText() : t('Could not save. Your previous values were kept.'))
    }
  }

  const archive = () => {
    if (!habit) return
    useHabits.getState().archiveHabit(habit.id)
    toast(t('Habit archived'))
    onDone()
  }

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl">{creating ? t('New habit') : t('Edit habit')}</DrawerTitle>
        <DrawerDescription>{t('Choose a name, an icon and how many times a week you want to do it.')}</DrawerDescription>
      </DrawerHeader>

      <form id="habit-sheet" className="flex flex-col gap-6 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={id + '-name'} className="text-sm font-medium text-muted-foreground">{t('Name')}</label>
            <span id={id + '-count'} className="font-mono text-xs tabular-nums text-muted-foreground">{`${chars(name).length}/${NAME_MAX}`}</span>
          </div>
          <Input id={id + '-name'} value={name} autoComplete="off" enterKeyHint="done" aria-describedby={id + '-count'}
            className="h-12 rounded-xl text-[15px]"
            onChange={e => setName(chars(e.target.value).slice(0, NAME_MAX).join(''))} />
        </div>

        <div className="flex flex-col gap-2">
          <span id={id + '-icon'} className="text-sm font-medium text-muted-foreground">{t('Icon')}</span>
          <div role="group" aria-labelledby={id + '-icon'} className="grid grid-cols-6 gap-2">
            {HABIT_ICONS.map(key => {
              const Icon = iconFor(key)
              const on = key === icon
              return (
                <button key={key} type="button" aria-label={iconLabel(key)} aria-pressed={on} onClick={() => setIcon(key)}
                  className={cn('flex h-12 items-center justify-center rounded-xl border outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
                    on ? 'border-primary bg-primary text-primary-foreground ring-2 ring-primary/40 ring-offset-2 ring-offset-background' : 'border-border bg-card text-foreground hover:bg-secondary')}>
                  <Icon aria-hidden className="size-5" />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span id={id + '-n'} className="text-sm font-medium text-muted-foreground">{t('Times per week')}</span>
          <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby={id + '-n'}
            value={String(perWeek)} onValueChange={v => v && setPerWeek(Number(v))}>
            {PER_WEEK.map(n => (
              <ToggleGroupItem key={n} value={String(n)}
                className={cn('h-12 min-w-11 flex-1 px-0 font-mono text-base tabular-nums transition-colors duration-150', ON)}>{n}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p aria-live="polite" className="text-sm leading-snug text-muted-foreground">{perWeekLabel(perWeek)}</p>
          {newN && (
            <p role="status" className="rounded-2xl bg-secondary/70 p-3 text-sm leading-snug">{t('The new goal counts from next week.')}</p>
          )}
          {adds && thisWeek < perWeek && (
            <p className="rounded-2xl bg-secondary/70 p-3 text-sm leading-snug">
              {thisWeek === 1
                ? t('This week it counts once, since the week has already started.')
                : tn(thisWeek, 'This week it counts {0} times, since the week has already started.', thisWeek)}
            </p>
          )}
        </div>

        {habit && !archived && (asking ? (
          <div role="alertdialog" aria-labelledby={id + '-archive-q'} aria-describedby={id + '-archive-hint'} className="flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
            <div className="flex flex-col gap-1">
              <p id={id + '-archive-q'} className="text-[15px] font-semibold leading-snug">{t('Archive this habit?')}</p>
              <p id={id + '-archive-hint'} className="text-sm leading-snug text-muted-foreground">
                {t('It leaves your list and stops counting from now on. Its history stays, and you can reactivate it any time.')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
              <Button type="button" variant="destructive" className="h-12 rounded-xl" onClick={archive}>{t('Archive')}</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="-mx-3 h-11 justify-start rounded-xl px-3 text-[15px] text-destructive hover:text-destructive"
            onClick={() => setAsking(true)}>
            {t('Archive habit')}
          </Button>
        ))}
      </form>

      <DrawerFooter className="flex-col gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {full && <p role="status" className="text-sm leading-snug text-muted-foreground">{fullText()}</p>}
        <Button type="submit" form="habit-sheet" className="h-12 rounded-xl text-[15px] font-semibold" disabled={!canGo}>
          {creating ? t('Create habit') : archived ? t('Reactivate') : t('Save')}
        </Button>
      </DrawerFooter>
    </>
  )
}
