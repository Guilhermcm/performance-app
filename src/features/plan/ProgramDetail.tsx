// /plan/programas/:id (spec §4.4 and §4.5): who the program is for, what to expect and why it is
// built this way (with its sources), its routines, the days choice when it has one, and "Use this
// program", which previews the change before applying it.
import { useMemo, useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { InfoSource } from '@/components/ui/info-source'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { exerciseNameFor, t } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { useStore } from '../../store/useStore.js'
import { LEVEL_LABEL } from '../profile/ProfileFields'
import { PROGRAMS, buildProgram, resolveVariant, type PlanState, type ProgramId, type Slot } from './programs'
import { estimateMinutes } from './time'
import { TimeInfo } from './TimeInfo'
import { startProgram } from './program-actions'
import { PROFILE_LABEL, pplOnceNote, programCopy, programDays, programMinutes, scheduleText } from './program-copy'
import { useSuggestion } from './ProgramsScreen'

type AppStore = { S: PlanState }

const isProgramId = (id: string | undefined): id is ProgramId => !!id && Object.hasOwn(PROGRAMS, id)
const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'
const exName = (id: string) => exerciseNameFor((EXIDX as Record<string, unknown>)[id]) || id
const dose = (slot: Slot) => (slot.repsMax != null && slot.repsMax > slot.reps
  ? t('{0} × {1} to {2}', slot.sets, slot.reps, slot.repsMax)
  : `${slot.sets} × ${slot.reps}`)

export default function ProgramDetail() {
  const { id } = useParams()
  if (!isProgramId(id)) return <Navigate to="/plan/programas" replace />
  return <Detail key={id} id={id} />
}

function Detail({ id }: { id: ProgramId }) {
  const navigate = useNavigate()
  const S = useStore((s: AppStore) => s.S)
  const suggestion = useSuggestion()
  const program = PROGRAMS[id]
  const copy = programCopy(id)
  const [variant, setVariant] = useState(() => (suggestion.id === id ? resolveVariant(id, suggestion.variant) : 0))
  const [preview, setPreview] = useState(false)
  // What applying would build for this person's equipment: an alternate where the main exercise
  // is not available, and the exercises with no usable alternate.
  const built = useMemo(() => buildProgram(S, id, variant), [S, id, variant])

  const confirm = () => {
    setPreview(false)
    startProgram(id, variant)
    navigate('/plan', { replace: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate('/plan/programas')}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{copy.name}</h1>
        <ul className="mt-3 flex list-none flex-wrap items-center gap-2">
          {[program.goals.map(g => PROFILE_LABEL[g]()).join(', '), LEVEL_LABEL[program.level](), programDays(id), t('About {0} min', programMinutes(id, variant))].map(tag => (
            <li key={tag} className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium tabular-nums">{tag}</li>
          ))}
          {/* beside the minutes, the last tag */}
          <li className="-my-2 -ms-2"><TimeInfo /></li>
        </ul>
      </header>

      <Part id="who" title={t('Who it is for')}><p>{copy.forWho}</p></Part>
      <Part id="expect" title={t('What to expect')}><p>{copy.expect}</p></Part>
      <Part id="why" title={t('Why it is built this way')} info={<InfoSource refs={program.refs} />}><p>{copy.why}</p></Part>

      {program.variants.length > 1 && (
        <section aria-labelledby="program-days" className="flex flex-col gap-2">
          <h2 id="program-days" className="text-sm font-medium text-muted-foreground">{t('Training days per week')}</h2>
          <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="program-days" value={String(variant)}
            onValueChange={v => v && setVariant(Number(v))}>
            {program.variants.map((v, i) => (
              <ToggleGroupItem key={i} value={String(i)} aria-label={t('{0} days a week', v.days)}
                className={cn('h-12 flex-1 font-mono text-base tabular-nums', ON)}>{v.days}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          {id === 'ppl' && variant === 0 && <p className="text-sm leading-snug text-muted-foreground">{pplOnceNote()}</p>}
        </section>
      )}

      {built.missing.length > 0 && (
        <div className="flex gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-[var(--orange,currentColor)]" />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">{t('Uses equipment you haven’t marked')}</p>
            <p className="text-sm text-muted-foreground">{built.missing.map(exName).join(', ')}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="program-routines" className="flex flex-col gap-3">
        <div className="flex min-h-11 items-center justify-between gap-2">
          <h2 id="program-routines" className="text-lg font-semibold tracking-tight">{t('Routines')}</h2>
          <TimeInfo />
        </div>
        {program.routines.map((r, i) => (
          <article key={r.key} aria-labelledby={`routine-${r.key}`} className="rounded-2xl border border-border bg-card px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h3 id={`routine-${r.key}`} className="text-[15px] font-semibold">{`${program.prefix} · ${r.name}`}</h3>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{t('About {0} min', estimateMinutes(built.routines[i]))}</span>
            </div>
            <ul className="mt-2 flex list-none flex-col gap-1.5">
              {r.slots.map((slot, j) => (
                <li key={j} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0">{exName(built.routines[i].ex[j].id)}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">{dose(slot)}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <Button size="lg" className="h-12 w-full rounded-xl text-base font-semibold" onClick={() => setPreview(true)}>{t('Use this program')}</Button>

      <Drawer open={preview} onOpenChange={setPreview}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{t('Use {0}?', copy.name)}</DrawerTitle>
            <DrawerDescription>
              {t('Adds {0} routines and replaces your schedule: {1}.', program.routines.length, scheduleText(id, variant))} {t('Your current routines stay in the list.')}
            </DrawerDescription>
          </DrawerHeader>
          {S.program?.id === id && (
            <p className="mx-4 rounded-xl bg-muted px-3 py-2 text-sm">{t('You already use this program.')}</p>
          )}
          <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button size="lg" className="h-12 rounded-xl text-base font-semibold" onClick={confirm}>{t('Use this program')}</Button>
            <Button size="lg" variant="ghost" className="h-12 rounded-xl text-base" onClick={() => setPreview(false)}>{t('Cancel')}</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

function Part({ id, title, info, children }: { id: string; title: string; info?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`program-${id}`} className="flex flex-col gap-1">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 id={`program-${id}`} className="text-lg font-semibold tracking-tight">{title}</h2>
        {info}
      </div>
      <div className="text-[15px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}
