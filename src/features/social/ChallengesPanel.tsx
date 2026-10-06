import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Plus, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { todayISO } from '../../lib/format.js'
import { useSocial } from './useSocial'
import { MODE_TEXT, TEMPLATE_TEXT } from './labels'
import { canJoin, challengeShare, daysLeft, resultOn } from './templates'
import { fmtShortDay } from './format'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import { ACCENT_TEXT } from '../gamification/components/accent'
import NewChallengeSheet from './NewChallengeSheet'
import { InviteButton } from './InviteButton'
import type { Challenge } from './types'

// Where a challenge stands, in a few words.
export function statusLine(c: Challenge, today: string): string {
  if (c.status === 'won') return c.me.won === false ? t('Not this time') : t('Completed')
  if (c.status === 'lost') return t('Not this time')
  if (c.status === 'cancelled') return t('Cancelled')
  if (c.starts_on > today) return t('Starts {0}', fmtShortDay(c.starts_on))
  // Past the last day, waiting for the server to close it (two more days for nutrition).
  if (today > c.ends_on) return t('Result on {0}', fmtShortDay(resultOn(c)))
  return daysLeft(c, today) <= 1 ? t('Ends today') : t('{0} days left', daysLeft(c, today))
}

// Invitations first (they wait for an answer), then what is running, then what ended.
export default function ChallengesPanel() {
  const res = useSocial(s => s.challenges)
  const friends = useSocial(s => s.friends)
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(params.get('novo') === '1')
  useEffect(() => {
    void useSocial.getState().load('challenges')
    void useSocial.getState().load('friends')
    if (params.get('novo')) setParams({}, { replace: true })
  }, [])
  const today = todayISO()
  const list = res.data
  const hasFriends = (friends.data?.length ?? 0) > 0
  const groups: [string, Challenge[]][] = list ? [
    [t('Invitations'), list.filter(c => canJoin(c, today))],
    [t('In progress'), list.filter(c => c.status === 'active' && c.me.joined)],
    // An invitation nobody joined in time can only be declined: it waits here for the server to close it.
    [t('Finished'), list.filter(c => c.status !== 'active' || (!c.me.joined && !canJoin(c, today)))]
  ] : []

  return (
    <section aria-labelledby="challenges-title" className="flex flex-col gap-5">
      <h2 id="challenges-title" className="sr-only">{t('Challenges')}</h2>
      <div className="flex flex-col gap-2">
        <Button className="h-12 w-full gap-2 rounded-2xl text-[15px] font-semibold active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
          disabled={!hasFriends} onClick={() => setCreating(true)}>
          <Plus aria-hidden className="size-5" />{t('New challenge')}
        </Button>
        {friends.data && !hasFriends && <p className="text-center text-sm text-muted-foreground">{t('Add a friend to create challenges.')}</p>}
      </div>
      <StaleNote stale={res.stale} />
      {!list ? (
        res.status === 'error' && res.error
          ? <ErrorState code={res.error} onRetry={() => void useSocial.getState().load('challenges')} />
          : <ListSkeleton rows={3} />
      ) : list.length === 0 ? (
        <EmptyState icon={Swords} title={t('No challenges yet')}
          body={t('Bring friends together around a goal with a deadline. Everyone who completes it earns 300 XP.')}>
          {friends.data && !hasFriends && <InviteButton />}
        </EmptyState>
      ) : (
        groups.filter(([, items]) => items.length > 0).map(([title, items]) => (
          <section key={title} aria-label={title} className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h3>
            <ul className="flex list-none flex-col gap-2 p-0">
              {items.map(c => <li key={c.id}><ChallengeCard c={c} today={today} /></li>)}
            </ul>
          </section>
        ))
      )}
      <NewChallengeSheet open={creating} onClose={() => setCreating(false)} />
    </section>
  )
}

function ChallengeCard({ c, today }: { c: Challenge; today: string }) {
  const navigate = useNavigate()
  const Icon = TEMPLATE_TEXT[c.template].icon
  const invited = canJoin(c, today)
  return (
    <button type="button" onClick={() => navigate('/social/desafios/' + c.id)}
      className={cn('flex w-full flex-col gap-3 rounded-2xl border bg-card p-4 text-left outline-none transition-colors duration-150 hover:bg-secondary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50',
        invited ? 'border-primary/40' : 'border-border')}>
      <span className="flex items-start gap-3">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15', ACCENT_TEXT)}><Icon aria-hidden className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-[15px] font-semibold leading-snug">{c.title}</span>
          <span className="block text-xs text-muted-foreground">{MODE_TEXT[c.mode].name()} · {statusLine(c, today)}</span>
        </span>
        <ChevronRight aria-hidden className="mt-1.5 size-4 shrink-0 text-muted-foreground" />
      </span>
      {/* Below the name, so a long title keeps the width: the invite or the bar, then who is in. */}
      <span className="flex items-center gap-3">
        {invited ? (
          <span className={cn('min-w-0 flex-1 text-sm font-medium', ACCENT_TEXT)}>{t('{0} invited you', c.invited_by ?? '')}</span>
        ) : c.status === 'active' && c.me.joined ? (
          <span aria-hidden className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-primary/15">
            <span className="block h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
              style={{ width: `${challengeShare(c) * 100}%` }} />
          </span>
        ) : <span className="flex-1" />}
        <span aria-hidden className="flex shrink-0 -space-x-2">
          {c.members.filter(m => m.joined).slice(0, 3).map(m => (
            <PersonAvatar key={m.id} name={m.name} src={m.avatar_url} className="size-7 ring-2 ring-card" />
          ))}
        </span>
      </span>
    </button>
  )
}
