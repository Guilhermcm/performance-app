import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, CloudOff, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useOnline } from '@/lib/use-online'
import { cn } from '@/lib/utils'
import { dateLocale, t } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { useLocalNow } from '../sleep/use-local-now'
import { SLEEP_CARD as CARD } from '../sleep/card'
import { iconFor } from '../habits/icons'
import { useTrackers } from './useTrackers'
import { formatValue, whenText } from './format'
import { useDroppedNotice } from './useDroppedNotice'
import TrackerSheet from './TrackerSheet'
import EntrySheet from './EntrySheet'
import type { Tracker, TrackerEntry } from './types'

// /trackers (spec 8.4): the active trackers in their order with the last value, a plus button for
// the quick entry, the arrows that reorder, and the archived ones last. Opens from the Profile and
// from the top of /habitos.
export default function TrackersScreen() {
  const navigate = useNavigate()
  const profile = useProfile(s => s.profile)
  const online = useOnline()
  const status = useTrackers(s => s.status)
  useDroppedNotice()

  const goBack = () => (window.history.state?.idx > 0 ? navigate(-1) : navigate('/home'))
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">
      <header className="flex flex-col">
        <div className="-ml-2 flex h-11 items-center">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Back')} onClick={goBack}>
            <ArrowLeft aria-hidden className="size-5 rtl:rotate-180" />
          </Button>
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('Trackers')}</h1>
      </header>
      {!online && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CloudOff aria-hidden className="size-3.5 shrink-0" />{t('Offline. What you log stays on this phone and syncs when you reconnect.')}
        </p>
      )}
      {status === 'idle' || status === 'loading'
        ? <ScreenSkeleton />
        : <Trackers key={profile?.id} timezone={profile?.timezone} failed={status === 'error'} />}
    </div>
  )
}

// Everything under the header once the store has answered. `failed`: the first pull failed with no
// saved copy; a tracker made on this phone still shows, the rest offers a retry.
function Trackers({ timezone, failed }: { timezone: string | null | undefined; failed: boolean }) {
  const navigate = useNavigate()
  const { today } = useLocalNow(timezone)
  const trackers = useTrackers(s => s.trackers)
  const entries = useTrackers(s => s.entries)
  const move = useTrackers(s => s.move)
  const [sheet, setSheet] = useState<{ tracker?: Tracker; open: boolean }>({ open: false })
  const [entry, setEntry] = useState<{ tracker: Tracker | null; open: boolean }>({ tracker: null, open: false })
  const [showArchived, setShowArchived] = useState(false)

  const active = trackers.filter(x => !x.archived_at)
  const archived = trackers.filter(x => x.archived_at)
  const create = () => setSheet({ open: true })
  // The newest entry of each tracker in the window (the entries come oldest first).
  const last = new Map<string, TrackerEntry>()
  for (const e of entries) last.set(e.tracker_id, e)

  return (
    <>
      {failed && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5">
          <p className="text-[15px] font-medium leading-snug">{t('Could not load your trackers.')}</p>
          <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void useTrackers.getState().refresh()}>
            <RefreshCw aria-hidden className="size-4" />{t('Try again')}
          </Button>
        </div>
      )}

      {active.length > 0 ? (
        <div className="flex flex-col gap-2">
          <ul aria-label={t('Your trackers')} className={cn(CARD, 'px-2 py-1')}>
            {active.map((x, i) => (
              <TrackerRow key={x.id} tracker={x} last={last.get(x.id) ?? null} today={today}
                canMove={{ up: i > 0, down: i < active.length - 1 }}
                onMove={delta => move(x.id, delta)}
                onOpen={() => navigate(`/trackers/${x.id}`)}
                onAdd={() => setEntry({ tracker: x, open: true })} />
            ))}
          </ul>
          <Button variant="outline" className="h-12 gap-2 rounded-xl text-[15px]" onClick={create}>
            <Plus aria-hidden className="size-4" />{t('New tracker')}
          </Button>
        </div>
      ) : !failed && (
        // With only archived trackers this is not a first one: plain words, and the archived below.
        <section className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-10 text-center">
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground text-pretty">
            {archived.length ? t('You have no active trackers.') : t('Follow what matters to you, like weight, water or mood, and log it in one tap.')}
          </p>
          <Button className="mt-1 h-12 w-full max-w-xs gap-2 rounded-xl text-[15px]" onClick={create}>
            <Plus aria-hidden className="size-4" />{archived.length ? t('New tracker') : t('Create your first tracker')}
          </Button>
        </section>
      )}

      {archived.length > 0 && (
        <section aria-labelledby="trackers-archived-title" className="flex flex-col gap-2 pt-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            <button type="button" aria-expanded={showArchived} aria-controls="trackers-archived-list" onClick={() => setShowArchived(v => !v)}
              className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2 rounded-xl px-2 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none">
              <span id="trackers-archived-title">{t('Archived')}</span>
              <span className="font-mono tabular-nums">{archived.length}</span>
              {showArchived ? <ChevronUp aria-hidden className="ml-auto size-4" /> : <ChevronDown aria-hidden className="ml-auto size-4" />}
            </button>
          </h2>
          {showArchived && (
            <ul id="trackers-archived-list" className={cn(CARD, 'px-2 py-1')}>
              {archived.map(x => <ArchivedRow key={x.id} tracker={x} onOpen={() => navigate(`/trackers/${x.id}`)} />)}
            </ul>
          )}
        </section>
      )}

      <TrackerSheet tracker={sheet.tracker} open={sheet.open} onOpenChange={open => setSheet(s => ({ ...s, open }))} />
      {/* The sheet keeps the tracker it was opened with while it closes. */}
      {entry.tracker && (
        <EntrySheet tracker={entry.tracker} mode="quick" open={entry.open} onOpenChange={open => setEntry(s => ({ ...s, open }))} />
      )}
    </>
  )
}

// The last value and when it was: "1,8 L hoje", "bom ontem"; a tracker with nothing in the window
// of 90 days says so.
function lastText(tracker: Tracker, last: TrackerEntry | null, today: string): string {
  if (!last) return t('Nothing in the last 90 days')
  const when = whenText(last.day, today)
  const text = tracker.kind === 'label'
    ? tracker.options?.find(o => o.id === last.option)?.text
    : formatValue(tracker, (tracker.kind === 'duration' ? last.minutes : last.value) ?? 0, dateLocale())
  return text ? `${text} ${when}` : when
}

function TrackerIcon({ icon, muted }: { icon: string; muted?: boolean }) {
  const Icon = iconFor(icon)
  return (
    <span aria-hidden className={cn('grid size-9 shrink-0 place-items-center rounded-xl bg-secondary text-foreground', muted && 'opacity-70')}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </span>
  )
}

const ROW_BUTTON = 'flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left outline-none transition-colors duration-150 hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none'

// One active tracker: icon, name and last value (a button to the detail), the plus for a quick
// entry, and the arrows that reorder it (no dragging).
function TrackerRow({ tracker, last, today, canMove, onMove, onOpen, onAdd }: {
  tracker: Tracker; last: TrackerEntry | null; today: string
  canMove: { up: boolean; down: boolean }; onMove: (delta: -1 | 1) => void; onOpen: () => void; onAdd: () => void
}) {
  return (
    <li className="flex items-center gap-1 border-b border-border px-2 py-2 last:border-b-0">
      <button type="button" onClick={onOpen} className={cn(ROW_BUTTON, '-ml-1')}>
        <TrackerIcon icon={tracker.icon} />
        <span className="min-w-0 flex-1">
          <span data-testid="tracker-name" className="block truncate text-[15px] font-medium leading-snug">{tracker.name}</span>
          <span className={cn('block truncate text-sm tabular-nums', last ? 'text-muted-foreground' : 'text-muted-foreground/80')}>{lastText(tracker, last, today)}</span>
        </span>
      </button>
      <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Log for {0}', tracker.name)} onClick={onAdd}>
        <Plus aria-hidden className="size-5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Move {0} up', tracker.name)}
        disabled={!canMove.up} onClick={() => onMove(-1)}>
        <ChevronUp aria-hidden className="size-5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Move {0} down', tracker.name)}
        disabled={!canMove.down} onClick={() => onMove(1)}>
        <ChevronDown aria-hidden className="size-5" />
      </Button>
    </li>
  )
}

// An archived tracker: no plus (the server takes no new entries there). Its detail keeps the
// entries editable and offers to reactivate it.
function ArchivedRow({ tracker, onOpen }: { tracker: Tracker; onOpen: () => void }) {
  return (
    <li className="flex items-center gap-2 border-b border-border px-2 py-2 last:border-b-0">
      <button type="button" onClick={onOpen} className={cn(ROW_BUTTON, '-ml-1 text-muted-foreground')}>
        <TrackerIcon icon={tracker.icon} muted />
        <span className="block min-w-0 truncate text-[15px]">{tracker.name}</span>
      </button>
    </li>
  )
}

// The shape of the screen while the first load runs: rows like TrackerRow (60 px: icon, name and
// last value, then the plus and the two arrows at 44 px).
function ScreenSkeleton() {
  return (
    <div data-testid="trackers-skeleton" role="status" aria-busy="true" aria-label={t('Loading…')} className="flex flex-col gap-2">
      <div className={cn(CARD, 'px-2 py-1')}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} data-testid="trackers-skeleton-row" className="flex min-h-[60px] items-center gap-1 border-b border-border px-2 py-2 last:border-b-0">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-1">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-28" /><Skeleton className="h-3.5 w-36" /></div>
            </div>
            {[0, 1, 2].map(j => <Skeleton key={j} className="size-11 shrink-0 rounded-full" />)}
          </div>
        ))}
      </div>
      <Skeleton className="h-12 rounded-xl" />
    </div>
  )
}
