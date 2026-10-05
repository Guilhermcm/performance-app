import { useNavigate } from 'react-router-dom'
import { ChevronRight, QrCode, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '../../lib/i18n.js'
import { starterPlanSheet } from '../../sheets.jsx'

// No routines yet: a ready-made plan in one tap, or the plan editor.
export function WelcomeCard() {
  const nav = useNavigate()
  return (
    <section data-slot="card" aria-labelledby="welcome-title" className="rounded-3xl border border-border bg-card p-5 text-card-foreground">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><Sparkles className="size-5" /></span>
        <h2 id="welcome-title" className="text-xl font-semibold tracking-tight">{t('Welcome!')}</h2>
      </div>
      <p className="mt-2 text-sm leading-snug text-muted-foreground">{t('Set up your weekly routine to get going — or load a ready-made starter plan.')}</p>
      <Button className="mt-4 h-12 w-full gap-2 rounded-xl text-base font-semibold" onClick={() => starterPlanSheet()}>
        <Sparkles aria-hidden className="size-4" />{t('Load starter plan')}
      </Button>
      <Button variant="outline" className="mt-2 h-12 w-full rounded-xl text-base" onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
    </section>
  )
}

// The gym membership codes, one tap away on arrival (switched off in Settings → Gym check-in).
export function CheckInCard() {
  const nav = useNavigate()
  return (
    <button type="button" data-testid="checkin-card" onClick={() => nav('/checkin')}
      className="flex min-h-16 w-full items-center gap-3 rounded-3xl border border-border bg-card px-4 py-3 text-left text-card-foreground outline-none transition-colors duration-150 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-[var(--blue)] text-white"><QrCode className="size-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-muted-foreground">{t('At the gym')}</span>
        <span className="block text-[15px] font-semibold">{t('Check in')}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 text-muted-foreground" />
    </button>
  )
}
