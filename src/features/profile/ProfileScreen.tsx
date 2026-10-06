import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CodeXml, LogOut, Pencil, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useStore } from '../../store/useStore.js'
import { t, dateLocale } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { menuSheet } from '../../sheets.jsx'
import ProfileProgress from '../gamification/ProfileProgress'
import NutritionSetup from '../nutrition/NutritionSetup'
import { useNutrition } from '../nutrition/useNutrition'
import { todayIn } from '../nutrition/days'
import { ACTIVITY_LABEL, fmtGrams, fmtKcal } from '../nutrition/labels'
import DeleteAccount from './DeleteAccount'
import { useProfile } from './useProfile'
import { validateProfileInput } from './profile-api'
import { applyProfileToState } from './profile-apply'
import { NameField, BodyFields, GoalFields, EquipmentField, GOAL_LABEL, LEVEL_LABEL, SEX_LABEL, type FieldProps } from './ProfileFields'
import type { Profile, ProfileInput, Unit } from './types'

export const SOURCE_URL = 'https://github.com/Guilhermcm/performance-app'

type SectionKey = 'body' | 'goal' | 'equipment'
type SignOutResult = { owed: boolean; count?: number | null; stashed?: boolean }
type AppStore = {
  S: Record<string, any>
  signOut(o?: { force?: boolean }): Promise<SignOutResult>
  setUnit(to: Unit, o: { convert: boolean }): unknown
  update(fn: (s: Record<string, any>) => void): void
}

// Titles are functions so each t() call stays a literal the source-string check can see.
const SECTIONS: { key: SectionKey; title: () => string; fields: (keyof ProfileInput)[]; render: (p: FieldProps) => ReactNode }[] = [
  { key: 'body', title: () => t('About you'), fields: ['display_name', 'birth_date', 'sex', 'height_cm', 'weight_kg', 'unit'],
    render: p => <div className="flex flex-col gap-5"><NameField {...p} /><BodyFields {...p} /></div> },
  { key: 'goal', title: () => t('Your goal'), fields: ['goal', 'level', 'days_per_week'], render: p => <GoalFields {...p} /> },
  { key: 'equipment', title: () => t('Your equipment'), fields: ['equipment'], render: p => <EquipmentField {...p} /> }
]

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
const ENTER = 'animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none'

export default function ProfileScreen() {
  const navigate = useNavigate()
  const profile = useProfile(s => s.profile)
  const save = useProfile(s => s.save)
  const signOut = useStore((s: AppStore) => s.signOut)
  const [editing, setEditing] = useState<SectionKey | null>(null)
  const [draft, setDraft] = useState<Partial<ProfileInput>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  // The feed sends people here to check their sharing: bring the switch into view and focus it.
  const focus = (useLocation().state as { focus?: string } | null)?.focus
  const ready = !!profile
  useEffect(() => {
    if (!ready || focus !== 'share_activity') return
    const el = document.getElementById('share_activity')
    el?.scrollIntoView({ block: 'center' })
    el?.focus({ preventScroll: true })
  }, [ready, focus])

  if (!profile) return null

  const startEdit = (key: SectionKey) => {
    const fields = SECTIONS.find(s => s.key === key)!.fields
    setDraft(Object.fromEntries(fields.map(f => [f, profile[f]])) as Partial<ProfileInput>)
    setErrors({})
    setEditing(key)
  }

  const onChange = (patch: Partial<ProfileInput>) => {
    setDraft(d => ({ ...d, ...patch }))
    // A field fixed by the user stops showing its old complaint right away.
    setErrors(e => {
      const keys = Object.keys(patch).filter(k => k in e)
      if (!keys.length) return e
      const next = { ...e }
      keys.forEach(k => delete next[k])
      return next
    })
  }

  // `convert` is the answer to the unit question (null when the unit did not change for the app).
  const persist = async (section: SectionKey, patch: Partial<ProfileInput>, convert: boolean | null) => {
    setBusy(true)
    try {
      const saved = await save(patch)
      const store = useStore.getState() as AppStore
      if (convert !== null) store.setUnit(saved.unit, { convert })
      // Only the equipment filter follows the profile here: the language and week start applied at
      // the onboarding may have been changed in Settings since, and must stay as they are.
      if (section === 'equipment') {
        store.update(s => {
          const next = applyProfileToState(s, saved, { today: todayISO(), withWeight: false })
          s.equipProfiles = next.equipProfiles
          s.activeEquipId = next.activeEquipId
          s.equipFilterOn = next.equipFilterOn
        })
      }
      setEditing(null)
      toast(t('Profile saved'))
    } catch {
      toast(t('Could not save. Your previous values were kept.'))
    } finally {
      setBusy(false)
    }
  }

  const commit = () => {
    if (!editing) return
    const e = validateProfileInput(draft)
    setErrors(e)
    if (Object.keys(e).length) return
    const section = editing
    const patch = { ...draft }
    // The app's weights are in the app's unit (Settings may have switched it without the profile):
    // a different one asks the same question Settings asks — convert the numbers, or relabel.
    const appUnit = ((useStore.getState() as AppStore).S?.unit || 'kg') as Unit
    if (section === 'body' && patch.unit && patch.unit !== appUnit) {
      menuSheet({
        title: t('Convert to {0}?', patch.unit),
        subtitle: t('Every stored weight — logged sets, working weights, routine targets, body weight, bar weights — is in {0}. Convert the numbers, or keep them and only change the label?', appUnit),
        items: [
          { icon: 'shuffle', label: t('Convert the numbers'), onClick: () => persist(section, patch, true) },
          { icon: 'pencil', label: t('Keep the numbers, change the label'), onClick: () => persist(section, patch, false) }
        ]
      })
      return
    }
    persist(section, patch, null)
  }

  // Turning the pillar on goes through the setup (target first); turning it off is one tap.
  const toggleNutrition = async (on: boolean) => {
    if (on) { setSetupOpen(true); return }
    try { await save({ nutrition_enabled: false }) } catch { toast(t('Could not save. Your previous values were kept.')) }
  }

  const toggleShare = async (on: boolean) => {
    try { await save({ share_activity: on }) } catch { toast(t('Could not save. Your previous values were kept.')) }
  }

  const leave = async (force = false) => {
    setLeaving(true)
    try {
      const r = await signOut(force ? { force: true } : undefined)
      if (!r.owed || r.stashed) return
      if (r.stashed === false) { toast(t('Could not keep a copy of the changes on this device — nothing was removed.')); return }
      menuSheet({
        title: t('Not everything is on your server yet'),
        subtitle: t('Try again, or export a backup first. Going ahead anyway keeps a copy of these changes on this device until it connects to this server as this account again — then they are added back.'),
        items: [
          { icon: 'reset', label: t('Try again'), onClick: () => leave() },
          { icon: 'signOut', label: t('Sign out anyway'), danger: true, onClick: () => leave(true) },
          { icon: 'xmark', label: t('Cancel'), onClick: () => {} }
        ]
      })
    } finally {
      setLeaving(false)
    }
  }

  const tagline = [profile.goal && GOAL_LABEL[profile.goal](), profile.level && LEVEL_LABEL[profile.level]()].filter(Boolean).join(' · ')

  return (
    <div className="mx-auto flex w-full max-w-md flex-col font-sans text-foreground">
      <header className="-ml-2 flex h-11 items-center">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
      </header>

      <section className="mt-1 flex flex-col items-center gap-3 text-center">
        <Avatar className="size-24 ring-2 ring-primary/50 ring-offset-4 ring-offset-background">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-secondary text-3xl font-semibold text-secondary-foreground">{initials(profile.display_name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 max-w-full flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">{profile.display_name}</h1>
          {tagline && <p className="text-sm text-muted-foreground">{tagline}</p>}
        </div>
      </section>

      <div className="mt-8 flex flex-col gap-3">
        <ProfileProgress />
        {SECTIONS.map(section => {
          const open = editing === section.key
          const title = section.title()
          return (
            <section key={section.key} data-slot="card" aria-labelledby={'sec-' + section.key}
              className={cn('rounded-2xl border bg-card px-5 pb-5 pt-3 transition-colors duration-200', open ? 'border-primary/40' : 'border-border')}>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <h2 id={'sec-' + section.key} className="text-[15px] font-semibold">{title}</h2>
                {!open && (
                  <Button variant="ghost" className="-mr-3 h-11 gap-2 rounded-full px-3 text-muted-foreground hover:text-foreground"
                    aria-label={t('Edit') + ': ' + title} disabled={editing !== null && busy} onClick={() => startEdit(section.key)}>
                    <Pencil className="size-4" />{t('Edit')}
                  </Button>
                )}
              </div>
              {open ? (
                <div className={cn('mt-3 flex flex-col gap-6', ENTER)}>
                  {section.render({ value: draft, onChange, errors })}
                  <div className="flex gap-2">
                    <Button className="h-12 flex-1 rounded-xl text-base font-semibold" disabled={busy} onClick={commit}>
                      {busy ? t('Saving…') : t('Save')}
                    </Button>
                    <Button variant="ghost" className="h-12 rounded-xl px-5 text-base" disabled={busy} onClick={() => setEditing(null)}>{t('Cancel')}</Button>
                  </div>
                </div>
              ) : (
                <Summary section={section.key} profile={profile} />
              )}
            </section>
          )
        })}

        <NutritionCard profile={profile} onToggle={toggleNutrition} onEdit={() => setSetupOpen(true)} />
        <NutritionSetup open={setupOpen} onOpenChange={setSetupOpen} />

        <section data-slot="card" className="flex items-center gap-4 rounded-2xl border border-border bg-card py-2 pl-5 pr-4">
          <label htmlFor="share_activity" className="flex min-h-14 flex-1 cursor-pointer flex-col justify-center gap-0.5 py-2 text-left">
            <span className="text-[15px] font-semibold leading-snug">{t('Share workouts and PRs with friends')}</span>
            <span className="text-sm leading-snug text-muted-foreground">{t('Weight, diet and loads stay private.')}</span>
          </label>
          <Switch id="share_activity" className="relative after:absolute after:-inset-3" checked={profile.share_activity} onCheckedChange={toggleShare} />
        </section>

        <Button variant="outline" className="mt-3 h-12 gap-2 rounded-xl text-base" disabled={leaving} onClick={() => leave()}>
          <LogOut className="size-4" />{t('Sign out')}
        </Button>
        <DeleteAccount />
        <a className="mx-auto inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href={SOURCE_URL} target="_blank" rel="noreferrer">
          <CodeXml aria-hidden className="size-4" />{t('Source code (AGPL-3.0)')}
        </a>
        {/* A plain link, not a route: the policy is a static page outside the hash router. */}
        <a className="mx-auto -mt-3 inline-flex min-h-11 items-center gap-2 px-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          href="/privacidade">
          <ShieldCheck aria-hidden className="size-4" />{t('Privacy policy')}
        </a>
      </div>
    </div>
  )
}

// "81,5 kg" in Portuguese, "81.5 kg" in English: the number in the app language's own format.
const num = (n: number | null, unit: string) => (n == null ? null : Number(n).toLocaleString(dateLocale(), { maximumFractionDigits: 1 }) + ' ' + unit)

function Summary({ section, profile }: { section: SectionKey; profile: Profile }) {
  const row = (label: string, value: ReactNode) => (
    <div key={label} className="flex min-h-11 items-center justify-between gap-4 py-2 text-[15px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value ?? '—'}</dd>
    </div>
  )
  const list = (rows: ReactNode[]) => <dl className="divide-y divide-border">{rows}</dl>
  if (section === 'body') {
    const born = profile.birth_date
      ? new Date(profile.birth_date + 'T00:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
      : null
    return list([
      row(t('Height (cm)'), num(profile.height_cm, 'cm')),
      row(t('Weight (kg)'), num(profile.weight_kg, 'kg')),
      row(t('Birth date'), born),
      row(t('Sex'), profile.sex && SEX_LABEL[profile.sex]()),
      row(t('Units'), <span className="font-mono">{profile.unit}</span>)
    ])
  }
  if (section === 'goal') {
    return list([
      row(t('Main goal'), profile.goal && GOAL_LABEL[profile.goal]()),
      row(t('Experience'), profile.level && LEVEL_LABEL[profile.level]()),
      row(t('Training days per week'), profile.days_per_week)
    ])
  }
  if (!profile.equipment.length) return <p className="py-2 text-[15px] leading-snug text-muted-foreground">{t('Nothing selected — every exercise is shown.')}</p>
  return (
    <ul data-slot="chips" className="m-0 flex list-none flex-wrap gap-2 p-0 pt-1">
      {profile.equipment.map(e => (
        <li key={e} className="rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground first-letter:uppercase">{t(e)}</li>
      ))}
    </ul>
  )
}

// Perfil > Nutrição: the pillar's switch and, once on, the target in force, the activity level and
// the days on target per week, edited through the same setup sheet.
function NutritionCard({ profile, onToggle, onEdit }: { profile: Profile; onToggle: (on: boolean) => void; onEdit: () => void }) {
  const target = useNutrition(s => s.targetOn(todayIn(profile.timezone)))
  const on = profile.nutrition_enabled
  const title = t('Nutrition')
  const row = (label: string, value: ReactNode) => (
    <div key={label} className="flex min-h-11 items-center justify-between gap-4 py-2 text-[15px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value ?? '—'}</dd>
    </div>
  )
  return (
    <section data-slot="card" aria-labelledby="sec-nutrition" className="rounded-2xl border border-border bg-card px-5 pb-4 pt-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id="sec-nutrition" className="text-[15px] font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          {on && (
            <Button variant="ghost" className="h-11 gap-2 rounded-full px-3 text-muted-foreground hover:text-foreground"
              aria-label={t('Edit') + ': ' + title} onClick={onEdit}>
              <Pencil className="size-4" />{t('Edit')}
            </Button>
          )}
          <Switch id="nutrition_enabled" aria-labelledby="sec-nutrition" className="relative after:absolute after:-inset-3"
            checked={on} onCheckedChange={onToggle} />
        </div>
      </div>
      {on ? (
        <dl className="divide-y divide-border">
          {row(t('Daily target'), target && <span className="font-mono">{fmtKcal(target.kcal)}</span>)}
          {target && row(t('Protein'), <span className="font-mono">{fmtGrams(target.protein_g)}</span>)}
          {target && row(t('Carbs'), <span className="font-mono">{fmtGrams(target.carbs_g)}</span>)}
          {target && row(t('Fat'), <span className="font-mono">{fmtGrams(target.fat_g)}</span>)}
          {row(t('Activity outside training'), profile.activity_level && ACTIVITY_LABEL[profile.activity_level].name())}
          {row(t('Days on target per week'), <span className="font-mono">{profile.nutrition_days_per_week}</span>)}
        </dl>
      ) : (
        <p className="pb-1 text-sm leading-snug text-muted-foreground">
          {t('Get a daily calorie and protein target based on your profile. Days on target earn XP, like workouts do.')}
        </p>
      )}
    </section>
  )
}
