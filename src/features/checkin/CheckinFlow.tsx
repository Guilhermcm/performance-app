import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Camera, Check, ImageIcon, LoaderCircle, Lock, Users } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { exCount, weekStartOf } from '../../lib/format.js'
import { effectiveRoutines } from '../../lib/history.js'
import { useStore } from '../../store/useStore.js'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from '../nutrition/days'
import { ACTIVITIES, activityLabel } from './activities'
import { closeCheckin, registerCheckinCamera, setCheckinPhoto, useCheckinFlow } from './open-checkin'
import { droppedMessages, useCheckins, type CheckinInput } from './useCheckins'
import { ingestCheckin, linkWorkout } from './ingest'
import DetailSheet from './DetailSheet'
import RunCheckinForm, { relinkRun } from '../run/RunCheckinForm'
import { checkRunDetail, plannedMinutes, plannedOn, type RunDetail } from '../run/run-detail'
import type { RunPlan } from '../run/types'
import { Choice, Chip, Counted, DURATION_MAX, Group, TEXT_MAX, TITLE_MAX } from './fields'
import type { CheckinActivity, CheckinVisibility, StrengthDetail } from './types'

export { openCheckin, openCheckinCamera, closeCheckin, useCheckinFlow } from './open-checkin'
export type { OpenCheckinOptions, CheckinDetail } from './open-checkin'

export { TITLE_MAX, TEXT_MAX } from './fields'

type Routine = { id: string; name: string; ex: unknown[] }
type LiveWorkout = { id: string; name?: string; routineId?: string | null; start?: number; end?: number }
type AppStore = { S: { routines: Routine[]; workouts?: LiveWorkout[]; runPlan?: RunPlan | null; weekStart?: number } & Record<string, unknown> }

// "Musculação · Push · 55 min": the activity, the routine for strength training, and the duration
// when there is one. Cut to the title's limit.
export function suggestTitle(activity: CheckinActivity | null, routineName: string | null, durationMin: number | null): string {
  if (!activity) return ''
  const parts = [activityLabel(activity)]
  if (activity === 'strength' && routineName) parts.push(routineName)
  if (durationMin) parts.push(t('{0} min', durationMin))
  return parts.join(' · ').slice(0, TITLE_MAX)
}

// The full-screen check-in (spec 3.1), with no route of its own: opened by openCheckin from the tab
// bar, Home, the Plan and the end of a live workout. Mounted once for a signed-in account (App.jsx),
// it also says once what the server refused from the queue.
export default function CheckinFlow() {
  const open = useCheckinFlow(s => s.open)
  const seq = useCheckinFlow(s => s.seq)
  const dropped = useCheckins(s => s.dropped)

  // Without this host on the page (signed out, or the profile not in yet) nothing shows the panel,
  // so it never stays open to pop up later (1e-b final review I1).
  useEffect(() => () => { useCheckinFlow.setState({ open: false }) }, [])

  useEffect(() => {
    if (!dropped.length) return
    for (const m of droppedMessages(dropped)) toast(m)
    useCheckins.getState().dismissDropped()
  }, [dropped])

  // The rear camera the center tap opens (openCheckinCamera). It is on the page before the tap and
  // outside the panel, and only that tap uses it, so it is hidden from assistive technology; the
  // panel has its own labelled "Take photo".
  const shot = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file && useCheckinFlow.getState().open) setCheckinPhoto(file)
  }

  return (
    <>
      <input ref={registerCheckinCamera} type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true"
        className="sr-only" onChange={shot} />
      <Drawer open={open} onOpenChange={o => { if (!o) closeCheckin() }}>
        <DrawerContent className="h-[96dvh] max-h-[96dvh]">
          {/* A new opening is a new form. */}
          <Panel key={seq} />
        </DrawerContent>
      </Drawer>
    </>
  )
}

function Panel() {
  const opts = useCheckinFlow(s => s.opts)
  const S = useStore((s: AppStore) => s.S)
  const profile = useProfile(s => s.profile)
  const today = todayIn(profile?.timezone)
  const routines = S.routines ?? []
  const todays = effectiveRoutines(S, today) as Routine[]
  const live = opts.fromWorkout ? (S.workouts ?? []).find(w => w.id === opts.fromWorkout) ?? null : null
  const known = (id: string | null | undefined) => (id && routines.some(r => r.id === id) ? id : '')

  const photo = useCheckinFlow(s => s.photo)
  const [preview, setPreview] = useState<string | null>(null)
  const [activity, setActivity] = useState<CheckinActivity | null>(() =>
    opts.activity ?? (opts.routineId || live || todays.length ? 'strength' : null))
  const [routineId, setRoutineId] = useState(() => known(opts.routineId) || known(live?.routineId) || (todays[0]?.id ?? ''))
  const [title, setTitle] = useState<string | null>(null)
  const [duration, setDuration] = useState(() => {
    const min = live?.start && live?.end ? Math.round((live.end - live.start) / 60000) : 0
    return min >= 1 && min <= DURATION_MAX ? String(min) : ''
  })
  const [caption, setCaption] = useState('')
  const [note, setNote] = useState('')
  const [yesterday, setYesterday] = useState(false)
  const [visibility, setVisibility] = useState<CheckinVisibility>(() => (profile?.checkin_visibility === 'private' ? 'private' : 'friends'))
  const [detail, setDetail] = useState<StrengthDetail | null>(opts.detail ?? null)
  const [detailOpen, setDetailOpen] = useState(false)
  // The run part (phase 1e-b): what goes out as detail.run, null for nothing (plan decision 3).
  const [run, setRun] = useState<RunDetail | null>(null)
  // The duration last filled in from the planned workout; one the person typed is never replaced.
  const [autoDuration, setAutoDuration] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!photo || typeof URL.createObjectURL !== 'function') { setPreview(null); return }
    const url = URL.createObjectURL(photo)
    setPreview(url)
    return () => URL.revokeObjectURL?.(url)
  }, [photo])

  const routine = routines.find(r => r.id === routineId) ?? null
  const strength = activity === 'strength'
  const routineName = strength ? routine?.name ?? (live && !routineId ? live.name ?? null : null) : null
  const day = yesterday ? shiftDay(today, -1) : today
  // The running plan's workout of the check-in day, mapped with the plan's own week start.
  const plan = S.runPlan ?? null
  const ws = weekStartOf(S) as 0 | 1
  const isRun = activity === 'run'
  const planned = useMemo(() => (isRun ? plannedOn(plan, day, ws) : null), [isRun, plan, day, ws])
  const runSent = isRun ? run : null
  const runOk = !runSent || checkRunDetail(runSent, 'run')
  const durationMin = duration ? Number(duration) : null
  const durationOk = durationMin === null || (durationMin >= 1 && durationMin <= DURATION_MAX)
  const name = title ?? suggestTitle(activity, routineName, durationOk ? durationMin : null)
  // A detail belongs to strength training with a routine, or to the live workout it came from.
  const detailable = strength && (!!routine || !!live)
  const hint = !activity ? t('Pick an activity.') : !name.trim() ? t('Give it a title.') : ''
  const ready = !!photo && !hint && durationOk && runOk && !busy
  const order = [...todays, ...routines.filter(r => !todays.some(x => x.id === r.id))]

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setCheckinPhoto(file)
  }
  const dropPhoto = () => setCheckinPhoto(null)
  // "Was it yesterday?" moves a linked run to that day's workout (Review Focus 3).
  // A duration filled in from the old workout follows the new one, or goes without one (R2 T4-M2).
  const changeDay = (y: boolean) => {
    setYesterday(y)
    const next = relinkRun(run, plannedOn(plan, y ? shiftDay(today, -1) : today, ws))
    setRun(next)
    if (autoDuration !== null && duration === autoDuration) fillDuration(next?.planned ? plannedMinutes(next.planned.blocks) : null)
  }
  // "Done as planned" fills an empty duration, or one it filled itself, with the workout's minutes.
  const fillDuration = (min: number | null) => {
    const text = min === null ? '' : String(Math.min(min, DURATION_MAX))
    if (duration && duration !== autoDuration) return
    setDuration(text)
    setAutoDuration(text || null)
  }
  // The select is locked for a live workout, whose detail is its own; so this only runs without one.
  const changeRoutine = (id: string) => {
    setRoutineId(id)
    // The sets of one routine say nothing about another.
    setDetail(null)
  }

  const submit = async () => {
    if (!photo || !activity || !ready) return
    setBusy(true)
    const sent = detailable ? detail : null
    const input: CheckinInput = {
      day, activity, routineId: strength && routine ? routine.id : null, routineName, title: name.trim(),
      caption, note, durationMin, visibility, photo, detail: runSent ? { run: runSent } : sent
    }
    try {
      const id = await useCheckins.getState().post(input)
      // The live workout already is the session in the history; a detail given here becomes one.
      if (live) linkWorkout(live.id, id)
      else if (sent) ingestCheckin({ id, day, routineId: input.routineId ?? null, name: routineName ?? input.title, durationMin, detail: sent })
      toast.success(t('Check-in posted.'))
      closeCheckin()
    } catch (e) {
      const code = (e as { code?: string } | null)?.code
      if (code === 'photo_unreadable' || code === 'photo_too_large') {
        toast.error(code === 'photo_unreadable' ? t('Couldn’t open this photo. Try the camera.') : t('This photo is too big. Try another one.'))
        dropPhoto()
      } else {
        toast.error(t('Could not post the check-in. Try again.'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl">{t('New check-in')}</DrawerTitle>
        <DrawerDescription>{t('Take a photo to check in.')}</DrawerDescription>
      </DrawerHeader>

      {!photo ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <span aria-hidden className="mb-3 grid size-24 place-items-center rounded-full bg-secondary text-foreground">
            <Camera className="size-10" strokeWidth={1.5} />
          </span>
          <PhotoInput label={t('Take photo')} icon={<Camera aria-hidden className="size-5" />} camera primary onChange={pick} />
          <PhotoInput label={t('Choose from gallery')} icon={<ImageIcon aria-hidden className="size-5" />} onChange={pick} />
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
            <div className="flex items-end gap-4">
              <div className="aspect-[4/5] w-32 shrink-0 overflow-hidden rounded-2xl bg-secondary">
                {preview && <img src={preview} alt={t('Check-in photo')} className="size-full object-cover" />}
              </div>
              <PhotoInput label={t('Change photo')} icon={<ImageIcon aria-hidden className="size-4" />} small onChange={pick} />
            </div>

            <Group label={t('Activity')}>
              <div role="radiogroup" aria-label={t('Activity')} className="flex flex-wrap gap-2">
                {ACTIVITIES.map(a => (
                  <Chip key={a} on={a === activity} onClick={() => setActivity(a)}>{activityLabel(a)}</Chip>
                ))}
              </div>
            </Group>

            {strength && routines.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="checkin-routine" className="text-sm font-semibold">{t('Routine')}</label>
                <select id="checkin-routine" value={routineId} disabled={!!live} onChange={e => changeRoutine(e.target.value)}
                  className="h-12 w-full rounded-md border border-input bg-transparent px-3 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30">
                  <option value="">{t('No routine')}</option>
                  {order.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            )}

            <Counted id="checkin-title" label={t('Title')} value={name} max={TITLE_MAX} onChange={v => setTitle(v)} />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="checkin-duration" className="text-sm font-semibold">{t('Duration (min)')}</label>
              <Input id="checkin-duration" value={duration} inputMode="numeric" autoComplete="off"
                aria-invalid={durationOk ? undefined : true} aria-describedby={durationOk ? undefined : 'checkin-duration-note'}
                onChange={e => setDuration(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="h-12 w-32 font-mono text-[15px] tabular-nums" />
              {!durationOk && <p id="checkin-duration-note" className="text-xs text-destructive">{t('Duration goes from 1 to 600 minutes.')}</p>}
            </div>

            <Counted id="checkin-caption" label={t('Caption')} value={caption} max={TEXT_MAX} multiline onChange={setCaption} />
            <Counted id="checkin-note" label={t('Private note')} hint={t('Only you see this.')} value={note} max={TEXT_MAX} multiline onChange={setNote} />

            {isRun && (
              <RunCheckinForm planned={planned} value={run} onChange={setRun}
                onPlannedMinutes={fillDuration} />
            )}

            {detailable && (
              live ? (
                <div className="flex items-center gap-3 rounded-2xl bg-card p-3">
                  <Check aria-hidden className="size-5 shrink-0 text-[var(--green)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{t('From the workout you logged in the app')}</p>
                    {detail && <p className="text-xs text-muted-foreground">{exCount(detail.entries.length)}</p>}
                  </div>
                </div>
              ) : detail ? (
                <div className="flex items-center gap-3 rounded-2xl bg-card p-3">
                  <Check aria-hidden className="size-5 shrink-0 text-[var(--green)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{t('Workout detailed')}</p>
                    <p className="text-xs text-muted-foreground">{exCount(detail.entries.length)}</p>
                  </div>
                  <Button variant="outline" className="h-11 rounded-xl" onClick={() => setDetailOpen(true)}>{t('Edit')}</Button>
                </div>
              ) : (
                <Button variant="secondary" className="h-12 rounded-2xl text-[15px]" onClick={() => setDetailOpen(true)}>{t('Detail workout')}</Button>
              )
            )}

            <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
              <div className="flex-1">
                <label htmlFor="checkin-yesterday" className="block cursor-pointer text-[15px] font-medium">{t('Was it yesterday?')}</label>
                <p id="checkin-yesterday-note" className="text-xs text-muted-foreground">
                  {yesterday ? t('It counts for yesterday.') : t('It counts for today.')}
                </p>
              </div>
              <Switch id="checkin-yesterday" className="relative after:absolute after:-inset-3" checked={yesterday}
                aria-describedby="checkin-yesterday-note" onCheckedChange={changeDay} />
            </div>

            <Group label={t('Who sees it')}>
              <div role="radiogroup" aria-label={t('Who sees it')} className="grid grid-cols-2 gap-2">
                <Choice on={visibility === 'friends'} onClick={() => setVisibility('friends')} icon={<Users aria-hidden className="size-4" />}>{t('Friends')}</Choice>
                <Choice on={visibility === 'private'} onClick={() => setVisibility('private')} icon={<Lock aria-hidden className="size-4" />}>{t('Only me')}</Choice>
              </div>
            </Group>
          </div>

          <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <p aria-live="polite" className="text-center text-sm text-muted-foreground empty:hidden">{hint}</p>
            <Button className="h-12 gap-2 rounded-2xl text-[15px] font-semibold" disabled={!ready} aria-busy={busy} onClick={submit}>
              {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}{t('Post')}
            </Button>
          </DrawerFooter>

          {detailable && !live && (
            <DetailSheet open={detailOpen} onOpenChange={setDetailOpen} routineId={routineId || null} initial={detail} onConfirm={setDetail} />
          )}
        </>
      )}
    </>
  )
}

// A file input inside its label: the label is what is tapped, so the picker opens natively (the
// iPhone PWA needs a real tap on the input), and the input's name is the label's text.
function PhotoInput({ label, icon, camera, primary, small, onChange }:
  { label: string; icon: ReactNode; camera?: boolean; primary?: boolean; small?: boolean; onChange: (e: ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className={cn(buttonVariants({ variant: primary ? 'default' : small ? 'outline' : 'secondary' }),
      'cursor-pointer focus-within:ring-[3px] focus-within:ring-ring/50',
      small ? 'h-11 rounded-xl' : 'h-14 w-full max-w-sm gap-2 rounded-2xl text-base font-semibold')}>
      <input type="file" accept="image/*" {...(camera ? { capture: 'environment' as const } : {})} className="sr-only" onChange={onChange} />
      {icon}{label}
    </label>
  )
}
