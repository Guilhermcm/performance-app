import { lazy, Suspense, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart3, Settings as SettingsIcon } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useStore } from '../../store/useStore.js'
import { t, dateLocale } from '../../lib/i18n.js'
import { useProfile } from '../profile/useProfile'
import { ProgressHero } from './ProgressHero'
import { TodayCard } from './TodayCard'
import { BodyWeightCard } from './BodyWeightCard'
import { CheckInCard, WelcomeCard } from './HomeCards'
import HomeNutritionCard from '../nutrition/HomeNutritionCard'
import { useProgress } from '../gamification/useProgress'
import type { PillarKey } from '../gamification/types'
import { PillarRadarSkeleton } from './PillarRadarSkeleton'

// Recharts is heavy and only the radar uses it on the Home: it comes in its own chunk.
const PillarRadar = lazy(() => import('./PillarRadar'))
// The pillars out so far; sleep and habits show as coming soon.
const RELEASED: PillarKey[] = ['strength', 'nutrition']

type HomeStore = { S: Record<string, any>; user: { id: string; name?: string } | null }

// Home = where you stand and what to do now. Deep charts and history live in Stats (header button).
export default function HomeScreen() {
  const nav = useNavigate()
  const S = useStore((s: HomeStore) => s.S)
  const user = useStore((s: HomeStore) => s.user)
  const profile = useProfile(s => s.profile)
  const name = profile?.display_name || user?.name || ''

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 font-sans text-foreground">
      <header className="flex items-start justify-between gap-3 pb-1">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-semibold leading-tight tracking-tight">{user ? t('Hi {0}', name) : 'openGym'}</h1>
          <p className="text-sm text-muted-foreground first-letter:uppercase">
            {new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {/* Stats (out of the tab bar since Phase 2a), Settings, then the profile at the far edge,
            where an account usually is. */}
        <div className="flex flex-none items-center gap-1">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Stats')} onClick={() => nav('/stats')}>
            <BarChart3 className="size-5" />
          </Button>
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t('Settings')} onClick={() => nav('/settings')}>
            <SettingsIcon className="size-5" />
          </Button>
          {user && (
            <button type="button" data-testid="avatar-button" aria-label={t('Profile')} onClick={() => nav('/perfil')}
              className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <Avatar className="size-9 ring-1 ring-border">
                {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" referrerPolicy="no-referrer" />}
                <AvatarFallback className="bg-secondary text-[15px] font-semibold text-secondary-foreground">
                  {(name || '?').trim().slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
          )}
        </div>
      </header>

      {/* With no routines yet, setting up a plan is the one thing to do: it leads the page. */}
      {!S.routines.length && !S.active && <WelcomeCard />}
      {user && <ProgressHero />}
      {user && <HomeRadar />}
      {user && <HomeNutritionCard />}
      <TodayCard />
      {S.checkIn !== false && <CheckInCard />}
      {S.showWeightCard !== false && <BodyWeightCard />}
    </div>
  )
}

// The radar under the level card. Until the progress and the profile are in (or while the cached
// progress is from a build without the radar), and while the chunk loads, a skeleton of the same size.
function HomeRadar() {
  const radar = useProgress(s => s.progress?.radar)
  const profile = useProfile(s => s.profile)
  const nutrition = profile?.nutrition_enabled ?? false
  const enabled = useMemo(() => ({ strength: true, nutrition }), [nutrition])
  if (!radar || !profile) return <PillarRadarSkeleton />
  return (
    <Suspense fallback={<PillarRadarSkeleton />}>
      <PillarRadar radar={radar} enabled={enabled} released={RELEASED} />
    </Suspense>
  )
}
