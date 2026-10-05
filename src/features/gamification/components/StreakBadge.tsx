import { Flame, Shield, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '../../../lib/i18n.js'
import { SHIELD_MAX } from '../xp'
import { ACCENT_TEXT } from './accent'

type Props = { current: number; shields: number; expanded: boolean; onToggle: () => void; controls?: string }

// Flame with the weeks in a row, then the shields held (filled) and free slots (outline). A tap
// opens the explanation of shields where the badge sits.
export function StreakBadge({ current, shields, expanded, onToggle, controls }: Props) {
  return (
    <button type="button" data-slot="streak-badge" onClick={onToggle} aria-expanded={expanded} aria-controls={controls}
      aria-label={t('{0} week streak', current) + '. ' + t('Shields: {0} of {1}', shields, SHIELD_MAX)}
      className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary/70 py-1.5 pl-2.5 pr-3 outline-none transition-transform duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100">
      <Flame aria-hidden className={cn('size-5', current > 0 ? 'text-[var(--pillar-strength)]' : 'text-muted-foreground')} />
      <span className="font-mono text-lg font-semibold leading-none tabular-nums">{current}</span>
      <span aria-hidden className="ml-1 flex items-center gap-0.5">
        {Array.from({ length: SHIELD_MAX }, (_, i) => i < shields
          ? <ShieldCheck key={i} data-shield="on" className={cn('size-4', ACCENT_TEXT)} />
          : <Shield key={i} data-shield="off" className="size-4 text-muted-foreground/60 dark:text-muted-foreground/40" />)}
      </span>
    </button>
  )
}
