import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Activity, ArrowLeft, Check, ChevronRight, CodeXml, Lock, LogOut, Pencil, ShieldCheck, Users } from 'lucide-react'
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
import { refreshAutoTarget } from '../nutrition/auto-target'
import { todayIn } from '../nutrition/days'
import { ACTIVITY_LABEL, fmtGrams, fmtKcal } from '../nutrition/labels'
import SleepSetup from '../sleep/SleepSetup'
import { useSleep } from '../sleep/useSleep'
import { useLocalNow } from '../sleep/use-local-now'
import { fmtClock, fmtDuration } from '../sleep/time'
import HabitsSetup from '../habits/HabitsSetup'
import { useHabits } from '../habits/useHabits'
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

// What the automatic nutrition target is calculated from, among the fields edited here (activity
// and pace are edited in the nutrition setup, which writes its own target).
const TARGET_INPUTS: (keyof ProfileInput)[] = ['goal', 'birth_date', 'sex', 'height_cm', 'weight_kg']

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
  const [sleepSetupOpen, setSleepSetupOpen] = useState(false)
  const [sleepAsk, setSleepAsk] = useState(false)
  const [habitsSetupOpen, setHabitsSetupOpen] = useState(false)
  const [habitsAsk, setHabitsAsk] = useState(false)
  // A link here with focus 'share_activity' (the old feed's sharing banner) brings the switch for the
  // old workouts into view and focuses it.
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
      // A new automatic target from tomorrow; a manual one stays. Never throws.
      if (TARGET_INPUTS.some(k => k in patch)) void refreshAutoTarget(saved)
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

  // Turning Sleep on goes through the setup; turning it off asks first. Nights and goals stay saved.
  const toggleSleep = (on: boolean) => {
    if (on) { setSleepSetupOpen(true); return }
    setSleepAsk(true)
  }
  const turnOffSleep = async () => {
    try {
      await save({ sleep_enabled: false })
      setSleepAsk(false)
    } catch { toast(t('Could not save. Your previous values were kept.')) }
  }

  // Turning Habits on goes through its setup (which opens the first habit when none is active);
  // turning it off asks first. Habits and checks stay saved.
  const toggleHabits = (on: boolean) => {
    if (on) { setHabitsSetupOpen(true); return }
    setHabitsAsk(true)
  }
  const turnOffHabits = async () => {
    try {
      await save({ habits_enabled: false })
      setHabitsAsk(false)
    } catch { toast(t('Could not save. Your previous values were kept.')) }
  }

  const toggleShare = async (on: boolean) => {
    try { await save({ share_activity: on }) } catch { toast(t('Could not save. Your previous values were kept.')) }
  }

  const setVisibility = async (to: Profile['checkin_visibility']) => {
    if (profile.checkin_visibility === to) return
    try { await save({ checkin_visibility: to }) } catch { toast(t('Could not save. Your previous values were kept.')) }
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

        <SleepCard profile={profile} asking={sleepAsk} onToggle={toggleSleep} onEdit={() => setSleepSetupOpen(true)}
          onCancelOff={() => setSleepAsk(false)} onConfirmOff={() => void turnOffSleep()} />
        <SleepSetup open={sleepSetupOpen} onOpenChange={setSleepSetupOpen} />

        <HabitsCard profile={profile} asking={habitsAsk} onToggle={toggleHabits}
          onCancelOff={() => setHabitsAsk(false)} onConfirmOff={() => void turnOffHabits()} />
        <HabitsSetup open={habitsSetupOpen} onOpenChange={setHabitsSetupOpen} />

        {/* Trackers have no pillar and no switch: the row is the way in (spec 8.6). */}
        <section data-slot="card" className="rounded-2xl border border-border bg-card px-5 py-1">
          <Button variant="ghost" className="-mx-3 h-12 w-[calc(100%+1.5rem)] justify-between rounded-xl px-3 text-[15px] font-semibold"
            onClick={() => navigate('/trackers')}>
            <span className="flex items-center gap-2"><Activity aria-hidden className="size-4 text-muted-foreground" />{t('Trackers')}</span>
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </section>

        {/* checkin_visibility is where a new check-in's form starts (spec 4.6); each post picks its own. */}
        <section data-slot="card" aria-labelledby="sec-visibility" className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 pb-5 pt-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="sec-visibility" className="text-[15px] font-semibold leading-snug">{t('Default check-in visibility')}</h2>
            <p id="sec-visibility-hint" className="text-sm leading-snug text-muted-foreground">{t('You can change it on each check-in. Private notes and loads stay with you.')}</p>
          </div>
          <div role="radiogroup" aria-labelledby="sec-visibility" aria-describedby="sec-visibility-hint" className="grid grid-cols-2 gap-2">
            <Choice on={profile.checkin_visibility !== 'private'}
              onClick={() => void setVisibility('friends')} icon={<Users aria-hidden className="size-4" />}>{t('Friends')}</Choice>
            <Choice on={profile.checkin_visibility === 'private'}
              onClick={() => void setVisibility('private')} icon={<Lock aria-hidden className="size-4" />}>{t('Only me')}</Choice>
          </div>
        </section>

        {/* share_activity keeps its first meaning: friends see the workouts from before the check-ins,
            as the old feed items (get_feed, and the legacy branch of get_checkin_feed). */}
        <section data-slot="card" className="flex items-center gap-4 rounded-2xl border border-border bg-card py-2 pl-5 pr-4">
          <label htmlFor="share_activity" className="flex min-h-12 flex-1 cursor-pointer flex-col justify-center gap-0.5 py-2 text-left">
            <span className="text-sm font-medium leading-snug">{t('Show friends my workouts from before check-ins')}</span>
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
          <CodeXml aria-hidden className="size-4" />{t('Source code and license')}
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

// One label and value line of a summary list; an empty value shows a placeholder.
const detailRow = (label: string, value: ReactNode) => (
  <div key={label} className="flex min-h-11 items-center justify-between gap-4 py-2 text-[15px]">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right font-medium tabular-nums">{value ?? '—'}</dd>
  </div>
)

function Summary({ section, profile }: { section: SectionKey; profile: Profile }) {
  const list = (rows: ReactNode[]) => <dl className="divide-y divide-border">{rows}</dl>
  if (section === 'body') {
    const born = profile.birth_date
      ? new Date(profile.birth_date + 'T00:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
      : null
    return list([
      detailRow(t('Height (cm)'), num(profile.height_cm, 'cm')),
      detailRow(t('Weight (kg)'), num(profile.weight_kg, 'kg')),
      detailRow(t('Birth date'), born),
      detailRow(t('Sex'), profile.sex && SEX_LABEL[profile.sex]()),
      detailRow(t('Units'), <span className="font-mono">{profile.unit}</span>)
    ])
  }
  if (section === 'goal') {
    return list([
      detailRow(t('Main goal'), profile.goal && GOAL_LABEL[profile.goal]()),
      detailRow(t('Experience'), profile.level && LEVEL_LABEL[profile.level]()),
      detailRow(t('Training days per week'), profile.days_per_week)
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
          {detailRow(t('Daily target'), target && <span className="font-mono">{fmtKcal(target.kcal)}</span>)}
          {target && detailRow(t('Protein'), <span className="font-mono">{fmtGrams(target.protein_g)}</span>)}
          {target && detailRow(t('Carbs'), <span className="font-mono">{fmtGrams(target.carbs_g)}</span>)}
          {target && detailRow(t('Fat'), <span className="font-mono">{fmtGrams(target.fat_g)}</span>)}
          {detailRow(t('Activity outside training'), profile.activity_level && ACTIVITY_LABEL[profile.activity_level].name())}
          {detailRow(t('Days on target per week'), <span className="font-mono">{profile.nutrition_days_per_week}</span>)}
        </dl>
      ) : (
        <p className="pb-1 text-sm leading-snug text-muted-foreground">
          {t('Get a daily calorie and protein target based on your profile. Days on target earn XP, like workouts do.')}
        </p>
      )}
    </section>
  )
}

// Perfil > Sono: the pillar's switch and, once on, the goal in force, the bedtime and the nights on
// target per week, edited through the setup sheet. Turning it off asks first.
function SleepCard({ profile, asking, onToggle, onEdit, onCancelOff, onConfirmOff }: {
  profile: Profile; asking: boolean; onToggle: (on: boolean) => void; onEdit: () => void; onCancelOff: () => void; onConfirmOff: () => void
}) {
  const navigate = useNavigate()
  const { today } = useLocalNow(profile.timezone)
  const target = useSleep(s => s.targetOn(today))
  const on = profile.sleep_enabled
  const title = t('Sleep')
  return (
    <section data-slot="card" aria-labelledby="sec-sleep" className="rounded-2xl border border-border bg-card px-5 pb-4 pt-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id="sec-sleep" className="text-[15px] font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          {on && (
            <Button variant="ghost" className="h-11 gap-2 rounded-full px-3 text-muted-foreground hover:text-foreground"
              aria-label={t('Edit') + ': ' + title} onClick={onEdit}>
              <Pencil className="size-4" />{t('Edit')}
            </Button>
          )}
          <Switch id="sleep_enabled" aria-labelledby="sec-sleep" className="relative after:absolute after:-inset-3"
            checked={on} onCheckedChange={onToggle} />
        </div>
      </div>
      {on ? (
        <>
          <dl className="divide-y divide-border">
            {detailRow(t('Sleep goal'), target && <span className="font-mono">{fmtDuration(target.goal_min)}</span>)}
            {detailRow(t('Bedtime'), target && <span className="font-mono">{fmtClock(target.bed_target)}</span>)}
            {detailRow(t('Nights on target per week'), <span className="font-mono">{profile.sleep_nights_per_week}</span>)}
          </dl>
          {asking ? (
            <div role="alertdialog" aria-labelledby="sleep-off-question" aria-describedby="sleep-off-hint" className="mt-2 flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
              <div className="flex flex-col gap-1">
                <p id="sleep-off-question" className="text-[15px] font-semibold leading-snug">{t('Turn off Sleep?')}</p>
                <p id="sleep-off-hint" className="text-sm leading-snug text-muted-foreground">{t('Your nights and goals stay saved. You can turn it back on any time.')}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12 rounded-xl" onClick={onCancelOff}>{t('Cancel')}</Button>
                <Button variant="destructive" className="h-12 rounded-xl" onClick={onConfirmOff}>{t('Turn off')}</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="-mx-3 mt-1 h-11 w-[calc(100%+1.5rem)] justify-between rounded-xl px-3 text-[15px]"
              onClick={() => navigate('/sono')}>
              {t('Open Sleep')}<ChevronRight aria-hidden className="size-4" />
            </Button>
          )}
        </>
      ) : (
        <p className="pb-1 text-sm leading-snug text-muted-foreground">
          {t('Set how long you want to sleep and when you go to bed. Nights that hit both earn XP, like workouts do.')}
        </p>
      )}
    </section>
  )
}

// Perfil > Hábitos (spec 3.1): the pillar's switch and, once on, how many habits are active and the
// way to the Habits screen, where they are created and edited. Turning it off asks first.
function HabitsCard({ profile, asking, onToggle, onCancelOff, onConfirmOff }: {
  profile: Profile; asking: boolean; onToggle: (on: boolean) => void; onCancelOff: () => void; onConfirmOff: () => void
}) {
  const navigate = useNavigate()
  // A placeholder until the habits have loaded, rather than a 0 that may not be true.
  const active = useHabits(s => (s.status === 'ready' || s.habits.length ? s.habits.filter(h => !h.archived_at).length : null))
  const on = profile.habits_enabled
  return (
    <section data-slot="card" aria-labelledby="sec-habits" className="rounded-2xl border border-border bg-card px-5 pb-4 pt-3">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id="sec-habits" className="text-[15px] font-semibold">{t('Habits')}</h2>
        <Switch id="habits_enabled" aria-labelledby="sec-habits" className="relative after:absolute after:-inset-3"
          checked={on} onCheckedChange={onToggle} />
      </div>
      {on ? (
        <>
          <dl className="divide-y divide-border">
            {detailRow(t('Active habits'), active === null ? null : <span className="font-mono">{active}</span>)}
          </dl>
          {asking ? (
            <div role="alertdialog" aria-labelledby="habits-off-question" aria-describedby="habits-off-hint" className="mt-2 flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
              <div className="flex flex-col gap-1">
                <p id="habits-off-question" className="text-[15px] font-semibold leading-snug">{t('Turn off Habits?')}</p>
                <p id="habits-off-hint" className="text-sm leading-snug text-muted-foreground">{t('Your habits and checks stay saved. You can turn it back on any time.')}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-12 rounded-xl" onClick={onCancelOff}>{t('Cancel')}</Button>
                <Button variant="destructive" className="h-12 rounded-xl" onClick={onConfirmOff}>{t('Turn off')}</Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" className="-mx-3 mt-1 h-11 w-[calc(100%+1.5rem)] justify-between rounded-xl px-3 text-[15px]"
              onClick={() => navigate('/habitos')}>
              {t('Open Habits')}<ChevronRight aria-hidden className="size-4" />
            </Button>
          )}
        </>
      ) : (
        <p className="pb-1 text-sm leading-snug text-muted-foreground">
          {t('Choose your habits and how many times a week you want to do each one. Every check earns XP, like workouts do.')}
        </p>
      )}
    </section>
  )
}

// One of the two visibilities: a radio with an icon and a word, never colour alone.
function Choice({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick}
      className={cn('flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-[15px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        on ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-card text-muted-foreground')}>
      {icon}{children}
      {on && <Check aria-hidden className="size-4" />}
    </button>
  )
}
