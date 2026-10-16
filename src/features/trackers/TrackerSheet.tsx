import { useEffect, useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { MAX_ACTIVE_TRACKERS, useTrackers } from './useTrackers'
import { toTrackerError } from './trackers-api'
import { HABIT_ICONS, iconFor } from '../habits/icons'
import { iconLabel } from '../habits/labels'
import type { Aggregate, Tracker, TrackerKind, TrackerOption } from './types'

// Spec 8.1: a name of 1 to 40 characters (trimmed), a unit of up to 12, 2 to 8 options of up to 24.
const NAME_MAX = 40
const UNIT_MAX = 12
const OPTION_MAX = 24
const OPTIONS_MIN = 2
const OPTIONS_MAX = 8
const DEFAULT_ICON = 'check'
const DECIMALS = [0, 1, 2]
const KINDS: TrackerKind[] = ['number', 'duration', 'label']

const ON = 'data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary'

// Characters as people count them (and as the server's char_length does), not UTF-16 units.
const chars = (s: string) => Array.from(s)
const cut = (s: string, max: number) => chars(s).slice(0, max).join('')

// Plan decision 1: 8 characters of a-z0-9; the server checks ^[a-z0-9]{1,16}$ and that they are distinct.
const newOptionId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 8)

export const fullText = () => t('You already have {0} active trackers, the most allowed. Archive one to make room.', MAX_ACTIVE_TRACKERS)

// The kind in words. Functions, so each t() stays a literal the source-string check can see.
const KIND_NAME: Record<TrackerKind, () => string> = {
  number: () => t('Number'),
  duration: () => t('Duration'),
  label: () => t('Choice')
}
const KIND_HINT: Record<TrackerKind, () => string> = {
  number: () => t('A value you type, like weight or liters.'),
  duration: () => t('Time spent, in hours and minutes.'),
  label: () => t('One pick from a list you write, like mood.')
}

type Props = { tracker?: Tracker; open: boolean; onOpenChange: (open: boolean) => void; onSaved?: (tracker: Tracker) => void }

// Creating and editing a tracker (spec 8.1 and 8.4): name, icon, the kind (only when creating) and the
// fields of the kind. An archived tracker can be edited and brought back; an active one can be
// archived after a confirmation.
export default function TrackerSheet({ tracker, open, onOpenChange, onSaved }: Props) {
  // A fresh form each time the sheet opens; the closing animation keeps the last one.
  const [session, setSession] = useState(0)
  useEffect(() => { if (open) setSession(n => n + 1) }, [open])
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]">
        <SheetBody key={session} tracker={tracker} onSaved={onSaved} onDone={() => onOpenChange(false)} />
      </DrawerContent>
    </Drawer>
  )
}

const blankOptions = (): TrackerOption[] => Array.from({ length: OPTIONS_MIN }, () => ({ id: newOptionId(), text: '' }))

function SheetBody({ tracker, onSaved, onDone }: { tracker?: Tracker; onSaved?: (tracker: Tracker) => void; onDone: () => void }) {
  const activeCount = useTrackers(s => s.trackers.filter(x => !x.archived_at).length)
  const entries = useTrackers(s => s.entries)
  const [name, setName] = useState(tracker?.name ?? '')
  const [icon, setIcon] = useState(tracker && HABIT_ICONS.includes(tracker.icon) ? tracker.icon : DEFAULT_ICON)
  const [kind, setKind] = useState<TrackerKind>(tracker?.kind ?? 'number')
  const [unit, setUnit] = useState(tracker?.unit ?? '')
  const [decimals, setDecimals] = useState(tracker?.decimals ?? 0)
  const [aggregate, setAggregate] = useState<Aggregate>(tracker?.aggregate ?? 'sum')
  const [options, setOptions] = useState<TrackerOption[]>(() => (tracker?.options ? tracker.options.map(o => ({ ...o })) : blankOptions()))
  const [asking, setAsking] = useState(false)
  const id = useId()

  const creating = !tracker
  const archived = !!tracker?.archived_at
  // Creating and reactivating both add an active tracker: the 30 limit applies.
  const adds = creating || archived
  const full = adds && activeCount >= MAX_ACTIVE_TRACKERS
  const trimmed = name.trim()

  // The options with entries in the window (plan decision 8) cannot be removed; the server has the last word.
  const inUse = useMemo(() => new Set(tracker ? entries.filter(e => e.tracker_id === tracker.id && e.option).map(e => e.option) : []), [entries, tracker])
  const texts = options.map(o => o.text.trim())
  const optionsOk = kind !== 'label' || (options.length >= OPTIONS_MIN && texts.every(x => x.length > 0))

  const canGo = trimmed.length > 0 && optionsOk && !full

  const fields = () => ({
    name: trimmed, icon, kind,
    unit: kind === 'number' ? unit.trim() || null : null,
    decimals: kind === 'number' ? decimals : null,
    aggregate: kind === 'label' ? null : aggregate,
    options: kind === 'label' ? options.map((o, i) => ({ id: o.id, text: texts[i] })) : null
  })

  const changed = (() => {
    if (!tracker) return true
    const f = fields()
    return f.name !== tracker.name || f.icon !== tracker.icon || f.unit !== tracker.unit || f.decimals !== tracker.decimals
      || f.aggregate !== tracker.aggregate || JSON.stringify(f.options) !== JSON.stringify(tracker.options)
  })()

  const submit = () => {
    if (!canGo) return
    const { saveTracker, reactivateTracker } = useTrackers.getState()
    try {
      if (!tracker) {
        const saved = saveTracker(fields())
        toast(t('Tracker created'))
        onSaved?.(saved)
      } else if (archived) {
        // The edits first, then it comes back.
        const saved = changed ? saveTracker({ id: tracker.id, ...fields() }) : tracker
        reactivateTracker(tracker.id)
        toast(t('Tracker reactivated'))
        onSaved?.(saved)
      } else if (changed) {
        const saved = saveTracker({ id: tracker.id, ...fields() })
        toast(t('Saved'))
        onSaved?.(saved)
      }
      onDone()
    } catch (e) {
      // The store refuses a 31st active tracker at once; the server's other refusals come back later, outside the sheet.
      toast(toTrackerError(e) === 'too_many_trackers' ? fullText() : t('Could not save. Your previous values were kept.'))
    }
  }

  const archive = () => {
    if (!tracker) return
    useTrackers.getState().archiveTracker(tracker.id)
    toast(t('Tracker archived'))
    onDone()
  }

  const setText = (i: number, text: string) => setOptions(list => list.map((o, k) => (k === i ? { ...o, text: cut(text, OPTION_MAX) } : o)))
  const swap = (i: number, j: number) => setOptions(list => {
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })
  const remove = (i: number) => setOptions(list => list.filter((_, k) => k !== i))
  const add = () => setOptions(list => {
    let optionId = newOptionId()
    while (list.some(o => o.id === optionId)) optionId = newOptionId()
    return [...list, { id: optionId, text: '' }]
  })

  const small = 'size-11 shrink-0 rounded-xl'

  return (
    <>
      <DrawerHeader className="text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
        <DrawerTitle className="text-xl">{creating ? t('New tracker') : t('Edit tracker')}</DrawerTitle>
        <DrawerDescription>{t('Choose a name, an icon and what you want to record.')}</DrawerDescription>
      </DrawerHeader>

      <form id="tracker-sheet" className="flex flex-col gap-6 overflow-y-auto px-4 pb-4" onSubmit={e => { e.preventDefault(); submit() }}>
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor={id + '-name'} className="text-sm font-medium text-muted-foreground">{t('Name')}</label>
            <span id={id + '-count'} className="font-mono text-xs tabular-nums text-muted-foreground">{`${chars(name).length}/${NAME_MAX}`}</span>
          </div>
          <Input id={id + '-name'} value={name} autoComplete="off" enterKeyHint="done" aria-describedby={id + '-count'}
            className="h-12 rounded-xl text-[15px]"
            onChange={e => setName(cut(e.target.value, NAME_MAX))} />
        </div>

        <div className="flex flex-col gap-2">
          <span id={id + '-icon'} className="text-sm font-medium text-muted-foreground">{t('Icon')}</span>
          <div role="group" aria-labelledby={id + '-icon'} className="grid grid-cols-6 gap-2">
            {HABIT_ICONS.map(key => {
              const Icon = iconFor(key)
              const on = key === icon
              return (
                <button key={key} type="button" aria-label={iconLabel(key)} aria-pressed={on} onClick={() => setIcon(key)}
                  className={cn('flex h-12 items-center justify-center rounded-xl border outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none',
                    on ? 'border-primary bg-primary text-primary-foreground ring-2 ring-primary/40 ring-offset-2 ring-offset-background' : 'border-border bg-card text-foreground hover:bg-secondary')}>
                  <Icon aria-hidden className="size-5" />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span id={id + '-kind'} className="text-sm font-medium text-muted-foreground">{t('Type')}</span>
          {creating ? (
            <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby={id + '-kind'}
              value={kind} onValueChange={v => v && setKind(v as TrackerKind)}>
              {KINDS.map(k => (
                <ToggleGroupItem key={k} value={k} aria-label={KIND_NAME[k]()}
                  className={cn('h-12 min-w-11 flex-1 px-2 text-[15px] transition-colors duration-150', ON)}>{KIND_NAME[k]()}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : (
            <p className="flex h-12 items-center rounded-xl border border-border bg-secondary/50 px-3 text-[15px]">{KIND_NAME[kind]()}</p>
          )}
          <p className="text-sm leading-snug text-muted-foreground">{creating ? KIND_HINT[kind]() : t('The type cannot change after the tracker is created.')}</p>
        </div>

        {kind === 'number' && (
          <>
            <div className="flex flex-col gap-2">
              <label htmlFor={id + '-unit'} className="text-sm font-medium text-muted-foreground">{t('Unit (optional)')}</label>
              <Input id={id + '-unit'} value={unit} autoComplete="off" enterKeyHint="done" className="h-12 rounded-xl text-[15px]"
                onChange={e => setUnit(cut(e.target.value, UNIT_MAX))} />
            </div>
            <div className="flex flex-col gap-2">
              <span id={id + '-dec'} className="text-sm font-medium text-muted-foreground">{t('Decimal places')}</span>
              <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby={id + '-dec'}
                value={String(decimals)} onValueChange={v => v && setDecimals(Number(v))}>
                {DECIMALS.map(n => (
                  <ToggleGroupItem key={n} value={String(n)}
                    className={cn('h-12 min-w-11 flex-1 px-0 font-mono text-base tabular-nums transition-colors duration-150', ON)}>{n}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </>
        )}

        {kind !== 'label' && (
          <div className="flex flex-col gap-2">
            <span id={id + '-agg'} className="text-sm font-medium text-muted-foreground">{t('How each day is counted')}</span>
            <ToggleGroup type="single" variant="outline" className="w-full" aria-labelledby={id + '-agg'}
              value={aggregate} onValueChange={v => v && setAggregate(v as Aggregate)}>
              <ToggleGroupItem value="sum" className={cn('h-12 min-w-11 flex-1 px-2 text-[15px] transition-colors duration-150', ON)}>{t('Sum')}</ToggleGroupItem>
              <ToggleGroupItem value="avg" className={cn('h-12 min-w-11 flex-1 px-2 text-[15px] transition-colors duration-150', ON)}>{t('Average')}</ToggleGroupItem>
            </ToggleGroup>
            <p aria-live="polite" className="text-sm leading-snug text-muted-foreground">
              {aggregate === 'sum' ? t('The day shows the total of its entries.') : t('The day shows the average of its entries.')}
            </p>
          </div>
        )}

        {kind === 'label' && (
          <div className="flex flex-col gap-2">
            <span id={id + '-opts'} className="text-sm font-medium text-muted-foreground">{t('Options')}</span>
            <div role="group" aria-labelledby={id + '-opts'} className="flex flex-col gap-3">
              {options.map((o, i) => {
                const locked = inUse.has(o.id)
                const tooFew = options.length <= OPTIONS_MIN
                return (
                  <div key={o.id} role="group" aria-label={t('Option {0}', i + 1)} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1">
                      <Input value={o.text} autoComplete="off" enterKeyHint="done" aria-label={t('Name of option {0}', i + 1)}
                        className="h-12 min-w-0 flex-1 rounded-xl text-[15px]" onChange={e => setText(i, e.target.value)} />
                      <Button type="button" variant="ghost" size="icon" className={small} aria-label={t('Move up')} disabled={i === 0}
                        onClick={() => swap(i, i - 1)}><ChevronUp aria-hidden className="size-5" /></Button>
                      <Button type="button" variant="ghost" size="icon" className={small} aria-label={t('Move down')} disabled={i === options.length - 1}
                        onClick={() => swap(i, i + 1)}><ChevronDown aria-hidden className="size-5" /></Button>
                      <Button type="button" variant="ghost" size="icon" className={cn(small, 'text-destructive hover:text-destructive')} aria-label={t('Remove option')}
                        aria-describedby={locked ? `${id}-lock-${o.id}` : undefined} disabled={locked || tooFew} onClick={() => remove(i)}>
                        <Trash2 aria-hidden className="size-5" />
                      </Button>
                    </div>
                    {locked && (
                      <p id={`${id}-lock-${o.id}`} className="text-sm leading-snug text-muted-foreground">
                        {t('This option has entries in the last 90 days, so it cannot be removed.')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-sm leading-snug text-muted-foreground">{t('Between 2 and 8 options.')}</p>
            {!optionsOk && <p role="status" className="text-sm leading-snug text-muted-foreground">{t('Write a name for every option.')}</p>}
            {options.length < OPTIONS_MAX && (
              <Button type="button" variant="outline" className="h-11 justify-start rounded-xl px-3 text-[15px]" onClick={add}>
                <Plus aria-hidden className="size-4" />{t('Add option')}
              </Button>
            )}
          </div>
        )}

        {tracker && !archived && (asking ? (
          <div role="alertdialog" aria-labelledby={id + '-archive-q'} aria-describedby={id + '-archive-hint'} className="flex flex-col gap-3 rounded-2xl bg-secondary/70 p-4">
            <div className="flex flex-col gap-1">
              <p id={id + '-archive-q'} className="text-[15px] font-semibold leading-snug">{t('Archive this tracker?')}</p>
              <p id={id + '-archive-hint'} className="text-sm leading-snug text-muted-foreground">
                {t('It leaves your list and takes no new entries. Its history stays, and you can reactivate it any time.')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-12 rounded-xl" onClick={() => setAsking(false)}>{t('Cancel')}</Button>
              <Button type="button" variant="destructive" className="h-12 rounded-xl" onClick={archive}>{t('Archive')}</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="-mx-3 h-11 justify-start rounded-xl px-3 text-[15px] text-destructive hover:text-destructive"
            onClick={() => setAsking(true)}>
            {t('Archive tracker')}
          </Button>
        ))}
      </form>

      <DrawerFooter className="flex-col gap-2 border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {full && <p role="status" className="text-sm leading-snug text-muted-foreground">{fullText()}</p>}
        <Button type="submit" form="tracker-sheet" className="h-12 rounded-xl text-[15px] font-semibold" disabled={!canGo}>
          {creating ? t('Create tracker') : archived ? t('Reactivate') : t('Save')}
        </Button>
      </DrawerFooter>
    </>
  )
}
