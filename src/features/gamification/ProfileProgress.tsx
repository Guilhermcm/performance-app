import { useNavigate } from 'react-router-dom'
import { Apple, ChevronRight, Dumbbell, Trophy, type LucideIcon } from 'lucide-react'
import { t } from '../../lib/i18n.js'
import { useProgress } from './useProgress'
import { ACHIEVEMENTS } from './achievements'
import { cn } from '@/lib/utils'
import { LevelBar } from './components/LevelBar'
import { ACCENT_TEXT } from './components/accent'
import { fmtInt } from './format'
import type { LevelInfo } from './types'

// The Profile's progress block (spec §3.4): overall level, one bar per pillar (icon and name, never
// colour alone) and the way into the achievements. Nothing until the first answer.
export default function ProfileProgress() {
  const navigate = useNavigate()
  const progress = useProgress(s => s.progress)
  if (!progress) return null
  // A cached progress from an older build may lack pillars.
  const strength = progress.pillars?.strength
  const nutrition = progress.pillars?.nutrition

  return (
    <section data-slot="card" aria-labelledby="sec-progress" className="rounded-2xl border border-border bg-card px-5 pb-3 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sec-progress" className="text-[15px] font-semibold">{t('Overall level')}</h2>
        <span className="font-mono text-[15px] font-semibold tabular-nums">{t('Level {0}', progress.level.level)}</span>
      </div>
      <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">{t('Total XP')}: {fmtInt(progress.total_xp)}</p>
      <LevelBar className="mt-3" to={progress.level} instant label={t('Overall level')} />
      {strength && (
        <PillarBar label={t('Strength')} icon={Dumbbell} level={strength} iconClass="text-[var(--pillar-strength)]"
          track="bg-[color-mix(in_oklab,var(--pillar-strength)_18%,transparent)]" fill="bg-[var(--pillar-strength)]" />
      )}
      {nutrition && (
        <PillarBar label={t('Nutrition')} icon={Apple} level={nutrition} iconClass="text-pillar-nutrition"
          track="bg-pillar-nutrition/15" fill="bg-pillar-nutrition" />
      )}
      <button type="button" onClick={() => navigate('/conquistas')}
        className="-mx-2 mt-3 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="flex shrink-0 items-center gap-2 text-[15px] font-medium"><Trophy aria-hidden className={cn('size-4 shrink-0', ACCENT_TEXT)} />{t('Achievements')}</span>
        <span className="flex min-w-0 items-center gap-1 text-right text-sm text-muted-foreground">
          {t('{0} of {1} unlocked', progress.achievements.length, ACHIEVEMENTS.length)}<ChevronRight aria-hidden className="size-4 shrink-0" />
        </span>
      </button>
    </section>
  )
}

// One pillar: icon and name (never colour alone), its level and its bar.
function PillarBar({ label, icon: Icon, level, iconClass, track, fill }: {
  label: string; icon: LucideIcon; level: LevelInfo; iconClass: string; track: string; fill: string
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium"><Icon aria-hidden className={cn('size-4', iconClass)} />{label}</span>
        <span className="font-mono tabular-nums text-muted-foreground">{t('Level {0}', level.level)}</span>
      </div>
      <LevelBar className={cn('mt-2 h-2', track)} fillClassName={fill} to={level} instant label={label} />
    </div>
  )
}
