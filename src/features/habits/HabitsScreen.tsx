import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, CloudOff, Flame, ListChecks, Plus, RefreshCw, Shield, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { cn } from '@/lib/utils'
import { t, tn } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useProgress } from '../gamification/useProgress'
import { SHIELD_MAX } from '../gamification/xp'
import { useLocalNow } from '../sleep/use-local-now'
import { SLEEP_CARD as CARD } from '../sleep/card'
import { droppedNoticeText, useHabits } from './useHabits'
import { toHabitError } from './habits-api'
import { habitRun, weekDots } from './week'
import { iconFor } from './icons'
import HabitRow from './HabitRow'
import HabitSheet, { fullText } from './HabitSheet'
import HabitsSetup from './HabitsSetup'
import type { Habit } from './types'

const weeksText = (n: number) => (n === 1 ? t('1 week') : tn(n, '{0} weeks', n))

// /habitos (spec 7.3): this week's C of Q with the streak and shields, the active habits in their
// order with the week's seven days, room for the calendar (Task 11) and the archived habits last.
// Opens from the Home card, the radar and the Profile; with the pillar off, the invite to turn it on.
export default function HabitsScreen() {
  const navigate = useNavigate()
  const profile = useProfile(s => s.profile)
  const online = useOnline()
  const status = useHabits(s => s.status)
  const dropped = useHabits(s => s.droppedNotice)
  const [setupOpen, setSetupOpen] = useState(false)

  // Checks the server refused after a stretch offline (their day had closed): said once, then forgotten.
  useEffect(() => {
    if (!dropped) return
    toast(droppedNoticeText())
    useHabits.getState().dismissDropped()
  }, [dropped])

  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/home'))
  const header = (
    <header className="flex flex-col">
      <div className="-ml-2 flex h-11 items-center">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={goBack}>
          <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
        </Button>
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Habits')}</h1>
    </header>
  )
  // Outside both branches: turning the pillar on flips the profile, and the setup has to stay open
  // to create the first habit.
  const setup = <HabitsSetup open={setupOpen} onOpenChange={setSetupOpen} />

  if (!profile?.habits_enabled) {
    return (
      <>
        <Page>{header}<Invite onActivate={() => setSetupOpen(true)} /></Page>
        {setup}
      </>
    )
  }

  return (
    <>
      <Page>
        {header}
        {!online && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CloudOff aria-hidden className="size-3.5 shrink-0" />{t('Offline. Your checks stay on this phone and sync when you reconnect.')}
          </p>
        )}
        {status === 'idle' || status === 'loading'
          ? <ScreenSkeleton />
          : <Habits key={profile.id} timezone={profile.timezone} failed={status === 'error'} />}
      </Page>
      {setup}
    </>
  )
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">{children}</div>
}

// The screen with the pillar off: what it does and the one step to turn it on.
function Invite({ onActivate }: { onActivate: () => void }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span className="grid size-14 place-items-center rounded-2xl bg-pillar-habits/15 text-pillar-habits">
        <ListChecks aria-hidden className="size-7" strokeWidth={1.75} />
      </span>
      <h2 className="text-lg font-semibold tracking-tight text-balance">{t('Track your habits')}</h2>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
        {t('Choose your habits and how many times a week you want to do each one. Every check earns XP, like workouts do.')}
      </p>
      <Button className="mt-2 h-12 w-full max-w-xs rounded-xl text-[15px]" onClick={onActivate}>{t('Turn on Habits')}</Button>
    </section>
  )
}

// Everything under the header once the store has answered. `failed`: the first pull failed with no
// saved copy; a habit made on this phone still shows, the rest offers a retry.
function Habits({ timezone, failed }: { timezone: string | null | undefined; failed: boolean }) {
  const { today } = useLocalNow(timezone)
  const habits = useHabits(s => s.habits)
  const checks = useHabits(s => s.checks)
  const recent = useHabits(s => s.recent)
  // Not read here, but week() uses them: subscribing re-renders the screen when they change.
  useHabits(s => s.targets)
  useHabits(s => s.targetsWeek)
  const toggleCheck = useHabits(s => s.toggleCheck)
  const move = useHabits(s => s.move)
  // The sheet keeps the habit it was opened with while it closes.
  const [sheet, setSheet] = useState<{ habit?: Habit; open: boolean }>({ open: false })

  const active = habits.filter(h => !h.archived_at)
  const archived = habits.filter(h => h.archived_at)
  const week = useHabits.getState().week(today)
  const create = () => setSheet({ open: true })

  const reactivate = (h: Habit) => {
    try {
      useHabits.getState().reactivateHabit(h.id)
      toast(t('Habit reactivated'))
    } catch (e) {
      toast(toHabitError(e) === 'too_many_habits' ? fullText() : t('Could not save. Your previous values were kept.'))
    }
  }

  return (
    <>
      {failed && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] font-medium leading-snug">{t('Could not load your habits.')}</p>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void useHabits.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      )}

      {active.length > 0 ? (
        <>
          <WeekTop c={week.c} q={week.q} />
          <div className="flex flex-col gap-2">
            <ul aria-label={t('Your habits')} className={cn(CARD, 'px-2 py-1')}>
              {active.map((habit, i) => {
                const { target = 0, done = 0 } = week.byHabit[habit.id] ?? {}
                return (
                  <HabitRow key={habit.id} habit={habit} week={{ target, done }} days={weekDots(habit.id, checks, today)}
                    run={recent ? habitRun(habit.id, recent, today) : 0}
                    canMove={{ up: i > 0, down: i < active.length - 1 }}
                    onMove={dir => move(habit.id, dir)} onToggle={day => toggleCheck(habit.id, day)}
                    onEdit={() => setSheet({ habit, open: true })} />
                )
              })}
            </ul>
            <Button variant="outline" className="h-12 gap-2 rounded-xl text-[15px]" onClick={create}>
              <Plus aria-hidden className="size-4" />{t('New habit')}
            </Button>
          </div>
        </>
      ) : !failed && (
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
          <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-pillar-habits/15 text-pillar-habits">
            <ListChecks className="size-7" strokeWidth={1.75} />
          </span>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
            {t('Pick something you want to do each week and check it off on the days you do it.')}
          </p>
          <Button className="mt-1 h-12 w-full max-w-xs gap-2 rounded-xl text-[15px]" onClick={create}>
            <Plus aria-hidden className="size-4" />{t('Create your first habit')}
          </Button>
        </section>
      )}

      {/* The month of checks (spec 7.3, Task 11). */}
      <div data-slot="habits-history" />

      {archived.length > 0 && (
        <section aria-labelledby="habits-archived-title" className="flex flex-col gap-2 pt-2">
          <h2 id="habits-archived-title" className="text-sm font-medium text-muted-foreground">{t('Archived')}</h2>
          <ul className={cn(CARD, 'px-2 py-1')}>
            {archived.map(h => <ArchivedRow key={h.id} habit={h} onEdit={() => setSheet({ habit: h, open: true })} onReactivate={() => reactivate(h)} />)}
          </ul>
        </section>
      )}

      <HabitSheet habit={sheet.habit} open={sheet.open} onOpenChange={open => setSheet(s => ({ ...s, open }))} />
    </>
  )
}

// The week as the client counts it (plan decision 12): C of Q in large numbers, then the streak of
// weeks on target and the shields from the progress. A cached progress from before the pillar had
// its block reads 0.
function WeekTop({ c, q }: { c: number; q: number }) {
  const streak = useProgress(s => s.progress?.habits?.streak)
  const current = streak?.current ?? 0
  const shields = Math.min(streak?.shields ?? 0, SHIELD_MAX)
  const big = (n: number, key: number) => <span key={key} className="font-mono text-4xl font-semibold leading-none tabular-nums text-foreground">{n}</span>
  // The sentence with each number set large in its place, whatever the language's word order.
  const sentence = String(t('{0} of {1} checks this week')).split(/(\{[01]\})/).map((part, i) =>
    part === '{0}' ? big(c, i) : part === '{1}' ? big(q, i) : part)
  return (
    <section data-testid="habits-week" className={cn(CARD, 'flex flex-col gap-4')}>
      <p className="text-[15px] text-muted-foreground">{sentence}</p>
      <dl className="grid grid-cols-2 gap-2">
        <div className="flex flex-col rounded-2xl bg-secondary/60 px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Flame aria-hidden className={cn('size-3.5', current > 0 ? 'text-pillar-habits' : 'text-muted-foreground')} />{t('Current streak')}
          </dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{weeksText(current)}</dd>
        </div>
        <div className="flex flex-col rounded-2xl bg-secondary/60 px-3 py-2.5">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck aria-hidden className="size-3.5" />{t('Streak shields')}
          </dt>
          <dd className="flex items-center gap-2">
            <span aria-hidden className="flex items-center gap-0.5">
              {Array.from({ length: SHIELD_MAX }, (_, i) => i < shields
                ? <ShieldCheck key={i} data-shield="on" className="size-4 text-pillar-habits" />
                : <Shield key={i} data-shield="off" className="size-4 text-muted-foreground/60" />)}
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">{t('{0} of {1}', shields, SHIELD_MAX)}</span>
          </dd>
        </div>
      </dl>
    </section>
  )
}

// An archived habit: its icon and name, the way to edit it and to bring it back.
function ArchivedRow({ habit, onEdit, onReactivate }: { habit: Habit; onEdit: () => void; onReactivate: () => void }) {
  const Icon = iconFor(habit.icon)
  return (
    <li className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0">
      <button type="button" onClick={onEdit} aria-label={t('Edit {0}', habit.name)}
        className="-ml-1 flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left text-muted-foreground outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-secondary opacity-70">
          <Icon className="size-[18px]" strokeWidth={1.75} />
        </span>
        <span className="block min-w-0 truncate text-[15px]">{habit.name}</span>
      </button>
      <Button variant="outline" className="h-11 shrink-0 rounded-xl px-3.5" onClick={onReactivate}>{t('Reactivate')}</Button>
    </li>
  )
}

// The shape of the screen while the first load runs: the week on top, then the rows.
function ScreenSkeleton() {
  return (
    <div data-testid="habits-skeleton" role="status" aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-4">
      <div className={cn(CARD, 'flex flex-col gap-4')}>
        <Skeleton className="h-9 w-48" />
        <div className="grid grid-cols-2 gap-2"><Skeleton className="h-[60px] rounded-2xl" /><Skeleton className="h-[60px] rounded-2xl" /></div>
      </div>
      <div className={cn(CARD, 'flex flex-col gap-4 px-4')}>
        {[0, 1, 2].map(i => (
          <div key={i} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-3.5 w-40" /></div>
              <Skeleton className="size-8 rounded-full" /><Skeleton className="size-8 rounded-full" />
            </div>
            <div className="grid grid-cols-7 justify-items-center">
              {Array.from({ length: 7 }, (_, d) => <Skeleton key={d} className="size-8 rounded-full" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
