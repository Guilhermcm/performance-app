import { useNavigate } from 'react-router-dom'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProgress } from './useProgress'
import { ACHIEVEMENTS, type Achievement } from './achievements'
import { ACHIEVEMENT_TEXT } from './achievement-labels'
import { AchievementIcon } from './components/AchievementIcon'
import { ACCENT_TEXT } from './components/accent'
import { fmtDay, fmtInt } from './format'

// /conquistas: every badge of the catalogue in its order, unlocked ones with their date, locked
// ones with how far along you are (or why they cannot move yet). Reached from Home and Profile.
export default function AchievementsScreen() {
  const navigate = useNavigate()
  const progress = useProgress(s => s.progress)
  const status = useProgress(s => s.status)
  const unlocked = new Map((progress?.achievements ?? []).map(a => [a.code, a.unlocked_at]))

  return (
    <div className="mx-auto flex w-full max-w-md flex-col font-sans text-foreground">
      <header className="-ml-2 flex h-11 items-center">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
      </header>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Achievements')}</h1>
      {progress && <p className="mt-1 text-sm text-muted-foreground">{t('{0} of {1} unlocked', unlocked.size, ACHIEVEMENTS.length)}</p>}

      {!progress && status === 'error' ? (
        <div className="mt-6 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] font-medium">{t('Could not load your progress.')}</p>
          <Button variant="outline" className="mt-3 h-11 gap-2 rounded-xl" onClick={() => void useProgress.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      ) : !progress ? (
        <div aria-busy="true" className="mt-5 grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-48 rounded-2xl" />)}
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 pb-6">
          {ACHIEVEMENTS.map(a => {
            const text = ACHIEVEMENT_TEXT[a.code]
            // A badge without text yet (the nutrition ones until their screens land) is not listed.
            return text && <Tile key={a.code} a={a} text={text} at={unlocked.get(a.code) ?? null} value={progress.stats[a.metric]} />
          })}
        </ul>
      )}
    </div>
  )
}

type TileText = { title: () => string; detail: () => string }

function Tile({ a, text, at, value }: { a: Achievement; text: TileText; at: string | null; value: number | undefined }) {
  const on = at !== null
  const reached = Math.min(value ?? 0, a.threshold)
  return (
    <li data-testid={'achievement-' + a.code} data-unlocked={on ? 'true' : 'false'}
      className={cn('flex flex-col gap-3 rounded-2xl border p-4', on ? 'border-primary/30 bg-card' : 'border-border bg-card/50')}>
      <AchievementIcon code={a.code} unlocked={on} className="size-12" />
      <div className="flex flex-col gap-1">
        <h2 className={cn('text-[15px] font-semibold leading-snug', !on && 'text-muted-foreground')}>{text.title()}</h2>
        <p className="text-sm leading-snug text-muted-foreground">{text.detail()}</p>
      </div>
      {/* Below the text, not beside the icon: "+1,500 XP" or "Badge only" does not fit next to it
          in a half-width tile on a 320 px phone. */}
      <span className={cn('self-start whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-xs font-semibold tabular-nums', on ? ['bg-primary/15', ACCENT_TEXT] : 'bg-muted text-muted-foreground')}>
        {a.xp > 0 ? t('+{0} XP', fmtInt(a.xp)) : t('Badge only')}
      </span>
      <div className="mt-auto text-xs text-muted-foreground">
        {at !== null ? (
          <span className={cn('font-medium', ACCENT_TEXT)}>{t('Unlocked on {0}', fmtDay(at))}</span>
        ) : typeof value === 'number' ? (
          <span className="flex flex-col gap-1.5">
            <span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${(reached / a.threshold) * 100}%` }} />
            </span>
            <span className="tabular-nums">{t('{0} of {1}', fmtInt(reached), fmtInt(a.threshold))}</span>
          </span>
        ) : (
          <span>{t('Locked')}</span>
        )}
      </div>
    </li>
  )
}
