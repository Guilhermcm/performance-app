import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Crown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '../../../lib/i18n.js'
import { achievementByCode, type AchievementCode } from '../achievements'
import { ACHIEVEMENT_TEXT } from '../achievement-labels'
import { AchievementIcon } from './AchievementIcon'
import { ACCENT_TEXT } from './accent'
import { fmtInt } from '../format'
import type { Celebration } from '../types'

type View = { eyebrow: string; title: string; detail: string; xp: number; icon: ReactNode }

function viewOf(c: Celebration): View {
  if (c.kind === 'level') {
    return {
      eyebrow: t('Level up!'), title: t('Level {0}', c.level), detail: t('You reached level {0}.', c.level), xp: 0,
      icon: <span className="grid size-20 place-items-center rounded-3xl bg-primary text-primary-foreground"><Crown className="size-10" strokeWidth={1.75} /></span>
    }
  }
  const text = ACHIEVEMENT_TEXT[c.code as AchievementCode]
  return {
    eyebrow: t('Achievement unlocked'), title: text ? text.title() : c.code, detail: text ? text.detail() : '',
    xp: achievementByCode(c.code)?.xp ?? 0,
    icon: <AchievementIcon code={c.code} unlocked className="size-20 rounded-3xl" />
  }
}

// Level-ups and badges, one card at a time, above everything (the legacy #modal-root sits at
// z-index 100). A tap or Enter shows the next card; Escape skips the rest.
export function CelebrationOverlay({ items, onDone }: { items: Celebration[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const reduce = useReducedMotion() ?? false
  const card = useRef<HTMLButtonElement>(null)
  // Focus goes back to where it was (taken at the first render, before the card grabs it) once the
  // cards are gone.
  const [before] = useState(() => document.activeElement as HTMLElement | null)
  useEffect(() => () => { if (before?.isConnected) before.focus({ preventScroll: true }) }, [before])
  useEffect(() => { card.current?.focus() }, [i])
  const item = items[i]
  if (!item) return null
  const v = viewOf(item)
  const next = () => (i + 1 < items.length ? setI(i + 1) : onDone())

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="celebration-title" aria-describedby="celebration-detail"
      data-slot="celebration" onKeyDown={e => {
        if (e.key === 'Escape') { e.stopPropagation(); onDone() }
        // The card is the only stop in the dialog: Tab stays on it instead of reaching the page behind.
        else if (e.key === 'Tab') e.preventDefault()
      }}
      className="fixed inset-0 z-[150] grid place-items-center bg-background/75 px-4 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <motion.button key={i} ref={card} type="button" onClick={next}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-[28px] border border-primary/30 bg-card px-6 pb-6 pt-8 text-center font-sans text-card-foreground shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        {v.icon}
        <span className={cn('mt-2 text-xs font-semibold uppercase tracking-[0.14em]', ACCENT_TEXT)}>{v.eyebrow}</span>
        <span id="celebration-title" className="text-2xl font-semibold tracking-tight text-balance">{v.title}</span>
        <span id="celebration-detail" className="text-[15px] leading-snug text-pretty text-muted-foreground">{v.detail}</span>
        {v.xp > 0 && (
          <span className={cn('mt-1 rounded-full bg-primary/15 px-3 py-1 font-mono text-sm font-semibold tabular-nums', ACCENT_TEXT)}>{t('+{0} XP', fmtInt(v.xp))}</span>
        )}
        <span className="mt-4 text-sm text-muted-foreground">{t('Tap to continue')}</span>
        {items.length > 1 && (
          <span aria-hidden className="flex gap-1.5">
            {items.map((_, k) => <span key={k} className={cn('size-1.5 rounded-full', k === i ? 'bg-primary' : 'bg-muted-foreground/30')} />)}
          </span>
        )}
      </motion.button>
    </div>,
    document.body
  )
}
