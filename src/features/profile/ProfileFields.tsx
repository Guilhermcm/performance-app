import { useEffect, useState, type ReactNode } from 'react'
import { BicepsFlexed, Check, Dumbbell, Flame, HeartPulse, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { ALL_EQUIPMENT } from '../../lib/equipment.js'
import { GOALS, LEVELS, SEXES, type Goal, type Level, type ProfileInput, type Sex } from './types'

// Shared by the onboarding and the Profile screen: each block edits a slice of ProfileInput and
// reports changes as patches; errors come from validateProfileInput (English, shown through t()).
export type FieldProps = {
  value: Partial<ProfileInput>
  onChange(patch: Partial<ProfileInput>): void
  errors: Record<string, string>
}

// Labels are functions so each t() call stays a literal the source-string check can see.
export const GOAL_LABEL: Record<Goal, () => string> = {
  hypertrophy: () => t('Muscle gain'),
  strength: () => t('Strength'),
  fat_loss: () => t('Fat loss'),
  conditioning: () => t('Conditioning')
}
const GOAL_ICON: Record<Goal, LucideIcon> = { hypertrophy: BicepsFlexed, strength: Dumbbell, fat_loss: Flame, conditioning: HeartPulse }
export const LEVEL_LABEL: Record<Level, () => string> = {
  beginner: () => t('Beginner'),
  intermediate: () => t('Intermediate'),
  advanced: () => t('Advanced')
}
export const SEX_LABEL: Record<Sex, () => string> = { male: () => t('Male'), female: () => t('Female'), other: () => t('Other') }

// One look for every "selected" state: volt fill, so a choice reads at a glance in the gym.
const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'
const SEGMENT = cn('h-12 flex-1 text-[15px] transition-colors duration-150', ON)
const INPUT = 'h-12 rounded-xl bg-card px-4 text-base md:text-base dark:bg-card'

function Field({ id, label, error, optional, group, children }: {
  id: string; label: string; error?: string; optional?: boolean; group?: boolean; children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        {group
          ? <span id={id + '-label'} className="text-sm font-medium text-muted-foreground">{label}</span>
          : <Label htmlFor={id} className="text-sm font-medium text-muted-foreground">{label}</Label>}
        {optional && <span className="text-xs text-muted-foreground/80">{t('Optional')}</span>}
      </div>
      {children}
      {error && <p id={id + '-error'} className="text-sm leading-snug text-destructive">{t(error)}</p>}
    </div>
  )
}

const errorProps = (id: string, error?: string) =>
  error ? { 'aria-invalid': true, 'aria-describedby': id + '-error' } : {}

// Keeps its own text so "72." or "72," survive while typing; the number goes up on every change.
function NumberInput({ id, value, onValue, error, max }: {
  id: string; value: number | null | undefined; onValue(n: number | null): void; error?: string; max: number
}) {
  const parse = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const shown = (n: number | null | undefined) => (n == null || Number.isNaN(n) ? '' : String(n))
  const [text, setText] = useState(shown(value))
  useEffect(() => {
    // Only an outside change (a reset, a saved value) replaces what is being typed.
    setText(cur => (Object.is(parse(cur), value ?? null) ? cur : shown(value)))
  }, [value])
  return (
    <Input id={id} inputMode="decimal" autoComplete="off" enterKeyHint="next" maxLength={String(max).length + 2}
      className={cn(INPUT, 'font-mono tabular-nums')} value={text} {...errorProps(id, error)}
      onChange={e => {
        const s = e.target.value.replace(/[^\d.,]/g, '')
        setText(s)
        onValue(parse(s))
      }} />
  )
}

export function NameField({ value, onChange, errors }: FieldProps) {
  return (
    <Field id="display_name" label={t('Name')} error={errors.display_name}>
      <Input id="display_name" className={INPUT} autoComplete="name" autoCapitalize="words" enterKeyHint="next" maxLength={60}
        value={value.display_name ?? ''} {...errorProps('display_name', errors.display_name)}
        onChange={e => onChange({ display_name: e.target.value })} />
    </Field>
  )
}

export function BodyFields({ value, onChange, errors }: FieldProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <Field id="height_cm" label={t('Height (cm)')} error={errors.height_cm} optional>
          <NumberInput id="height_cm" max={260} value={value.height_cm} error={errors.height_cm} onValue={n => onChange({ height_cm: n })} />
        </Field>
        <Field id="weight_kg" label={t('Weight (kg)')} error={errors.weight_kg} optional>
          <NumberInput id="weight_kg" max={400} value={value.weight_kg} error={errors.weight_kg} onValue={n => onChange({ weight_kg: n })} />
        </Field>
      </div>
      <Field id="birth_date" label={t('Birth date')} error={errors.birth_date} optional>
        <Input id="birth_date" type="date" max={todayISO()} className={cn(INPUT, 'font-mono tabular-nums')}
          value={value.birth_date ?? ''} {...errorProps('birth_date', errors.birth_date)}
          onChange={e => onChange({ birth_date: e.target.value || null })} />
      </Field>
      <Field id="sex" label={t('Sex')} optional group>
        <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="sex-label" value={value.sex ?? ''}
          onValueChange={v => onChange({ sex: (v || null) as ProfileInput['sex'] })}>
          {SEXES.map(s => <ToggleGroupItem key={s} value={s} className={SEGMENT}>{SEX_LABEL[s]()}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
      <Field id="unit" label={t('Units')} group>
        <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="unit-label" value={value.unit ?? 'kg'}
          onValueChange={v => v && onChange({ unit: v as ProfileInput['unit'] })}>
          <ToggleGroupItem value="kg" className={cn(SEGMENT, 'font-mono')}>kg</ToggleGroupItem>
          <ToggleGroupItem value="lb" className={cn(SEGMENT, 'font-mono')}>lb</ToggleGroupItem>
        </ToggleGroup>
      </Field>
    </div>
  )
}

export function GoalFields({ value, onChange, errors }: FieldProps) {
  return (
    <div className="flex flex-col gap-7">
      <Field id="goal" label={t('Main goal')} group>
        <ToggleGroup type="single" variant="outline" spacing={2} className="grid w-full grid-cols-2" aria-labelledby="goal-label"
          value={value.goal ?? ''} onValueChange={v => v && onChange({ goal: v as ProfileInput['goal'] })}>
          {GOALS.map(g => {
            const Icon = GOAL_ICON[g]
            return (
              <ToggleGroupItem key={g} value={g}
                className={cn('h-auto min-h-24 w-full flex-col items-start justify-between gap-3 whitespace-normal rounded-2xl bg-card p-4 text-left text-[15px] font-semibold dark:bg-card', ON)}>
                <Icon aria-hidden className="size-6" />
                {GOAL_LABEL[g]()}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </Field>
      <Field id="level" label={t('Experience')} group>
        <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="level-label" value={value.level ?? ''}
          onValueChange={v => v && onChange({ level: v as ProfileInput['level'] })}>
          {LEVELS.map(l => <ToggleGroupItem key={l} value={l} className={cn(SEGMENT, 'px-1')}>{LEVEL_LABEL[l]()}</ToggleGroupItem>)}
        </ToggleGroup>
      </Field>
      <Field id="days_per_week" label={t('Training days per week')} error={errors.days_per_week} group>
        <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby="days_per_week-label" value={String(value.days_per_week ?? 3)}
          onValueChange={v => v && onChange({ days_per_week: Number(v) })}>
          {[1, 2, 3, 4, 5, 6, 7].map(d => (
            <ToggleGroupItem key={d} value={String(d)} className={cn(SEGMENT, 'min-w-11 px-0 font-mono text-base tabular-nums')}>{d}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>
    </div>
  )
}

export function EquipmentField({ value, onChange }: FieldProps) {
  const chosen = new Set(value.equipment ?? [])
  const toggle = (eq: string) => {
    const next = new Set(chosen)
    if (next.has(eq)) next.delete(eq); else next.add(eq)
    onChange({ equipment: [...next] })
  }
  return (
    <fieldset data-slot="fieldset" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <legend className="text-sm font-medium text-muted-foreground">{t('Equipment you have access to')}</legend>
        <span aria-live="polite" className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{t('Selected: {0}', chosen.size)}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {(ALL_EQUIPMENT as string[]).filter(e => e !== 'body weight').map(eq => {
          const on = chosen.has(eq)
          return (
            <button key={eq} type="button" data-slot="chip" aria-pressed={on} onClick={() => toggle(eq)}
              className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] transition-colors duration-150',
                'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-foreground hover:bg-accent')}>
              {on && <Check aria-hidden className="-ml-1 size-4" />}
              <span className="first-letter:uppercase">{t(eq)}</span>
            </button>
          )
        })}
      </div>
      <p className="text-sm leading-snug text-muted-foreground">{t('Body-weight exercises are always included.')}</p>
    </fieldset>
  )
}
