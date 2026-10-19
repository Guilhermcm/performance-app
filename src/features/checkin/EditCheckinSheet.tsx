import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, LoaderCircle, Lock, RefreshCw, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { dateLocale, t } from '../../lib/i18n.js'
import { exCount } from '../../lib/format.js'
import { useStore } from '../../store/useStore.js'
import { fetchMyCheckins } from './checkin-api'
import { useCheckins, type CheckinPatch } from './useCheckins'
import { useCheckinPhoto } from './photo-src'
import { dropCheckinWorkout, ingestCheckin, workoutOfCheckin } from './ingest'
import { activityLabel } from './activities'
import { Choice, Counted, Group, TEXT_MAX, TITLE_MAX } from './fields'
import DetailSheet from './DetailSheet'
import RunCheckinForm from '../run/RunCheckinForm'
import { checkRunDetail, type RunDetail } from '../run/run-detail'
import { isRunDetail, type CheckinRow, type CheckinVisibility, type StrengthDetail } from './types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  id: string
  // The check-in's day: where to look it up on the server when this phone does not have it.
  day: string
  // The row when the caller has it (older than the store's window, say).
  row?: CheckinRow | null
  // The row as edited, for a caller that keeps its own copy.
  onSaved?: (row: CheckinRow) => void
}

type AppStore = { S: Record<string, any> }

const blank = (s: string) => (s.trim() ? s.trim() : null)
// JSON with its keys sorted: a detail read back from jsonb has them in another order.
const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])])) : v
const same = (a: unknown, b: unknown) => JSON.stringify(sorted(a ?? null)) === JSON.stringify(sorted(b ?? null))
const longDay = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })

// Editing a posted check-in (spec 3.2): title, caption, private note, who sees it and the detail can
// change at any time (for a run, its distance, effort and how it went against the workout it was
// saved with); the day, the activity and the photo are shown locked (to change them, delete and
// post again). Same fields and limits as a new check-in (fields.tsx). Saving goes through the
// queue (useCheckins.edit) with only what changed; a refused edit is told by the panel host.
export default function EditCheckinSheet({ open, onOpenChange, id, day, row, onSaved }: Props) {
  const fromStore = useCheckins(s => s.mine.find(r => r.id === id) ?? null)
  const [fetched, setFetched] = useState<CheckinRow | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const base = row ?? fromStore ?? fetched

  useEffect(() => {
    if (!open || base) return
    let live = true
    setFailed(false)
    fetchMyCheckins(day, day).then(
      rows => { if (live) { const r = rows.find(x => x.id === id) ?? null; setFetched(r); setFailed(!r) } },
      () => { if (live) setFailed(true) }
    )
    return () => { live = false }
  }, [open, base, id, day, attempt])

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[92dvh] max-h-[92dvh]">
        <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <DrawerTitle className="text-xl">{t('Edit check-in')}</DrawerTitle>
          <DrawerDescription>{t('Day, activity and photo stay as they are. To change them, delete the check-in and post it again.')}</DrawerDescription>
        </DrawerHeader>
        {base ? (
          <Form key={base.id + (base.updated_at ?? '')} base={base} onDone={saved => { onSaved?.(saved); onOpenChange(false) }} />
        ) : failed ? (
          <div className="flex flex-col items-start gap-3 px-4">
            <p className="text-sm text-muted-foreground">{t('Could not load your check-ins.')}</p>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => setAttempt(n => n + 1)}>
              <RefreshCw aria-hidden className="size-4" />{t('Try again')}
            </Button>
          </div>
        ) : (
          <div aria-busy="true" className="flex flex-col gap-4 px-4">
            <Skeleton className="h-24 w-full rounded-2xl" /><Skeleton className="h-12 w-full" /><Skeleton className="h-20 w-full" />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function Form({ base, onDone }: { base: CheckinRow; onDone: (row: CheckinRow) => void }) {
  const S = useStore((s: AppStore) => s.S)
  const { url } = useCheckinPhoto((base as { photo?: Blob }).photo, base.photo_path)
  const [title, setTitle] = useState(base.title)
  const [caption, setCaption] = useState(base.caption ?? '')
  const [note, setNote] = useState(base.note ?? '')
  const [visibility, setVisibility] = useState<CheckinVisibility>(base.visibility)
  const [detail, setDetail] = useState<StrengthDetail | null>(() => (isRunDetail(base.detail) ? null : base.detail))
  // A run check-in's part (phase 1e-b): the workout it was linked to stays the one saved.
  const isRun = base.activity === 'run'
  const savedRun = isRun && isRunDetail(base.detail) ? base.detail.run : null
  const [run, setRun] = useState<RunDetail | null>(savedRun)
  const [detailOpen, setDetailOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // A check-in from a live workout: that workout is the record, its detail stays as it is (Task 7).
  const session = workoutOfCheckin(S, base.id)
  const live = !!session && session.id !== base.id
  const detailable = base.activity === 'strength' && (live || !!base.routine_id)
  const what = [activityLabel(base.activity), base.activity === 'strength' ? base.routine_name : null].filter(Boolean).join(' · ')

  const patch: CheckinPatch = {}
  if (title.trim() !== base.title) patch.title = title.trim()
  if (blank(caption) !== (base.caption ?? null)) patch.caption = blank(caption)
  if (blank(note) !== (base.note ?? null)) patch.note = blank(note)
  if (visibility !== base.visibility) patch.visibility = visibility
  if (detailable && !live && JSON.stringify(detail) !== JSON.stringify(base.detail)) patch.detail = detail
  if (isRun && !same(run ? { run } : null, base.detail)) patch.detail = run ? { run } : null
  const runOk = !run || checkRunDetail(run, 'run')
  const hint = title.trim() ? '' : t('Give it a title.')
  const ready = !hint && runOk && Object.keys(patch).length > 0 && !busy

  const save = async () => {
    if (!ready) return
    setBusy(true)
    try {
      await useCheckins.getState().edit(base.id, patch, base)
      // The history session follows the detail (plan decision 7): replaced, or gone with it.
      if ('detail' in patch && !isRun) {
        if (detail) {
          ingestCheckin({ id: base.id, day: base.day, routineId: base.routine_id, name: base.routine_name ?? patch.title ?? base.title,
            durationMin: base.duration_min, detail })
        } else dropCheckinWorkout(base.id)
      }
      toast.success(t('Check-in saved.'))
      onDone({ ...base, ...patch })
    } catch {
      toast.error(t('Could not save the check-in. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-4">
        <div role="group" aria-labelledby="edit-locked" className="flex items-center gap-4 rounded-2xl bg-secondary/60 p-3">
          <div className="aspect-[4/5] w-20 shrink-0 overflow-hidden rounded-xl bg-secondary">
            {url && <img src={url} alt={t('Check-in photo')} className="size-full object-cover" />}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p id="edit-locked" className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Lock aria-hidden className="size-3.5" />{t('Day, activity and photo')}
            </p>
            <p className="text-[15px] font-medium first-letter:uppercase">{longDay(base.day)}</p>
            <p className="text-sm text-muted-foreground">{what}</p>
          </div>
        </div>

        <Counted id="edit-title" label={t('Title')} value={title} max={TITLE_MAX} onChange={setTitle} />
        <Counted id="edit-caption" label={t('Caption')} value={caption} max={TEXT_MAX} multiline onChange={setCaption} />
        <Counted id="edit-note" label={t('Private note')} hint={t('Only you see this.')} value={note} max={TEXT_MAX} multiline onChange={setNote} />

        {isRun && <RunCheckinForm planned={savedRun?.planned ?? null} value={run} onChange={setRun} />}

        {detailable && (
          live ? (
            <div className="flex items-center gap-3 rounded-2xl bg-card p-3">
              <Check aria-hidden className="size-5 shrink-0 text-[var(--green)]" />
              <p className="text-[15px] font-medium">{t('From the workout you logged in the app')}</p>
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

        <Group label={t('Who sees it')}>
          <div role="radiogroup" aria-label={t('Who sees it')} className="grid grid-cols-2 gap-2">
            <Choice on={visibility === 'friends'} onClick={() => setVisibility('friends')} icon={<Users aria-hidden className="size-4" />}>{t('Friends')}</Choice>
            <Choice on={visibility === 'private'} onClick={() => setVisibility('private')} icon={<Lock aria-hidden className="size-4" />}>{t('Only me')}</Choice>
          </div>
        </Group>
      </div>

      <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p aria-live="polite" className="text-center text-sm text-muted-foreground empty:hidden">{hint}</p>
        <Button className="h-12 gap-2 rounded-2xl text-[15px] font-semibold" disabled={!ready} aria-busy={busy} onClick={save}>
          {busy && <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />}{t('Save')}
        </Button>
      </DrawerFooter>

      {detailable && !live && (
        <DetailSheet open={detailOpen} onOpenChange={setDetailOpen} routineId={base.routine_id} initial={detail} posted onConfirm={setDetail} />
      )}
    </>
  )
}
