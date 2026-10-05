import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Check, LoaderCircle, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useProgress } from '../gamification/useProgress'
import { createChallenge, toSocialError } from './social-api'
import { useSocial } from './useSocial'
import { MODE_TEXT, TEMPLATE_TEXT, amountText, autoTitle, socialErrorText } from './labels'
import { fmtShortDay } from './format'
import {
  DURATIONS, MAX_INVITEES, MODES, TARGET_STEP, TEMPLATES, addDays, checkChallenge, clampTarget, nextMonday,
  suggestedTarget, targetRange
} from './templates'
import { PersonAvatar } from './components/PersonAvatar'
import { ACCENT_TEXT } from '../gamification/components/accent'
import { InviteButton } from './InviteButton'
import type { ChallengeMode, ChallengeTemplate, NewChallenge } from './types'

type Start = 'today' | 'monday'

// A challenge from a template with parameters, in one bottom sheet: what counts, format,
// duration and start, goal (suggested until touched), who joins, the volume opt-in and a name
// that writes itself until edited. The same rules as the server decide whether it can be sent.
export default function NewChallengeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const friends = useSocial(s => s.friends.data) ?? []
  const weekly = useProgress(s => s.progress?.week.target ?? 3)
  const today = todayISO()
  const [template, setTemplate] = useState<ChallengeTemplate>('workouts_count')
  const [mode, setMode] = useState<ChallengeMode>('team')
  const [days, setDays] = useState<number>(30)
  const [start, setStart] = useState<Start>('today')
  const [picked, setPicked] = useState<string[]>([])
  const [target, setTarget] = useState<number | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [shareVolume, setShareVolume] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTemplate('workouts_count'); setMode('team'); setDays(30); setStart('today')
    setPicked([]); setTarget(null); setTitle(null); setShareVolume(false)
  }, [open])

  const effMode: ChallengeMode = MODES[template].includes(mode) ? mode : 'solo'
  const startsOn = start === 'today' ? today : nextMonday(today)
  const endsOn = addDays(startsOn, days - 1)
  const range = targetRange(template, startsOn, endsOn)
  const goal = target === null
    ? suggestedTarget(template, effMode, startsOn, endsOn, weekly, picked.length + 1)
    : clampTarget(target, range)
  const name = title ?? autoTitle(template, goal, days)
  const draft: NewChallenge = {
    template, title: name, mode: effMode, target: goal, starts_on: startsOn, ends_on: endsOn,
    invitees: picked, share_volume: shareVolume
  }
  const problem = checkChallenge(draft, today)
  // Why the button is off, shown before anyone taps it.
  const hint = problem === 'title' ? t('Give the challenge a name.')
    : problem === 'invitees' ? (friends.length === 0 ? t('Add a friend to create challenges.') : t('Pick at least one friend.'))
    : problem === 'volume' ? t('Agree to share your volume to create this challenge.')
    : ''

  // A new shape gets a new suggested goal.
  const reshape = (change: () => void) => { change(); setTarget(null) }
  const toggle = (id: string) => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : p.length >= MAX_INVITEES ? p : [...p, id]))
  const step = (dir: 1 | -1) => setTarget(clampTarget(goal + dir * TARGET_STEP[template], range))

  const submit = async () => {
    if (problem) return
    setBusy(true)
    try {
      const id = await createChallenge(draft)
      toast.success(t('Challenge created. Your friends got the invite.'))
      onClose()
      await useSocial.getState().load('challenges')
      navigate('/social/desafios/' + id)
    } catch (e) {
      toast.error(socialErrorText(toSocialError(e).code))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DrawerContent className="max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{t('New challenge')}</DrawerTitle>
          <DrawerDescription>{t('Bring friends together around a goal with a deadline. Everyone who completes it earns 300 XP.')}</DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4">
          <Field label={t('What counts')}>
            <div role="radiogroup" aria-label={t('What counts')} className="flex flex-col gap-2">
              {TEMPLATES.map(k => {
                const tx = TEMPLATE_TEXT[k]
                const Icon = tx.icon
                const on = k === template
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} onClick={() => reshape(() => setTemplate(k))}
                    className={cn('flex min-h-16 items-start gap-3 rounded-2xl border p-3 text-left outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      on ? 'border-primary bg-primary/10' : 'border-border bg-card')}>
                    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', on ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground')}>
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium">{tx.name()}</span>
                      <span className="block text-xs leading-snug text-muted-foreground">{tx.rule()}</span>
                    </span>
                    {on && <Check aria-hidden className={cn('mt-1 size-4 shrink-0', ACCENT_TEXT)} />}
                  </button>
                )
              })}
            </div>
          </Field>

          {template === 'volume_total' && (
            <div className="flex items-start gap-3 rounded-2xl border border-border p-3">
              <label htmlFor="share-volume" className="flex-1 cursor-pointer">
                <span className="block text-[15px] font-medium">{t('Share my volume in this challenge')}</span>
                <span className="block text-xs leading-snug text-muted-foreground">{t('People in this challenge see how many tonnes you lift. Never the load of each exercise.')}</span>
              </label>
              <Switch id="share-volume" checked={shareVolume} onCheckedChange={setShareVolume} />
            </div>
          )}

          <Field label={t('Format')}>
            <ToggleGroup type="single" value={effMode} aria-label={t('Format')}
              onValueChange={v => { if (v) reshape(() => setMode(v as ChallengeMode)) }}
              className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
              {(['team', 'solo'] as const).map(m => (
                <ToggleGroupItem key={m} value={m} disabled={!MODES[template].includes(m)}
                  className="h-11 rounded-xl text-sm font-medium text-muted-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm">{MODE_TEXT[m].name()}</ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs leading-snug text-muted-foreground">
              {template === 'weeks_on_target' ? t('Only solo for this goal: each person has their own weekly goal.') : MODE_TEXT[effMode].detail()}
            </p>
          </Field>

          <Field label={t('Duration')}>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map(d => <Chip key={d} on={d === days} onClick={() => reshape(() => setDays(d))}>{t('{0} days', d)}</Chip>)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">{t('Starts')}</span>
              <Chip on={start === 'today'} onClick={() => reshape(() => setStart('today'))}>{t('Today')}</Chip>
              <Chip on={start === 'monday'} onClick={() => reshape(() => setStart('monday'))}>{t('Next Monday')}</Chip>
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">{t('{0} to {1}', fmtShortDay(startsOn), fmtShortDay(endsOn))}</p>
          </Field>

          <Field label={t('Goal')}>
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-card p-2">
              <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('Less')}
                disabled={goal <= range.min} onClick={() => step(-1)}><Minus className="size-5" /></Button>
              <output aria-live="polite" className="font-mono text-xl font-semibold tabular-nums">{amountText(template, goal)}</output>
              <Button variant="secondary" size="icon" className="size-12 rounded-xl" aria-label={t('More')}
                disabled={goal >= range.max} onClick={() => step(1)}><Plus className="size-5" /></Button>
            </div>
          </Field>

          <Field label={t('Who joins')} hint={t('Up to {0} friends.', MAX_INVITEES)}>
            {friends.length === 0 && (
              <div className="rounded-2xl border border-dashed border-border p-3"><InviteButton variant="outline" /></div>
            )}
            <ul className="flex list-none flex-col gap-1 p-0">
              {friends.map(f => {
                const on = picked.includes(f.id)
                return (
                  <li key={f.id}>
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(f.id)}
                      className="flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <PersonAvatar name={f.name} src={f.avatar_url} className="size-9" />
                      <span className="flex-1 truncate text-[15px]">{f.name}</span>
                      <span aria-hidden className={cn('grid size-6 place-items-center rounded-md border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                        {on && <Check className="size-4" />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Field>

          <Field label={t('Challenge name')}>
            <Input value={name} maxLength={60} aria-label={t('Challenge name')} onChange={e => setTitle(e.target.value)} className="h-12 text-[15px]" />
          </Field>
        </div>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <p aria-live="polite" className="text-center text-sm text-muted-foreground empty:hidden">{hint}</p>
          <Button className="h-12 gap-2 rounded-2xl text-[15px] font-semibold" disabled={!!problem || busy} aria-busy={busy} onClick={submit}>
            {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}{t('Create challenge')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3 text-sm font-semibold">
        {label}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border px-4 text-sm font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        on ? 'border-primary bg-primary/15 text-foreground' : 'border-border bg-card text-muted-foreground')}>
      {children}
    </button>
  )
}
