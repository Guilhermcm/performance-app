import type { ReactElement, ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Apple, Camera, Users } from 'lucide-react'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import LegacyIcon from '../../components/Icon.jsx'
import { useCheckins } from '../checkin/useCheckins'
import { openCheckinCamera, useCheckinFlow } from '../checkin/open-checkin'

// Icon.jsx is untyped JS; size and style are optional there (same cast as home/TodayCard.tsx).
const Icon = LegacyIcon as unknown as (p: { name: string }) => ReactElement

type TabKey = 'home' | 'plan' | 'nutrition' | 'social'
// The tab a route lights: screens reached from a tab keep it lit. Stats left the bar (Phase 2a)
// and opens from the Plan and Home headers, so it and its screens light Plan. So does the live
// workout, which left the center of the bar for the check-in (phase 1c) and is resumed from the Plan.
const TAB_OF: Record<string, TabKey> = {
  home: 'home', settings: 'home', perfil: 'home', conquistas: 'home',
  plan: 'plan', library: 'plan', muscles: 'plan', stats: 'plan', history: 'plan', 'structural-balance': 'plan', workout: 'plan',
  nutricao: 'nutrition',
  social: 'social', convite: 'social'
}

type AppStore = { user: unknown; isGuest: () => boolean }

// Module scope, not inside TabBar: a component declared in the render body is a new type on every
// render, and the bar re-renders once a second during a rest (see components/TabBar.test.jsx).
function Tab({ active, glyph, label, count = 0, onClick }: { active: boolean; glyph: ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}
      aria-label={count > 0 ? t('Social. Notices: {0}', count) : undefined} onClick={onClick}>
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

// Home, Plan, Check-in, Nutrition and Social (phase 1c, spec 2). Keeps the legacy #tabbar markup and
// classes, so the glass, safe area and the raised center button stay as they are. The center opens
// the photo check-in and the rear camera in the same tap; a live workout in progress is resumed from
// the Plan (and the Home card).
export default function TabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const user = useStore((s: AppStore) => s.user)
  const isGuest = useStore((s: AppStore) => s.isGuest())
  // Unread notices plus challenge invites not answered yet (spec 4.4), an invite counted once.
  const unread = useCheckins(s => s.unread)
  const checkingIn = useCheckinFlow(s => s.open)
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = (k: TabKey) => TAB_OF[cur] === k

  return (
    <nav id="tabbar">
      <Tab active={on('home')} glyph={<Icon name="house" />} label={t('Home')} onClick={() => nav('/home')} />
      <Tab active={on('plan')} glyph={<Icon name="calendar" />} label={t('Plan')} onClick={() => nav('/plan')} />
      <button className={'start' + (checkingIn ? ' on' : '')} aria-haspopup="dialog" onClick={() => openCheckinCamera()}>
        <span className="cir"><Camera className="icn" width="1em" height="1em" strokeWidth={2} aria-hidden /></span>
        <span>{t('Check-in')}</span>
      </button>
      <Tab active={on('nutrition')} label={t('Nutrition')} onClick={() => nav('/nutricao')}
        glyph={<Apple className="icn" width="1em" height="1em" strokeWidth={on('nutrition') ? 2 : 1.65} aria-hidden />} />
      <Tab active={on('social')} label={t('Social')} count={unread} onClick={() => nav('/social')}
        glyph={<Users className="icn" width="1em" height="1em" strokeWidth={on('social') ? 2 : 1.65} aria-hidden />} />
    </nav>
  )
}
