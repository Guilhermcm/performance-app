import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { dateLocale, t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { shiftDay, todayIn } from '../nutrition/days'
import { fromMinutes } from '../sleep/time'
import { minutesIn, useLocalNow } from '../sleep/use-local-now'
import { useTrackers, WINDOW_DAYS } from './useTrackers'
import { parseNumberInput } from './format'
import type { Tracker, TrackerEntry } from './types'

const NOTE_MAX = 140
const MAX_MINUTES = 1440
// numeric(12, 2) holds ten integer digits.
const VALUE_LIMIT = 1e10

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'
const MONO = 'font-mono tabular-nums'
const FIELD = 'h-12 rounded-xl text-[15px]'

// Characters as people count them (and as the server's char_length does), not UTF-16 units.
const chars = (s: string) => Array.from(s)

type Props = {
  tracker: Tracker
  // Given: editing (and deleting) this entry, always on the full sheet.
  entry?: TrackerEntry
  // quick: only the value, saved for now; full: day, time, value and note.
  mode: 'quick' | 'full'
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Adding, editing and deleting a tracker entry (spec 8.2 and 8.4). The quick sheet asks for the
// value alone and writes it for today at the local time; the full sheet also asks for the day, the
// time and a note. An archived tracker's entries can be edited and deleted like any other.
export default function EntrySheet({ tracker, entry, mode, open, onOpenChange }: Props) {
  // A fresh form each time the sheet opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <SheetBody key={session} tracker={tracker} entry={entry} quick={mode === 'quick' && !entry} onDone={() => onOpenChange(false)} />
      </DrawerContent>
    </Drawer>
  )
}

type DayChoice = 'today' | 'yesterday' | 'other'

// A value as the field shows it: the language's decimal separator, no thousands separator, the
// tracker's decimals (an edit keeps up to the 2 the column stores).
const numberText = (n: number, decimals: number, most = decimals): string =>
  new Intl.NumberFormat(dateLocale(), { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, most), useGrouping: false }).format(n)

// Still being typed: a lone minus, or a separator with nothing after it yet ("1," or "-").
const halfTyped = (text: string) => /^[-−]?(\d*[.,])?$/.test(text.trim())
// Longer than the ten integer digits numeric(12, 2) holds.
const tooLong = (text: string) => /^[-−]?0*\d{11,}([.,]\d*)?$/.test(text.trim())
// Some browsers give a time field HH:MM:SS; the seconds are always zero here.
const timeOf = (s: string) => (/^\d{2}:\d{2}:\d{2}$/.test(s) ? s.slice(0, 5) : s)

type Start = { text: string; hours: string; minutes: string; option: string }

// Where the value fields start: the entry being edited, else the last value of the window (a label
// starts empty, so a tap never repeats the last option by accident).
function startOf(tracker: Tracker, entry: TrackerEntry | undefined): Start {
  const from = entry ?? useTrackers.getState().lastEntryOf(tracker.id)
  const start: Start = { text: '', hours: '', minutes: '', option: entry?.option ?? '' }
  if (!from) return start
  if (tracker.kind === 'number' && from.value != null) start.text = numberText(from.value, tracker.decimals ?? 0, entry ? 2 : undefined)
  if (tracker.kind === 'duration' && from.minutes != null) {
    start.hours = String(Math.floor(from.minutes / 60))
    start.minutes = String(from.minutes % 60)
  }
  return start
}

function SheetBody({ tracker, entry, quick, onDone }: { tracker: Tracker; entry?: TrackerEntry; quick: boolean; onDone: () => void }) {
  const timezone = useProfile(s => s.profile?.timezone)
  const now = useLocalNow(timezone)
  const [start] = useState(() => startOf(tracker, entry))
  const [text, setText] = useState(start.text)
  const [hours, setHours] = useState(start.hours)
  const [minutes, setMinutes] = useState(start.minutes)
  const [option, setOption] = useState(start.option)
  const [choice, setChoice] = useState<DayChoice>(() =>
    !entry || entry.day === now.today ? 'today' : entry.day === shiftDay(now.today, -1) ? 'yesterday' : 'other')
  const [otherDay, setOtherDay] = useState(entry?.day ?? shiftDay(now.today, -2))
  const [time, setTime] = useState(() => entry?.at.slice(0, 5) ?? fromMinutes(now.minutes))
  const [note, setNote] = useState(entry?.note ?? '')
  const [asking, setAsking] = useState(false)
  // The value field was left: a half-typed number may be warned about now.
  const [left, setLeft] = useState(false)
  // A fast second tap must not queue a second entry while the sheet closes.
  const saved = useRef(false)
  const id = useId()

  const earliest = shiftDay(now.today, -(WINDOW_DAYS - 1))
  const editing = !!entry

  // The value, as the kind asks for it; null while it is missing or not valid, with the reason.
  let value: number | null = null
  let minutesValue: number | null = null
  let problem: string | null = null
  if (tracker.kind === 'number') {
    // An edit that leaves the field as it started keeps the stored value, with all its decimals.
    const n = entry?.value != null && text === start.text ? entry.value : parseNumberInput(text, dateLocale(), tracker.decimals ?? 0)
    if (n === null && tooLong(text)) problem = t('That number is too big.')
    else if (text.trim() !== '' && n === null) problem = halfTyped(text) && !left ? null : t('Use only digits and one decimal separator, without a thousands separator.')
    else if (n !== null && Math.abs(n) >= VALUE_LIMIT) problem = t('That number is too big.')
    else value = n
  } else if (tracker.kind === 'duration') {
    const whole = (s: string) => (s.trim() === '' ? 0 : /^\d{1,4}$/.test(s.trim()) ? Number(s) : NaN)
    const total = whole(hours) * 60 + whole(minutes)
    if (hours.trim() === '' && minutes.trim() === '') problem = null
    else if (!Number.isInteger(total) || total < 1 || total > MAX_MINUTES) problem = t('The duration has to be between 1 minute and 24 hours.')
    else minutesValue = total
  }

  const dayProblem = !quick && choice === 'other'
    && !(/^\d{4}-\d{2}-\d{2}$/.test(otherDay) && otherDay <= now.today && (otherDay >= earliest || otherDay === entry?.day))
    ? t('Choose a day up to today and within the last 90 days.') : null
  const at = timeOf(time)
  const timeOk = quick || /^([01]\d|2[0-3]):[0-5]\d$/.test(at)
  const hasValue = tracker.kind === 'number' ? value !== null : tracker.kind === 'duration' ? minutesValue !== null : !!option
  const canGo = hasValue && !dayProblem && timeOk

  const save = (picked: string | null) => {
    if (saved.current) return
    saved.current = true
    // The moment of the tap, not of the render: a quick entry is "now".
    const moment = new Date()
    const today = todayIn(timezone, moment)
    const day = quick || choice === 'today' ? today : choice === 'yesterday' ? shiftDay(today, -1) : otherDay
    useTrackers.getState().saveEntry({
      ...(entry ? { id: entry.id } : {}),
      tracker_id: tracker.id, day,
      at: quick ? fromMinutes(minutesIn(timezone, moment)) : at,
      value: tracker.kind === 'number' ? value : null,
      minutes: tracker.kind === 'duration' ? minutesValue : null,
      option: tracker.kind === 'label' ? picked : null,
      note: quick ? null : note.trim() || null
    })
    toast(t('Entry saved'))
    onDone()
  }

  const submit = () => { if (canGo) save(option || null) }

  const remove = () => {
    if (!entry) return
    useTrackers.getState().deleteEntry(entry.id)
    toast(t('Entry deleted'))
    onDone()
  }

  const options = tracker.options ?? []
  const group = (label: string, gid: string, children: ReactNode) => (
    <div className="flex flex-col gap-2">
      <span id={gid} className="text-sm font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  )

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl [overflow-wrap:anywhere]">{quick ? tracker.name : editing ? t('Edit entry') : t('Add entry')}</DrawerTitle>
        <DrawerDescription className="[overflow-wrap:anywhere]">{quick ? t('Saved for today, at the current time.') : tracker.name}</DrawerDescription>
      </DrawerHeader>

      <form id="entry-sheet" className="flex flex-col gap-6 overflow-y-auto px-4 pb-4" noValidate onSubmit={e => { e.preventDefault(); submit() }}>
        {tracker.kind === 'number' && (
          <div className="flex flex-col gap-2">
            <label htmlFor={id + '-value'} className="text-sm font-medium text-muted-foreground">{t('Value')}</label>
            <div className="flex items-center gap-3">
              {/* The decimal keypad of iOS has no minus key. */}
              <Button type="button" variant="outline" size="icon" className={cn('size-11 shrink-0 rounded-xl text-lg', MONO)} aria-label={t('Change sign')}
                onClick={() => { setText(x => (/^\s*[-−]/.test(x) ? x.replace(/^\s*[-−]/, '') : '-' + x.trim())); setLeft(false) }}>
                <span aria-hidden>±</span>
              </Button>
              <Input id={id + '-value'} value={text} autoComplete="off" enterKeyHint="done" autoFocus={quick}
                inputMode={(tracker.decimals ?? 0) > 0 ? 'decimal' : 'numeric'} aria-invalid={!!problem} aria-describedby={problem ? id + '-problem' : undefined}
                className={cn('h-14 rounded-xl text-2xl', MONO)} onChange={e => { setText(e.target.value); setLeft(false) }} onBlur={() => setLeft(true)} />
              {tracker.unit && <span className={cn('shrink-0 text-lg text-muted-foreground [overflow-wrap:anywhere]', MONO)}>{tracker.unit}</span>}
            </div>
          </div>
        )}

        {tracker.kind === 'duration' && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <label htmlFor={id + '-hours'} className="text-sm font-medium text-muted-foreground">{t('Hours')}</label>
                <Input id={id + '-hours'} value={hours} inputMode="numeric" autoComplete="off" autoFocus={quick} aria-invalid={!!problem}
                  aria-describedby={problem ? id + '-problem' : undefined} className={cn('h-14 rounded-xl text-2xl', MONO)}
                  onChange={e => setHours(e.target.value)} />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor={id + '-minutes'} className="text-sm font-medium text-muted-foreground">{t('Minutes')}</label>
                <Input id={id + '-minutes'} value={minutes} inputMode="numeric" autoComplete="off" aria-invalid={!!problem}
                  aria-describedby={problem ? id + '-problem' : undefined} className={cn('h-14 rounded-xl text-2xl', MONO)}
                  onChange={e => setMinutes(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {problem && <p id={id + '-problem'} role="alert" className="-mt-3 text-sm leading-snug text-destructive">{problem}</p>}

        {tracker.kind === 'label' && quick && (
          <div className="grid grid-cols-2 gap-2">
            {options.map(o => (
              <Button key={o.id} type="button" variant="outline" className="h-12 min-w-0 rounded-xl px-3 text-[15px] [overflow-wrap:anywhere]"
                onClick={() => save(o.id)}>{o.text}</Button>
            ))}
          </div>
        )}

        {tracker.kind === 'label' && !quick && group(t('Option'), id + '-option', (
          <ToggleGroup type="single" variant="outline" spacing={2} className="grid w-full grid-cols-2" aria-labelledby={id + '-option'}
            value={option} onValueChange={v => v && setOption(v)}>
            {options.map(o => (
              <ToggleGroupItem key={o.id} value={o.id}
                className={cn('h-12 min-w-0 px-3 text-[15px] transition-colors duration-150 motion-reduce:transition-none [overflow-wrap:anywhere]', ON)}>{o.text}</ToggleGroupItem>
            ))}
          </ToggleGroup>
        ))}

        {!quick && (
          <>
            {group(t('Day'), id + '-day', (
              <>
                <ToggleGroup type="single" variant="outline" spacing={2} className="grid w-full grid-cols-3" aria-labelledby={id + '-day'}
                  value={choice} onValueChange={v => v && setChoice(v as DayChoice)}>
                  <ToggleGroupItem value="today" className={cn('h-12 min-w-0 px-2 text-[14px] transition-colors duration-150 motion-reduce:transition-none', ON)}>{t('Today')}</ToggleGroupItem>
                  <ToggleGroupItem value="yesterday" className={cn('h-12 min-w-0 px-2 text-[14px] transition-colors duration-150 motion-reduce:transition-none', ON)}>{t('Yesterday')}</ToggleGroupItem>
                  <ToggleGroupItem value="other" className={cn('h-12 min-w-0 px-2 text-[14px] transition-colors duration-150 motion-reduce:transition-none', ON)}>{t('Another day')}</ToggleGroupItem>
                </ToggleGroup>
                {choice === 'other' && (
                  <div className="flex flex-col gap-2">
                    <label htmlFor={id + '-date'} className="text-sm font-medium text-muted-foreground">{t('Date')}</label>
                    <Input id={id + '-date'} type="date" min={earliest} max={now.today} value={otherDay} aria-invalid={!!dayProblem}
                      aria-describedby={dayProblem ? id + '-day-problem' : undefined} className={cn(FIELD, MONO)} onChange={e => setOtherDay(e.target.value)} />
                    {dayProblem && <p id={id + '-day-problem'} role="alert" className="text-sm leading-snug text-destructive">{dayProblem}</p>}
                  </div>
                )}
              </>
            ))}

            <div className="flex flex-col gap-2">
              <label htmlFor={id + '-time'} className="text-sm font-medium text-muted-foreground">{t('Time of day')}</label>
              <Input id={id + '-time'} type="time" step={60} value={time} aria-invalid={!timeOk}
                aria-describedby={timeOk ? undefined : id + '-time-problem'} className={cn(FIELD, MONO)} onChange={e => setTime(e.target.value)} />
              {!timeOk && <p id={id + '-time-problem'} role="alert" className="text-sm leading-snug text-destructive">{t('Choose a time.')}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-1.5 text-sm text-muted-foreground">
                  <label htmlFor={id + '-note'} className="font-medium">{t('Note')}</label>
                  <span>· {t('Optional')}</span>
                </span>
                <span id={id + '-count'} className={cn('text-xs text-muted-foreground', MONO)}>{`${chars(note).length}/${NOTE_MAX}`}</span>
              </div>
              <textarea id={id + '-note'} rows={2} value={note} aria-describedby={id + '-count'}
                onChange={e => setNote(chars(e.target.value).slice(0, NOTE_MAX).join(''))}
                className="min-h-16 w-full resize-none rounded-xl border border-input bg-transparent px-3 py-2 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30" />
            </div>
          </>
        )}

        {entry && (asking ? (
          <div role="alertdialog" aria-labelledby={id + '-delete-q'} aria-describedby={id + '-delete-hint'} className="flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
            <div className="flex flex-col gap-1">
              <p id={id + '-delete-q'} className="text-[15px] font-semibold leading-snug">{t('Delete this entry?')}</p>
              <p id={id + '-delete-hint'} className="text-sm leading-snug text-muted-foreground">{t('It leaves your history and your statistics.')}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
              <Button type="button" variant="destructive" className="h-12 rounded-xl" onClick={remove}>{t('Delete entry')}</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="-mx-3 h-11 justify-start rounded-xl px-3 text-[15px] text-destructive hover:text-destructive"
            onClick={() => setAsking(true)}>
            {t('Delete entry')}
          </Button>
        ))}
      </form>

      <DrawerFooter className="flex-col gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {tracker.kind === 'label' && quick
          ? <Button type="button" variant="outline" className="h-12 rounded-xl text-[15px]" onClick={onDone}>{t('Cancel')}</Button>
          : <Button type="submit" form="entry-sheet" className="h-12 rounded-xl text-[15px] font-semibold" disabled={!canGo}>{t('Save')}</Button>}
      </DrawerFooter>
    </>
  )
}
