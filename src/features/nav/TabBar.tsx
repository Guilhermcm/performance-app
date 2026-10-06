import type { ReactElement, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Apple, Users } from 'lucide-react'
import { useStore } from '../../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../../lib/history.js'
import { todayISO } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import LegacyIcon from '../../components/Icon.jsx'
import { useSocial } from '../social/useSocial'
import { pendingInvites } from '../social/templates'

// Icon.jsx is untyped JS; size and style are optional there (same cast as home/TodayCard.tsx).
const Icon = LegacyIcon as unknown as (p: { name: string }) => ReactElement

type TabKey = 'home' | 'plan' | 'nutrition' | 'social'
// The tab a route lights: screens reached from a tab keep it lit. Stats left the bar (Phase 2a)
// and opens from the Plan and Home headers, so it and its screens light Plan.
const TAB_OF: Record<string, TabKey> = {
  home: 'home', settings: 'home', perfil: 'home', conquistas: 'home',
  plan: 'plan', library: 'plan', muscles: 'plan', stats: 'plan', history: 'plan', 'structural-balance': 'plan',
  nutricao: 'nutrition',
  social: 'social', convite: 'social'
}

type AppStore = { S: any; user: unknown; isGuest: () => boolean }

// Module scope, not inside TabBar: a component declared in the render body is a new type on every
// render, and the bar re-renders once a second during a rest (see components/TabBar.test.jsx).
function Tab({ active, glyph, label, count = 0, onClick }: { active: boolean; glyph: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}
      aria-label={count > 0 ? t('Social. Challenge invitations: {0}', count) : undefined} onClick={onClick}>
      <span className="relative">
        {glyph}
        {count > 0 && (
          <span aria-hidden className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold leading-none text-primary-foreground tabular-nums">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}

// Home, Plan, Start, Nutrition and Social (Phase 2a, spec 8.3). Keeps the legacy #tabbar markup and classes,
// so the glass, safe area and the raised Start button stay as they are.
export default function TabBar({ onStart }: { onStart: (ids: unknown[]) => void }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore((s: AppStore) => s.S)
  const user = useStore((s: AppStore) => s.user)
  const isGuest = useStore((s: AppStore) => s.isGuest())
  const waiting = useSocial(s => pendingInvites(s.challenges.data, todayISO()))
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = (k: TabKey) => TAB_OF[cur] === k

  const startWorkout = () => {
    if (!S.active) {
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      if (effectiveRoutines(S, todayISO()).some((r: { ex: unknown[] }) => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }

  return (
    <nav id="tabbar">
      <Tab active={on('home')} glyph={<Icon name="house" />} label={t('Home')} onClick={() => nav('/home')} />
      <Tab active={on('plan')} glyph={<Icon name="calendar" />} label={t('Plan')} onClick={() => nav('/plan')} />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the tab
          it is and stays lit; anywhere else it brings you back to the exercise you were on. */}
      <button className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? (cur === 'workout' ? 'dumbbell' : 'play') : 'dumbbell'} /></span>
        <span>{S.active ? (cur === 'workout' ? t('Workout') : S.active.editingWorkoutId ? t('Edit workout') : t('Resume')) : t('Start')}</span>
      </button>
      <Tab active={on('nutrition')} label={t('Nutrition')} onClick={() => nav('/nutricao')}
        glyph={<Apple className="icn" width="1em" height="1em" strokeWidth={on('nutrition') ? 2 : 1.65} aria-hidden />} />
      <Tab active={on('social')} label={t('Social')} count={waiting} onClick={() => nav('/social')}
        glyph={<Users className="icn" width="1em" height="1em" strokeWidth={on('social') ? 2 : 1.65} aria-hidden />} />
    </nav>
  )
}
