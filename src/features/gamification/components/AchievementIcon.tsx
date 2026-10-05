import {
  Beef, CalendarCheck, Crown, Dumbbell, Flame, Lock, NotebookPen, Salad, Scale, Sunrise, Swords, Target, Trophy, UserPlus,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { achievementByCode, type Metric } from '../achievements'
import { ACCENT_TEXT } from './accent'

const ICON: Record<Metric, LucideIcon> = {
  workouts: Dumbbell, prs: Trophy, week_targets: Target, best_streak: Flame, weigh_in_run: Scale,
  level: Crown, early_workouts: Sunrise, friends: UserPlus, challenges_won: Swords,
  nutrition_logged_days: NotebookPen, nutrition_on_target_days: Salad, nutrition_week_targets: CalendarCheck,
  nutrition_best_streak: Flame, protein_best_run: Beef
}

// Decorative: the badge's name is always written next to it.
export function AchievementIcon({ code, unlocked, className }: { code: string; unlocked: boolean; className?: string }) {
  const a = achievementByCode(code)
  const Icon = a ? ICON[a.metric] : Trophy
  return (
    <span aria-hidden data-slot="achievement-icon"
      className={cn('relative grid shrink-0 place-items-center rounded-2xl', unlocked ? ['bg-primary/15', ACCENT_TEXT] : 'bg-muted text-muted-foreground dark:text-muted-foreground/70', className)}>
      <Icon className="size-[55%]" strokeWidth={1.75} />
      {!unlocked && (
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full border border-border bg-card text-muted-foreground">
          <Lock className="size-3" />
        </span>
      )}
    </span>
  )
}
