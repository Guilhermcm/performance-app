import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, EyeOff, LoaderCircle, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { todayISO } from '../../lib/format.js'
import { useProfile } from '../profile/useProfile'
import { ACCENT_TEXT } from '../gamification/components/accent'
import { useSocial } from './useSocial'
import { addDays } from './templates'
import { fmtShortDay, fmtTime } from './format'
import { InviteButton } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import type { FeedItem } from './types'

// A friend's custom exercise is not in this phone's catalogue (and its name is theirs): the
// record then shows without a name.
const exerciseName = (id: string): string | null => {
  const ex = (EXIDX as Record<string, unknown>)[id]
  return ex ? exerciseNameFor(ex) || null : null
}

const dayLabel = (day: string, today: string): string =>
  day === today ? t('Today') : day === addDays(today, -1) ? t('Yesterday') : fmtShortDay(day)

// Consecutive items of the same day under one heading (items come newest first).
function byDay(items: FeedItem[]): [string, FeedItem[]][] {
  const out: [string, FeedItem[]][] = []
  for (const i of items) {
    const last = out[out.length - 1]
    if (last && last[0] === i.day) last[1].push(i)
    else out.push([i.day, [i]])
  }
  return out
}

// Profile scrolls to the sharing switch and focuses it.
const SHARING = { state: { focus: 'share_activity' } }

// Workouts of friends who share them, newest first, 20 at a time, as a timeline by day.
export default function FeedPanel() {
  const navigate = useNavigate()
  const feed = useSocial(s => s.feed)
  const friends = useSocial(s => s.friends)
  const sharing = useProfile(s => s.profile?.share_activity ?? true)
  useEffect(() => {
    void useSocial.getState().loadFeed()
    void useSocial.getState().load('friends')
  }, [])
  const today = todayISO()
  const empty = feed.items.length === 0
  const openSharing = () => navigate('/perfil', SHARING)

  return (
    <section aria-labelledby="feed-title" className="flex flex-col gap-4">
      <h2 id="feed-title" className="sr-only">{t('Feed')}</h2>
      {!sharing && (
        <div className="flex gap-3 rounded-2xl bg-secondary/70 p-3">
          <EyeOff aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
            <p className="text-sm leading-snug">{t('Your workouts are hidden from friends.')}</p>
            <Button variant="outline" className="h-11 rounded-xl" onClick={openSharing}>{t('Turn on sharing')}</Button>
          </div>
        </div>
      )}
      <StaleNote stale={feed.stale} />
      {empty && feed.status === 'error' ? (
        <ErrorState code={feed.error ?? 'network'} onRetry={() => void useSocial.getState().loadFeed()} />
      ) : empty && feed.status !== 'ready' ? (
        <ListSkeleton />
      ) : empty ? (
        friends.data && friends.data.length === 0 ? (
          <EmptyState icon={Activity} title={t('Training together pays off')}
            body={t('Invite a friend with a link. Once they join, you both show up in the ranking.')}>
            <InviteButton />
          </EmptyState>
        ) : (
          <EmptyState icon={Activity} title={t('Nothing here yet')}
            body={t('Friends who turn on sharing in their profile show up here after each workout.')}>
            {sharing && <Button variant="outline" className="h-11 w-full rounded-xl" onClick={openSharing}>{t('Check your sharing')}</Button>}
          </EmptyState>
        )
      ) : (
        <ol className="flex list-none flex-col gap-5 p-0">
          {byDay(feed.items).map(([day, items], k) => (
            <li key={day + ':' + k}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{dayLabel(day, today)}</h3>
              <ol className="ml-2 flex list-none flex-col gap-3 border-l border-border p-0 pl-5">
                {items.map(i => <FeedRow key={i.id} item={i} />)}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {feed.next && (
        <Button variant="outline" className="h-12 gap-2 rounded-2xl" disabled={feed.busy} aria-busy={feed.busy}
          onClick={() => void useSocial.getState().loadFeed(true)}>
          {feed.busy && <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />}
          {feed.busy ? t('Loading…') : t('Load more')}
        </Button>
      )}
      {!feed.next && !empty && !feed.stale && <p className="text-center text-xs text-muted-foreground">{t('You are all caught up.')}</p>}
    </section>
  )
}

// Records with a name each get a chip; the ones without (custom exercises) share a single chip.
function prChips(prs: string[]): { key: string; text: string }[] {
  const named = prs.flatMap(ex => { const n = exerciseName(ex); return n ? [{ key: ex, text: t('PR: {0}', n) }] : [] })
  return named.length < prs.length ? [...named, { key: '?', text: t('New personal record') }] : named
}

function FeedRow({ item }: { item: FeedItem }) {
  const chips = prChips(item.prs)
  return (
    <li className="relative animate-in fade-in-0 duration-200 motion-reduce:animate-none">
      <span aria-hidden className="absolute -left-[1.6rem] top-4 size-2.5 rounded-full bg-primary ring-4 ring-background" />
      <article className="flex gap-3 rounded-2xl bg-card p-3">
        <PersonAvatar name={item.user.name} src={item.user.avatar_url} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium leading-snug break-words">{t('{0} finished a workout', item.user.name)}</p>
          <p className="mt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            <time dateTime={item.at}>{fmtTime(item.at)}</time>
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
    </li>
  )
}
