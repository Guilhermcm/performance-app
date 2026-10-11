import { useEffect, useState } from 'react'
import { Camera, Images, LoaderCircle, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { ACCENT_TEXT } from '../gamification/components/accent'
import { useCheckins } from '../checkin/useCheckins'
import { openCheckinCamera } from '../checkin/open-checkin'
import { fmtAgo } from './format'
import { InviteButton } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, StaleNote } from './components/states'
import { PostCard, PostSkeleton } from './PostCard'
import { CommentsSheet } from './Comments'
import { checkinIdOf } from './post-state'
import type { CheckinFeedItem, WorkoutFeedItem } from './types'

// A friend's custom exercise is not in this phone's catalogue (and its name is theirs): the
// record then shows without a name.
const exerciseName = (id: string): string | null => {
  const ex = (EXIDX as Record<string, unknown>)[id]
  return ex ? exerciseNameFor(ex) || null : null
}

// The photo feed (get_checkin_feed through the check-in store): my check-ins and my friends',
// newest first, 20 at a time, with the workouts from before the check-ins as they were.
export default function FeedPanel() {
  const feed = useCheckins(s => s.feed)
  const next = useCheckins(s => s.feedNext)
  const status = useCheckins(s => s.feedStatus)
  const stale = useCheckins(s => s.feedStale)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<CheckinFeedItem | null>(null)
  useEffect(() => { void useCheckins.getState().loadFeed() }, [])
  const empty = feed.length === 0

  const more = async () => {
    setBusy(true)
    try { await useCheckins.getState().loadFeed(true) } finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="feed-title" className="flex flex-col gap-4">
      <h2 id="feed-title" className="sr-only">{t('Feed')}</h2>
      <StaleNote stale={stale} />
      {empty && status === 'error' ? (
        <ErrorState code="network" onRetry={() => void useCheckins.getState().loadFeed()} />
      ) : empty && status !== 'ready' ? (
        <div className="flex flex-col gap-4"><PostSkeleton /><PostSkeleton /></div>
      ) : empty ? (
        <EmptyState icon={Images} title={t('Nothing here yet')} body={t('Your check-ins and your friends’ show up here.')}>
          <div className="flex flex-col gap-2">
            <Button className="h-12 w-full gap-2 rounded-2xl text-[15px] font-semibold" onClick={() => openCheckinCamera()}>
              <Camera aria-hidden className="size-5" />{t('Make your first check-in')}
            </Button>
            <InviteButton variant="outline" />
          </div>
        </EmptyState>
      ) : (
        <ol className="flex list-none flex-col gap-4 p-0">
          {feed.map(i => (
            <li key={i.key}>
              {i.type === 'checkin' ? <PostCard item={i} onOpen={setOpen} /> : <WorkoutRow item={i} />}
            </li>
          ))}
        </ol>
      )}
      {next && !empty && (
        <Button variant="outline" className="h-12 gap-2 rounded-2xl" disabled={busy} aria-busy={busy} onClick={() => void more()}>
          {busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {busy ? t('Loading…') : t('Load more')}
        </Button>
      )}
      {!next && !empty && !stale && <p className="text-center text-xs text-muted-foreground">{t('You are all caught up.')}</p>}
      <CommentsSheet id={open ? checkinIdOf(open) : null} item={open ?? undefined} onClose={() => setOpen(null)} />
    </section>
  )
}

// Records with a name each get a chip; the ones without (custom exercises) share a single chip.
function prChips(prs: string[]): { key: string; text: string }[] {
  const named = prs.flatMap(ex => { const n = exerciseName(ex); return n ? [{ key: ex, text: t('PR: {0}', n) }] : [] })
  return named.length < prs.length ? [...named, { key: '?', text: t('New personal record') }] : named
}

// A finished workout from before the check-ins (no photo), as the old feed showed it.
function WorkoutRow({ item }: { item: WorkoutFeedItem }) {
  const chips = prChips(item.prs)
  return (
    <article className="flex gap-3 rounded-2xl bg-card p-3 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <PersonAvatar name={item.user.name} src={item.user.avatar_url} className="size-10" />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-snug break-words">{t('{0} finished a workout', item.user.name)}</p>
        <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
          <time dateTime={item.at}>{fmtAgo(item.at)}</time>
          {item.sets !== null && <> · {t('{0} sets', item.sets)}</>}
        </p>
        {chips.length > 0 && (
          <ul className="mt-2 flex list-none flex-wrap gap-1.5 p-0">
            {chips.map(c => (
              <li key={c.key} className={cn('flex min-h-7 items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium', ACCENT_TEXT)}>
                <Trophy aria-hidden className="size-3.5 shrink-0" />{c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
