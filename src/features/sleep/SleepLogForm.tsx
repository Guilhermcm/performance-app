import { useId, useState, type FormEvent } from 'react'
import { ChevronDown, NotebookPen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useLocalNow } from './use-local-now'
import { useSleep } from './useSleep'
import { QUALITY_LABEL } from './labels'
import { TimeWheel } from './TimeWheel'
import { durationMin, fmtClock, shiftClock, toMinutes, validDuration } from './time'
import type { SleepLog } from './types'

// With no night to start from and no goal yet, the defaults of the setup (spec 3.1).
const DEFAULT_BED = '23:00'
const DEFAULT_GOAL = 480
const NOTE_MAX = 140
const QUALITIES = [1, 2, 3, 4, 5] as const

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'

type Props = {
  // The night being logged: the local date the person woke up.
  night: string
  // A log to start from. The same night is an edit (quality and note come along); another night
  // only lends its times.
  initial?: SleepLog
  onSaved?: (log: SleepLog) => void
}

type Start = { bed: string; wake: string; quality: number | null; note: string }

// Where the form starts (spec 4.3): the night being edited; else the times of the given log or of
// the last night logged in the past 14 days; else bed at the bedtime target and wake after the goal.
function startOf(night: string, initial: SleepLog | undefined): Start {
  if (initial?.night === night) return { bed: initial.bed_time, wake: initial.wake_time, quality: initial.quality, note: initial.note ?? '' }
  const s = useSleep.getState()
  const last = initial ?? s.lastLogged(night)
  if (last) return { bed: last.bed_time, wake: last.wake_time, quality: null, note: '' }
  const target = s.targetOn(night)
  const bed = target?.bed_target ?? DEFAULT_BED
  return { bed, wake: shiftClock(bed, target?.goal_min ?? DEFAULT_GOAL), quality: null, note: '' }
}

// One night's log: the two times (each opens the wheel), then the optional quality and note. The
// morning card, the sleep screen and the edit sheet all use it. One tap on the button saves.
export function SleepLogForm({ night, initial, onSaved }: Props) {
  const timezone = useProfile(s => s.profile?.timezone)
  const now = useLocalNow(timezone)
  const [start] = useState(() => startOf(night, initial))
  const editing = initial?.night === night
  const [bed, setBed] = useState(start.bed)
  const [wake, setWake] = useState(start.wake)
  const [quality, setQuality] = useState<number | null>(start.quality)
  const [note, setNote] = useState(start.note)
  const [noteOpen, setNoteOpen] = useState(!!start.note)
  const [open, setOpen] = useState<'bed' | 'wake' | null>(null)
  const wheelId = useId()
  const noteId = useId()
  const qualityId = useId()

  // Spec 4.1: 1h to 16h, and last night's wake-up can't be in the future.
  const error = !validDuration(durationMin(bed, wake)) ? t('A night has to last between 1 and 16 hours')
    : night === now.today && toMinutes(wake) > now.minutes ? t('The wake-up time can’t be later than now')
    : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (error) return
    const log = useSleep.getState().saveNight({ night, bed_time: bed, wake_time: wake, quality, note: note.trim() || null })
    onSaved?.(log)
  }
  const toggle = (which: 'bed' | 'wake') => setOpen(o => (o === which ? null : which))

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <TimeField label={t('Went to bed')} value={bed} open={open === 'bed'} controls={wheelId} onToggle={() => toggle('bed')} />
          <TimeField label={t('Woke up')} value={wake} open={open === 'wake'} controls={wheelId} onToggle={() => toggle('wake')} />
        </div>
        {open && (
          <div id={wheelId} className="animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {open === 'bed'
              ? <TimeWheel label={t('Went to bed')} value={bed} onChange={setBed} />
              : <TimeWheel label={t('Woke up')} value={wake} onChange={setWake} />}
          </div>
        )}
        {error && <p role="alert" className="text-sm leading-snug text-destructive">{error}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <span id={qualityId} className="text-sm font-medium text-muted-foreground">
          {t('Sleep quality')} <span className="font-normal">· {t('Optional')}</span>
        </span>
        <ToggleGroup type="single" variant="outline" className="grid w-full grid-cols-5" aria-labelledby={qualityId}
          value={quality ? String(quality) : ''} onValueChange={v => setQuality(v ? Number(v) : null)}>
          {QUALITIES.map(q => (
            <ToggleGroupItem key={q} value={String(q)}
              className={cn('h-11 min-w-0 px-1 text-[13px] transition-colors duration-150 motion-reduce:transition-none', ON)}>
              {QUALITY_LABEL[q]()}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {noteOpen ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-sm font-medium text-muted-foreground">{t('Note')}</label>
          <textarea id={noteId} rows={2} maxLength={NOTE_MAX} value={note} aria-describedby={noteId + '-count'}
            onChange={e => setNote(e.target.value.slice(0, NOTE_MAX))}
            className="min-h-16 w-full resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
          <span id={noteId + '-count'} className="self-end font-mono text-xs tabular-nums text-muted-foreground">{note.length}/{NOTE_MAX}</span>
        </div>
      ) : (
        <Button type="button" variant="ghost" className="h-11 gap-2 self-start rounded-xl px-3 text-muted-foreground" onClick={() => setNoteOpen(true)}>
          <NotebookPen aria-hidden className="size-4" />{t('Add note')}
        </Button>
      )}

      <Button type="submit" className="h-12 w-full rounded-xl text-[15px] font-semibold" disabled={!!error}>
        {editing ? t('Save') : t('Confirm')}
      </Button>
    </form>
  )
}

type TimeFieldProps = { label: string; value: string; open: boolean; controls: string; onToggle: () => void }

// A time as a button: the label, the time in large tabular figures, and the wheel opens below.
function TimeField({ label, value, open, controls, onToggle }: TimeFieldProps) {
  return (
    <button type="button" aria-expanded={open} aria-controls={open ? controls : undefined} onClick={onToggle}
      className={cn('flex min-h-16 flex-col items-start justify-center rounded-2xl bg-secondary/60 px-3 py-2 text-left outline-none transition-colors duration-150 hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
        open && 'ring-1 ring-primary/60')}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex w-full items-center justify-between gap-1">
        <span className="font-mono text-2xl font-semibold tabular-nums">{fmtClock(value)}</span>
        <ChevronDown aria-hidden className={cn('size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')} />
      </span>
    </button>
  )
}
