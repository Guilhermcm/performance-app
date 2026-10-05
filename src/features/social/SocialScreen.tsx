import type { ComponentType } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Activity, Swords, Trophy, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { useSocial } from './useSocial'
import { pendingInvites } from './templates'
import RankingPanel from './RankingPanel'
import ChallengesPanel from './ChallengesPanel'
import FeedPanel from './FeedPanel'
import FriendsPanel from './FriendsPanel'

type Section = 'ranking' | 'desafios' | 'feed' | 'amigos'
const SECTIONS: { key: Section; label: () => string; icon: LucideIcon }[] = [
  { key: 'ranking', label: () => t('Ranking'), icon: Trophy },
  { key: 'desafios', label: () => t('Challenges'), icon: Swords },
  { key: 'feed', label: () => t('Feed'), icon: Activity },
  { key: 'amigos', label: () => t('Friends'), icon: Users }
]
const PANELS: Record<Section, ComponentType> = { ranking: RankingPanel, desafios: ChallengesPanel, feed: FeedPanel, amigos: FriendsPanel }

// The social tab: one header, four sections. Switching sections replaces the history entry, so
// Back leaves the social area instead of walking through its sections.
export default function SocialScreen() {
  const { section } = useParams()
  const navigate = useNavigate()
  const waiting = useSocial(s => pendingInvites(s.challenges.data))
  if (!section || !(section in PANELS)) return <Navigate to="/social/ranking" replace />
  const Panel = PANELS[section as Section]

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 pb-6 font-sans text-foreground">
      <h1 className="text-2xl font-semibold tracking-tight">{t('Social')}</h1>
      <nav aria-label={t('Social')} className="grid grid-cols-4 gap-1 rounded-2xl bg-secondary/60 p-1">
        {SECTIONS.map(s => {
          const on = s.key === section
          const Icon = s.icon
          return (
            <button key={s.key} type="button" aria-current={on ? 'page' : undefined}
              onClick={() => { if (!on) navigate('/social/' + s.key, { replace: true }) }}
              className={cn('relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')}>
              <Icon aria-hidden className="size-[18px]" />
              {s.label()}
              {s.key === 'desafios' && waiting > 0 && (
                <span data-slot="invite-dot" aria-hidden className="absolute right-2 top-1.5 size-2 rounded-full bg-primary" />
              )}
            </button>
          )
        })}
      </nav>
      <Panel />
    </div>
  )
}
