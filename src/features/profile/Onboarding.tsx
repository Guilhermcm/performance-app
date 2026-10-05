import { useEffect, useRef, useState, type FormEvent } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useStore } from '../../store/useStore.js'
import { t, getLang } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { loadStarterPlan } from '../../sheets.jsx'
import { emit } from '../gamification/events'
import { useProfile } from './useProfile'
import { validateProfileInput } from './profile-api'
import { applyProfileToState } from './profile-apply'
import { suggestStarterPlan, type StarterPlanId } from './starter-suggest'
import { NameField, BodyFields, GoalFields, EquipmentField, GOAL_LABEL, LEVEL_LABEL } from './ProfileFields'
import type { ProfileInput } from './types'

// The same names and blurbs the Plan's starter-plan chooser shows (sheets.jsx PLAN_COPY), so the
// suggestion and the plan that lands in Plan read the same.
const PLAN_COPY: Record<StarterPlanId, () => { name: string; about: string }> = {
  ppl: () => ({ name: t('Push / Pull / Legs'), about: t('Push, pull and legs each get their own day.') }),
  'upper-lower': () => ({ name: t('Upper / Lower'), about: t('Upper body twice, lower body twice.') }),
  'full-body': () => ({ name: t('Full Body'), about: t('Three sessions, the whole body each time.') }),
  '5x5': () => ({ name: t('5×5'), about: t('Five sets of five on the main barbell lifts.') })
}

// Fields each step validates before moving on; the rest are checked where they are edited.
const STEP_FIELDS: (keyof ProfileInput)[][] = [
  ['display_name', 'birth_date', 'height_cm', 'weight_kg'],
  ['days_per_week'],
  []
]

const EASE_OUT = [0.22, 1, 0.36, 1] as const
const CTA = 'h-14 w-full rounded-2xl text-base font-semibold active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100'

type AppUser = { id: string; name?: string } | null

export default function Onboarding() {
  const reduce = useReducedMotion()
  const user = useStore((s: { user: AppUser }) => s.user)
  const create = useProfile(s => s.create)
  const suggestion = useProfile(s => s.suggestion)
  const setSuggestion = useProfile(s => s.setSuggestion)
  const finishOnboarding = useProfile(s => s.finishOnboarding)
  const profile = useProfile(s => s.profile)
  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [value, setValue] = useState<Partial<ProfileInput>>(() => ({
    display_name: user?.name ?? '', unit: 'kg', locale: getLang() === 'en' ? 'en' : 'pt-BR', days_per_week: 3, equipment: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo'
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const moved = useRef(false)

  // A new step is announced by moving focus to its title — but not on first paint.
  useEffect(() => {
    if (moved.current) heading.current?.focus({ preventScroll: true })
    moved.current = true
    window.scrollTo?.(0, 0)
  }, [step])

  // Leaving the suggestion screen ends the onboarding; ProfileGate then shows the app on Home.
  const leave = (plan: StarterPlanId | null) => {
    if (plan) loadStarterPlan(plan)
    window.location.hash = '#/home'
    finishOnboarding()
  }

  const onChange = (patch: Partial<ProfileInput>) => {
    setValue(v => ({ ...v, ...patch }))
    // A field fixed by the user stops showing its old complaint right away.
    setErrors(e => {
      const keys = Object.keys(patch).filter(k => k in e)
      if (!keys.length) return e
      const next = { ...e }
      keys.forEach(k => delete next[k])
      return next
    })
  }

  const go = (to: number) => {
    setDir(to > step ? 1 : -1)
    setStep(to)
  }

  const advance = () => {
    const all = validateProfileInput(value)
    const e = Object.fromEntries(Object.entries(all).filter(([k]) => STEP_FIELDS[step].includes(k as keyof ProfileInput)))
    setErrors(e)
    const first = Object.keys(e)[0]
    if (first) { document.getElementById(first)?.focus(); return }
    go(step + 1)
  }

  const finish = async () => {
    setSaving(true)
    setSaveError(false)
    try {
      const created = await create({ ...value, display_name: (value.display_name ?? '').trim() })
      const today = todayISO()
      useStore.getState().update((s: Record<string, unknown>) => {
        Object.assign(s, applyProfileToState(s, created, { today, withWeight: !!created.weight_kg }))
      })
      if (created.weight_kg) emit('weight_logged', { w: created.weight_kg }, today, today)
      setSuggestion(suggestStarterPlan({ days: created.days_per_week, level: created.level, goal: created.goal }))
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const steps = [
    {
      title: t('About you'),
      lead: t('The basics, so your loads and progress make sense.'),
      body: <div className="flex flex-col gap-5"><NameField value={value} onChange={onChange} errors={errors} /><BodyFields value={value} onChange={onChange} errors={errors} /></div>
    },
    { title: t('Your goal'), lead: t('This shapes the plan we suggest at the end.'), body: <GoalFields value={value} onChange={onChange} errors={errors} /> },
    { title: t('Your equipment'), lead: t('Exercises are filtered to what you can use. You can change it later.'), body: <EquipmentField value={value} onChange={onChange} errors={errors} /> }
  ]
  const last = step === steps.length - 1

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    if (last) void finish(); else advance()
  }

  if (suggestion) {
    const plan = PLAN_COPY[suggestion]()
    const enter = (delay: number) => ({
      initial: reduce ? { opacity: 0 } : { opacity: 0, y: 16 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: reduce ? 0.15 : 0.3, ease: EASE_OUT, delay: reduce ? 0 : delay }
    })
    const tags = [
      profile?.days_per_week ? t('{0} days a week', profile.days_per_week) : null,
      profile?.goal ? GOAL_LABEL[profile.goal]() : null,
      profile?.level ? LEVEL_LABEL[profile.level]() : null
    ].filter(Boolean) as string[]
    return (
      <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background font-sans text-foreground">
        <div aria-hidden className="pointer-events-none absolute -top-48 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-between gap-10 px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(4rem+env(safe-area-inset-top))]">
          <motion.section {...enter(0)} className="flex flex-col gap-6">
            <p className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-primary">{t('Your starting point')}</p>
            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
              <h1 className="text-4xl font-semibold leading-tight tracking-tight text-balance">{plan.name}</h1>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground text-pretty">{plan.about}</p>
              {tags.length > 0 && (
                <ul className="mt-5 flex list-none flex-wrap gap-2">
                  {tags.map(tag => (
                    <li key={tag} className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium tabular-nums text-foreground">{tag}</li>
                  ))}
                </ul>
              )}
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
              {t('Based on your goal, experience and available days. You can change it any time in Plan.')}
            </p>
          </motion.section>
          <motion.div {...enter(0.08)} className="flex flex-col gap-2">
            <Button size="lg" className={CTA} onClick={() => leave(suggestion)}>{t('Use this plan')}</Button>
            <Button size="lg" variant="ghost" className="h-12 w-full rounded-2xl text-base text-muted-foreground" onClick={() => leave(null)}>
              {t('Skip for now')}
            </Button>
          </motion.div>
        </div>
      </main>
    )
  }

  const progressLabel = t('Step {0} of {1}', step + 1, steps.length)

  return (
    <main className="min-h-dvh bg-background font-sans text-foreground">
      <form noValidate onSubmit={submit} className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 bg-background/90 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur-md">
          <Button type="button" variant="ghost" size="icon" aria-label={t('Back')}
            className={step === 0 ? 'invisible size-11 rounded-full' : 'size-11 rounded-full'}
            disabled={step === 0 || saving} onClick={() => go(step - 1)}>
            <ArrowLeft className="size-5" />
          </Button>
          <Progress value={((step + 1) / steps.length) * 100} aria-label={progressLabel}
            className="h-1.5 flex-1 bg-muted [&>[data-slot=progress-indicator]]:duration-300 [&>[data-slot=progress-indicator]]:ease-out" />
          <span aria-hidden className="w-11 pr-2 text-right font-mono text-sm tabular-nums text-muted-foreground">{step + 1}/{steps.length}</span>
        </header>

        <motion.section key={step} aria-labelledby="onboarding-title" className="flex-1 px-6 pb-6 pt-4"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 * dir }} animate={{ opacity: 1, x: 0 }}
          transition={{ duration: reduce ? 0.15 : 0.22, ease: EASE_OUT }}>
          <h1 id="onboarding-title" ref={heading} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none text-balance">
            {steps[step].title}
          </h1>
          <p className="mt-2 mb-7 text-base leading-relaxed text-muted-foreground text-pretty">{steps[step].lead}</p>
          {steps[step].body}
        </motion.section>

        <footer className="sticky bottom-0 flex flex-col gap-3 bg-gradient-to-t from-background from-70% to-transparent px-6 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-6">
          {saveError && (
            <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm leading-snug text-destructive shadow-sm">
              {t('Could not save your profile. Try again.')}
            </p>
          )}
          <Button type="submit" size="lg" className={CTA} disabled={saving} aria-busy={saving}>
            {saving && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}
            {last ? (saving ? t('Saving…') : t('Finish')) : t('Continue')}
          </Button>
        </footer>
      </form>
    </main>
  )
}
