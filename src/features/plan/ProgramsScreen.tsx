// /plan/programas (spec §4.3 and §4.4): the program suggested for the person on top, with its
// reason in one line, then the whole catalog with filters by goal and by days.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { LEVEL_LABEL } from '../profile/ProfileFields'
import { profileOf, type AnalysisProfile } from './goal'
import { PROGRAMS, type ProgramId } from './programs'
import { suggestProgram } from './suggest-program'
import { PROFILE_LABEL, programCopy, programDays, programMinutes, suggestionReason } from './program-copy'

export const PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[]
const PROFILES: AnalysisProfile[] = ['hypertrophy', 'strength', 'health']
const DAY_OPTIONS = [...new Set(PROGRAM_IDS.flatMap(id => PROGRAMS[id].variants.map(v => v.days)))].sort((a, b) => a - b)

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'
const CHIP = cn('h-11 rounded-full px-4 text-sm', ON)

// The profile's goal, level and days, the same fields the onboarding fills.
export function useSuggestion() {
  const profile = useProfile(s => s.profile)
  const goal = profile?.goal ?? null
  const days = profile?.days_per_week ?? 3
  return { goal, days, profile: profileOf(goal), ...suggestProgram({ goal, level: profile?.level ?? null, days }) }
}

export default function ProgramsScreen() {
  const navigate = useNavigate()
  const suggestion = useSuggestion()
  // Back to wherever the person came from (Settings, Home, the Plan); /plan when this is the first entry.
  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/plan'))
  const [goal, setGoal] = useState<'all' | AnalysisProfile>('all')
  const [days, setDays] = useState('all')
  const shown = PROGRAM_IDS.filter(id => (goal === 'all' || PROGRAMS[id].goals.includes(goal))
    && (days === 'all' || PROGRAMS[id].variants.some(v => String(v.days) === days)))

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={goBack}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Programs')}</h1>
      </header>

      {!suggestion.goal && (
        <Button variant="link" className="h-11 self-start px-0 text-[15px]" onClick={() => navigate('/perfil')}>{t('Set your goal in Profile')}</Button>
      )}

      <section aria-labelledby="programs-suggested" className="flex flex-col gap-2">
        <h2 id="programs-suggested" className="text-sm font-medium text-muted-foreground">{t('Suggested for you')}</h2>
        <p className="text-[15px]">{suggestionReason(suggestion.profile, suggestion.days)}</p>
        <ProgramCard id={suggestion.id} variant={suggestion.variant} highlight onOpen={() => navigate(`/plan/programas/${suggestion.id}`)} />
      </section>

      <section aria-labelledby="programs-all" className="flex flex-col gap-3">
        <h2 id="programs-all" className="text-sm font-medium text-muted-foreground">{t('All programs')}</h2>
        <ToggleGroup type="single" spacing={2} className="flex-wrap" aria-label={t('Main goal')} value={goal}
          onValueChange={v => v && setGoal(v as typeof goal)}>
          <ToggleGroupItem value="all" variant="outline" className={CHIP}>{t('All')}</ToggleGroupItem>
          {PROFILES.map(p => <ToggleGroupItem key={p} value={p} variant="outline" className={CHIP}>{PROFILE_LABEL[p]()}</ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup type="single" spacing={2} className="flex-wrap" aria-label={t('Training days per week')} value={days}
          onValueChange={v => v && setDays(v)}>
          <ToggleGroupItem value="all" variant="outline" className={CHIP}>{t('All')}</ToggleGroupItem>
          {DAY_OPTIONS.map(d => (
            <ToggleGroupItem key={d} value={String(d)} variant="outline" aria-label={t('{0} days a week', d)} className={cn(CHIP, 'min-w-11 font-mono tabular-nums')}>{d}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        {shown.length > 0 && (
          <ul className="flex list-none flex-col gap-2">{shown.map(id => (
            <li key={id}><ProgramCard id={id} variant={id === suggestion.id ? suggestion.variant : 0} onOpen={() => navigate(`/plan/programas/${id}`)} /></li>
          ))}</ul>
        )}
        {/* always mounted, so a screen reader announces the text when the filters empty the list */}
        <div role="status">
          {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t('No program matches these filters.')}</p>}
        </div>
      </section>
    </div>
  )
}

// One program: name, goals, level, days and the time of its longest session.
export function ProgramCard({ id, variant, highlight, onOpen }: { id: ProgramId; variant: number; highlight?: boolean; onOpen(): void }) {
  const program = PROGRAMS[id]
  return (
    <button type="button" data-program={id} onClick={onOpen}
      className={cn('flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left text-card-foreground outline-none transition-colors duration-150 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        highlight ? 'border-primary' : 'border-border')}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{programCopy(id).name}</span>
        <span className="block text-sm text-muted-foreground">{program.goals.map(g => PROFILE_LABEL[g]()).join(', ')} · {LEVEL_LABEL[program.level]()}</span>
        <span className="block text-sm text-muted-foreground tabular-nums">{programDays(id)} · {t('About {0} min', programMinutes(id, variant))}</span>
      </span>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground rtl:rotate-180" />
    </button>
  )
}
