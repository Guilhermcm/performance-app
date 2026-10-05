import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Trophy } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { fmtInt } from '../gamification/format'
import { ACCENT_TEXT } from '../gamification/components/accent'
import { useSocial } from './useSocial'
import { InviteButton } from './InviteButton'
import { PersonAvatar } from './components/PersonAvatar'
import { EmptyState, ErrorState, ListSkeleton, StaleNote } from './components/states'
import type { LeaderboardRow } from './types'

type Board = 'weekly' | 'alltime'

const TAB = 'h-11 rounded-xl text-sm font-medium data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm'

// This week (default) or all time: position, photo, name, level, movement since last week and
// XP. My row is highlighted and the gap to the next person above is spelled out under the list.
export default function RankingPanel() {
  const [board, setBoard] = useState<Board>('weekly')
  const res = useSocial(s => s[board])
  useEffect(() => { void useSocial.getState().load(board) }, [board])
  const rows = res.data?.rows ?? null
  const me = rows?.find(r => r.me) ?? null
  const above = me && rows ? rows.filter(r => r.xp > me.xp).sort((a, b) => a.xp - b.xp)[0] ?? null : null

  return (
    <section aria-labelledby="ranking-title" className="flex flex-col gap-4">
      <h2 id="ranking-title" className="sr-only">{t('Ranking')}</h2>
      <ToggleGroup type="single" value={board} onValueChange={v => { if (v) setBoard(v as Board) }} aria-label={t('Ranking')}
        className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-secondary/60 p-1">
        <ToggleGroupItem value="weekly" className={TAB}>{t('This week')}</ToggleGroupItem>
        <ToggleGroupItem value="alltime" className={TAB}>{t('All time')}</ToggleGroupItem>
      </ToggleGroup>
      <p className="-mt-1 text-xs leading-snug text-muted-foreground text-pretty">
        {board === 'weekly'
          ? t('Resets every Monday. Any plan pays up to 960 XP a week, so it is fair for everyone.')
          : t('By total XP since the start.')}
      </p>
      <StaleNote stale={res.stale} />
      {!rows ? (
        res.status === 'error' && res.error
          ? <ErrorState code={res.error} onRetry={() => void useSocial.getState().load(board)} />
          : <ListSkeleton rows={3} />
      ) : (
        <>
          <ol className="flex list-none flex-col gap-2 p-0 animate-in fade-in-0 duration-200 motion-reduce:animate-none">
            {rows.map(r => <RankRow key={r.id} row={r} />)}
          </ol>
          {me && rows.length > 1 && (
            <p className="text-center text-sm tabular-nums text-muted-foreground text-pretty">
              {above && me.gap !== null ? t('{0} XP to pass {1}', fmtInt(me.gap), above.name) : t('You are in the lead.')}
            </p>
          )}
          {rows.length <= 1 && (
            <EmptyState icon={Trophy} title={t('Rankings are better with company')}
              body={t('Invite friends to compete for the week. Only friends see where you stand.')}>
              <InviteButton />
            </EmptyState>
          )}
        </>
      )}
    </section>
  )
}

function RankRow({ row }: { row: LeaderboardRow }) {
  return (
    <li aria-current={row.me ? 'true' : undefined}
      className={cn('flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2', row.me ? 'bg-primary/10 ring-1 ring-primary/40' : 'bg-card')}>
      <span className={cn('w-6 shrink-0 text-center font-mono text-lg font-semibold tabular-nums', row.pos === 1 && ACCENT_TEXT)}>
        <span className="sr-only">{t('Position {0}', row.pos)}</span>
        <span aria-hidden>{row.pos}</span>
      </span>
      <PersonAvatar name={row.name} src={row.avatar_url} className="size-10" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{row.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {row.me && <span className={cn('shrink-0 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold leading-[18px]', ACCENT_TEXT)}>{t('You')}</span>}
          <span className="whitespace-nowrap">{t('Level {0}', row.level)}</span>
          <Movement moved={row.prev_pos - row.pos} />
        </span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-right font-mono text-sm font-semibold tabular-nums">{t('{0} XP', fmtInt(row.xp))}</span>
    </li>
  )
}

// Places gained or lost since last week: an arrow and a number, never colour alone.
function Movement({ moved }: { moved: number }) {
  if (moved === 0) return null
  const up = moved > 0
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span className={cn('flex items-center gap-0.5 font-mono tabular-nums', up ? ACCENT_TEXT : 'text-muted-foreground')}>
      <Icon aria-hidden className="size-3.5" />
      <span aria-hidden>{Math.abs(moved)}</span>
      <span className="sr-only">{up ? t('Up {0} since last week', moved) : t('Down {0} since last week', -moved)}</span>
    </span>
  )
}
