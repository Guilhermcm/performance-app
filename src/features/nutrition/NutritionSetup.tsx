import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { validateProfileInput } from '../profile/profile-api'
import { GOAL_LABEL, SEX_LABEL } from '../profile/ProfileFields'
import { GOALS, SEXES, type Goal, type Profile, type ProfileInput } from '../profile/types'
import { ADJUST, LIMITS, computeTarget, fitCarbs, macroGap } from './targets'
import { ACTIVITY_LABEL, fmtGrams, fmtKcal } from './labels'
import { shiftDay, todayIn } from './days'
import { useNutrition } from './useNutrition'
import { LB_TO_KG } from './weigh-in'
import { Field, parseAmount } from './form'
import type { ActivityLevel, Macros, NutritionTarget, Pace } from './types'

type Step = 'profile' | 'activity' | 'target'
type MacroKey = keyof Macros
type Manual = Record<MacroKey, string>

// What the target needs from the profile, besides the activity level asked here.
const BODY = ['birth_date', 'sex', 'height_cm', 'weight_kg', 'goal'] as const
const LEVELS: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active']
const PACES: readonly Pace[] = ['gentle', 'standard']
const DAYS = [3, 4, 5, 6, 7]
const MACROS: readonly MacroKey[] = ['kcal', 'protein_g', 'carbs_g', 'fat_g']

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'
const SEGMENT = cn('h-12 flex-1 text-[15px] transition-colors duration-150', ON)

// "+10% for muscle gain": each a literal for the source-string check.
const FOR_GOAL: Record<Goal, (pct: string) => string> = {
  hypertrophy: p => t('{0} for muscle gain', p),
  strength: p => t('{0} for strength', p),
  fat_loss: p => t('{0} for fat loss', p),
  conditioning: p => t('{0} for conditioning', p)
}
const PACE_LABEL: Record<Pace, () => string> = { gentle: () => t('Gentle'), standard: () => t('Standard') }
const FIELD_LABEL: Record<MacroKey, () => string> = {
  kcal: () => t('Calories (kcal)'), protein_g: () => t('Protein (g)'), carbs_g: () => t('Carbs (g)'), fat_g: () => t('Fat (g)')
}

// A signed percentage with a real minus sign: "+10%", "−20%".
const signed = (pct: number) => (pct > 0 ? '+' : pct < 0 ? '−' : '') + Math.abs(pct) + '%'
const textOf = (m: Macros): Manual => ({ kcal: String(m.kcal), protein_g: String(m.protein_g), carbs_g: String(m.carbs_g), fat_g: String(m.fat_g) })
const sameTarget = (a: NutritionTarget | null, b: Macros & { mode: NutritionTarget['mode'] }) =>
  !!a && a.mode === b.mode && MACROS.every(k => a[k] === b[k])

type Props = { open: boolean; onOpenChange: (open: boolean) => void }

// Turning the nutrition pillar on (spec 3.1) and editing its target later: the profile data that
// is missing, the activity level and pace, then the target with its sum in one line, a manual
// override and the days on target per week. The first target starts today, an edit tomorrow.
export default function NutritionSetup({ open, onOpenChange }: Props) {
  const profile = useProfile(s => s.profile)
  // A fresh form each time the sheet opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  if (!profile) return null
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <SetupBody key={session} profile={profile} onDone={() => onOpenChange(false)} />
      </DrawerContent>
    </Drawer>
  )
}

function SetupBody({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const save = useProfile(s => s.save)
  // Fixed when the sheet opens: a retry after a failed first target still writes it for today,
  // though the profile already says the pillar is on.
  const [activating] = useState(() => !profile.nutrition_enabled)
  const [missing] = useState(() => BODY.filter(k => profile[k] == null))
  const steps: Step[] = missing.length ? ['profile', 'activity', 'target'] : ['activity', 'target']
  const [step, setStep] = useState<Step>(steps[0])
  const today = todayIn(profile.timezone)
  const tomorrow = shiftDay(today, 1)
  // Any target row at all, in force or not: only the very first one may start today (RLS, 0009).
  const hasTarget = useNutrition(s => s.targets.length > 0)
  // "No target yet" only means that once the targets have loaded; before that the first one could
  // be written for today when a target is already there. The last step waits for them.
  const loaded = useNutrition(s => s.status === 'ready')
  useEffect(() => {
    // A failed first load is tried again when the sheet opens, instead of leaving the button stuck.
    if (useNutrition.getState().status === 'error') void useNutrition.getState().refresh()
  }, [])
  const ahead = useNutrition(s => s.targetOn(tomorrow))

  const [patch, setPatch] = useState<Partial<ProfileInput>>({})
  const [activity, setActivity] = useState<ActivityLevel | null>(profile.activity_level)
  const [pace, setPace] = useState<Pace>(profile.nutrition_pace ?? 'standard')
  const [days, setDays] = useState<number>(profile.nutrition_days_per_week ?? 5)
  const [manual, setManual] = useState<Manual | null>(() => (!activating && ahead?.mode === 'manual' ? textOf(ahead) : null))
  const [busy, setBusy] = useState(false)

  const body = { ...profile, ...patch }
  const profileErrors = validateProfileInput(patch)
  const profileDone = missing.every(k => body[k] != null) && !Object.keys(profileErrors).length
  const goal = body.goal
  const asksPace = goal === 'fat_loss' || goal === 'hypertrophy'

  const calc = step === 'target' && activity && goal && body.birth_date && body.sex && body.height_cm && body.weight_kg
    ? computeTarget({
        birth_date: body.birth_date, sex: body.sex, height_cm: body.height_cm, weight_kg: body.weight_kg,
        goal, activity_level: activity, pace
      }, today)
    : null

  // The manual values, each checked against the limits the database takes.
  const parsed = manual ? MACROS.map(k => {
    const v = parseAmount(manual[k])
    const [lo, hi] = LIMITS[k]
    const ok = v != null && Number.isFinite(v) && v >= lo && v <= hi
    return { k, v: ok ? Math.round(v!) : null, error: v == null || ok ? null : t('Between {0} and {1}.', lo, hi) }
  }) : null
  const manualMacros = parsed && parsed.every(p => p.v != null)
    ? Object.fromEntries(parsed.map(p => [p.k, p.v])) as Macros
    : null
  const gap = manualMacros ? macroGap(manualMacros) : 0
  const target = manual
    ? (manualMacros ? { ...manualMacros, mode: 'manual' as const } : null)
    : calc ? { kcal: calc.kcal, protein_g: calc.protein_g, carbs_g: calc.carbs_g, fat_g: calc.fat_g, mode: 'auto' as const } : null

  const at = steps.indexOf(step)
  const last = at === steps.length - 1
  const canGo = step === 'profile' ? profileDone : step === 'activity' ? !!activity : !!target && !busy && loaded

  const finish = async () => {
    if (!target || !activity || !loaded) return
    setBusy(true)
    try {
      await save({
        ...patch, activity_level: activity, nutrition_pace: pace, nutrition_days_per_week: days,
        ...(activating ? { nutrition_enabled: true } : {})
      })
    } catch {
      toast(t('Could not save. Your previous values were kept.'))
      setBusy(false)
      return
    }
    // The first target ever (or one that never got saved) starts today; every later one tomorrow,
    // also when the pillar is turned back on. A target that is already the one in force writes nothing.
    const from = hasTarget ? tomorrow : today
    const changed = from === today || !sameTarget(ahead, target)
    try {
      if (changed) await useNutrition.getState().setTarget(target, from)
      toast(activating && from === today ? t('Nutrition is on. Your target starts today.') : changed && from === tomorrow ? t('New target saved. It starts tomorrow.') : t('Saved'))
      onDone()
    } catch {
      toast(t('Could not save the target. Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    if (!canGo) return
    if (last) void finish()
    else setStep(steps[at + 1])
  }

  const description = step === 'profile' ? t('A few details first. Your target is based on them.')
    : step === 'activity' ? t('How active is your day outside training?')
    : t('Calculated from your profile. You can adjust it.')

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl">{activating ? t('Turn on Nutrition') : t('Your nutrition target')}</DrawerTitle>
        <DrawerDescription>{description}</DrawerDescription>
      </DrawerHeader>

      <form id="nutrition-setup" className="flex flex-col gap-6 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); next() }}>
        {step === 'profile' && (
          <ProfileStep missing={missing} profile={profile} patch={patch} errors={profileErrors}
            onChange={p => setPatch(cur => ({ ...cur, ...p }))} />
        )}

        {step === 'activity' && (
          <>
            <Group id="activity" label={t('Activity outside training')}>
              <ToggleGroup type="single" variant="outline" spacing={2} className="flex w-full flex-col" aria-labelledby="activity-label"
                value={activity ?? ''} onValueChange={v => v && setActivity(v as ActivityLevel)}>
                {LEVELS.map(l => (
                  <ToggleGroupItem key={l} value={l}
                    className={cn('h-auto min-h-14 w-full flex-col items-start justify-center gap-0.5 whitespace-normal rounded-xl px-4 py-2.5 text-left', ON)}>
                    <span className="text-[15px] font-semibold">{ACTIVITY_LABEL[l].name()}</span>
                    <span className="text-sm font-normal leading-snug opacity-80">{ACTIVITY_LABEL[l].detail()}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Group>
            {asksPace && goal && (
              <Group id="pace" label={t('Pace')}>
                <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="pace-label"
                  value={pace} onValueChange={v => v && setPace(v as Pace)}>
                  {PACES.map(p => (
                    <ToggleGroupItem key={p} value={p} className={cn(SEGMENT, 'gap-2')}>
                      {PACE_LABEL[p]()}<span className="font-mono text-sm tabular-nums opacity-80">{signed(Math.round(ADJUST[goal][p] * 100))}</span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Group>
            )}
          </>
        )}

        {step === 'target' && calc && (
          <>
            <p className="text-sm leading-snug text-muted-foreground">
              {(() => {
                const pct = Math.round((calc.adjust / calc.tdee) * 100)
                return pct === 0 ? t('Estimated burn {0}', fmtKcal(calc.tdee)) : t('Estimated burn {0}, {1}', fmtKcal(calc.tdee), FOR_GOAL[goal!](signed(pct)))
              })()}
            </p>

            {manual && parsed ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  {parsed.map(p => (
                    <Field key={p.k} id={'target-' + p.k} label={FIELD_LABEL[p.k]()} value={manual[p.k]} error={p.error} numeric
                      onChange={v => setManual(m => (m ? { ...m, [p.k]: v } : m))} />
                  ))}
                </div>
                {manualMacros && gap > 0.05 && (
                  <div role="status" className="flex flex-col items-start gap-2 rounded-2xl bg-secondary/70 p-3 text-sm leading-snug">
                    <p>{t('Protein, carbs and fat add up to {0}, more than 5% off the calories.', fmtKcal(4 * manualMacros.protein_g + 4 * manualMacros.carbs_g + 9 * manualMacros.fat_g))}</p>
                    <Button type="button" variant="outline" className="h-11 rounded-xl"
                      onClick={() => setManual(textOf(fitCarbs(manualMacros)))}>{t('Adjust carbs')}</Button>
                  </div>
                )}
                <Button type="button" variant="ghost" className="h-11 self-start rounded-xl px-3" onClick={() => setManual(null)}>
                  {t('Use the calculated target')}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3 rounded-2xl bg-card p-4">
                <p className="font-mono text-3xl font-semibold tabular-nums">{fmtKcal(calc.kcal)}</p>
                <dl className="grid grid-cols-3 gap-2">
                  {([[t('Protein'), calc.protein_g], [t('Carbs'), calc.carbs_g], [t('Fat'), calc.fat_g]] as const).map(([label, g]) => (
                    <div key={label} className="flex flex-col">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-mono text-base tabular-nums">{fmtGrams(g)}</dd>
                    </div>
                  ))}
                </dl>
                <Button type="button" variant="outline" className="h-11 self-start rounded-xl" onClick={() => setManual(textOf(calc))}>
                  {t('Adjust manually')}
                </Button>
              </div>
            )}

            <Group id="days" label={t('Days on target per week')}>
              <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="days-label"
                value={String(days)} onValueChange={v => v && setDays(Number(v))}>
                {DAYS.map(d => (
                  <ToggleGroupItem key={d} value={String(d)} className={cn(SEGMENT, 'min-w-11 px-0 font-mono text-base tabular-nums')}>{d}</ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-sm leading-snug text-muted-foreground">{t('Reach it on this many days to meet the weekly goal.')}</p>
            </Group>
          </>
        )}
      </form>

      <DrawerFooter className="flex-row gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {at > 0 && (
          <Button type="button" variant="ghost" className="h-12 rounded-xl px-5 text-[15px]" disabled={busy} onClick={() => setStep(steps[at - 1])}>
            {t('Back')}
          </Button>
        )}
        <Button type="submit" form="nutrition-setup" className="h-12 flex-1 rounded-xl text-[15px] font-semibold" disabled={!canGo}>
          {busy ? t('Saving…') : !last ? t('Next') : !loaded ? t('Loading your targets') : activating ? t('Turn on Nutrition') : t('Save')}
        </Button>
      </DrawerFooter>
    </>
  )
}

// A labelled group of choices; the label names the toggle group for screen readers.
function Group({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span id={id + '-label'} className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

type ProfileStepProps = {
  missing: readonly (typeof BODY)[number][]
  profile: Profile
  patch: Partial<ProfileInput>
  errors: Record<string, string>
  onChange: (p: Partial<ProfileInput>) => void
}

// Only the fields the profile lacks. Weight follows the profile's unit and is kept in kg.
function ProfileStep({ missing, profile, patch, errors, onChange }: ProfileStepProps) {
  const lb = profile.unit === 'lb'
  const [height, setHeight] = useState('')
  const [weight, setWeight] = useState('')
  const has = (k: (typeof BODY)[number]) => missing.includes(k)
  const num = (s: string) => {
    const v = parseAmount(s)
    return v == null ? null : v
  }
  const err = (k: string) => (errors[k] ? t(errors[k]) : null)

  return (
    <>
      {has('goal') && (
        <Group id="setup-goal" label={t('Main goal')}>
          <ToggleGroup type="single" variant="outline" spacing={2} className="grid w-full grid-cols-2" aria-labelledby="setup-goal-label"
            value={patch.goal ?? ''} onValueChange={v => v && onChange({ goal: v as Goal })}>
            {GOALS.map(g => (
              <ToggleGroupItem key={g} value={g} className={cn('h-12 w-full rounded-xl text-[15px]', ON)}>{GOAL_LABEL[g]()}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Group>
      )}
      {(has('height_cm') || has('weight_kg')) && (
        <div className="grid grid-cols-2 gap-3">
          {has('height_cm') && (
            <Field id="setup-height" label={t('Height (cm)')} value={height} numeric error={err('height_cm')}
              onChange={v => { setHeight(v); onChange({ height_cm: num(v) }) }} />
          )}
          {has('weight_kg') && (
            <Field id="setup-weight" label={lb ? t('Weight (lb)') : t('Weight (kg)')} value={weight} numeric error={err('weight_kg')}
              onChange={v => {
                setWeight(v)
                const n = num(v)
                onChange({ weight_kg: n == null || Number.isNaN(n) ? n : Math.round((lb ? n * LB_TO_KG : n) * 10) / 10 })
              }} />
          )}
        </div>
      )}
      {has('birth_date') && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="setup-birth" className="text-sm text-muted-foreground">{t('Birth date')}</Label>
          <Input id="setup-birth" type="date" max={todayIn(profile.timezone)} className="h-12 font-mono text-[15px] tabular-nums"
            value={patch.birth_date ?? ''} aria-invalid={errors.birth_date ? true : undefined}
            onChange={e => onChange({ birth_date: e.target.value || null })} />
          {errors.birth_date && <p className="text-xs leading-snug text-destructive">{t(errors.birth_date)}</p>}
        </div>
      )}
      {has('sex') && (
        <Group id="setup-sex" label={t('Sex')}>
          <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="setup-sex-label"
            value={patch.sex ?? ''} onValueChange={v => v && onChange({ sex: v as ProfileInput['sex'] })}>
            {SEXES.map(s => <ToggleGroupItem key={s} value={s} className={SEGMENT}>{SEX_LABEL[s]()}</ToggleGroupItem>)}
          </ToggleGroup>
        </Group>
      )}
    </>
  )
}
