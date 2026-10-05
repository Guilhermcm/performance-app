import { useEffect, useLayoutEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { setWeightDecimals } from './lib/format.js'
import { setLang, useLang, baseLang } from './lib/i18n.js'
import { effectiveLang } from './lib/default-lang.js'
import { setPlayOnSilent, setVibrate } from './lib/sound.js'
import { setNav } from './lib/nav.js'
import { initBackButton } from './lib/back.js'
import { useWakeLock } from './lib/wakelock.js'
import { installViewportGuard } from './lib/viewport-guard.js'
import { installChipDrag } from './lib/hchips.js'
import { exitWorkoutEdit, startFlow } from './sheets.jsx'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import TimerFlash from './components/TimerFlash.jsx'
import SignIn from './features/auth/SignIn.tsx'
import ProfileGate from './features/profile/ProfileGate.tsx'
import ProfileScreen from './features/profile/ProfileScreen.tsx'
import SyncIndicator from './features/sync/SyncIndicator.tsx'
import { Toaster } from './components/ui/sonner.tsx'
import { useProfile } from './features/profile/useProfile.ts'
import { useProgress, startProgressSync } from './features/gamification/useProgress.ts'
import Home from './views/Home.jsx'
import CheckIn from './views/CheckIn.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Muscles from './views/Muscles.jsx'
import StructuralBalance from './views/StructuralBalance.jsx'
import Settings from './views/Settings.jsx'

// last known scrollY per route, so back-navigation can put the page where it was
const scrollPositions = new Map()

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function applyPrefs(theme) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  delete de.dataset.accent
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = getComputedStyle(de).getPropertyValue('--background').trim() || '#16181d'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  const { S, user, ready } = useStore()
  // iOS: whether timer sounds get past the ring/silent switch (Settings → Sounds). Page-level,
  // so it is applied here on load and on change rather than at each beep.
  useEffect(() => { setPlayOnSilent(!!S.soundOnSilent) }, [S.soundOnSilent])
  // Settings → Vibrate, the same way: one page-level switch rather than a check at each buzz.
  useEffect(() => { setVibrate(S.vibrate !== false) }, [S.vibrate])
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  const lastEditPath = useRef(loc.pathname)
  // Any in-app route exit, browser back included, returns to the persisted draft and asks for a
  // save decision. Reload needs no prompt because the draft itself is already in local storage.
  useEffect(() => {
    const previous = lastEditPath.current
    lastEditPath.current = loc.pathname
    if (previous !== '/workout' || !S.active?.editingWorkoutId || loc.pathname === '/workout') return
    const destination = loc.pathname + loc.search
    navigate('/workout', { replace: true })
    exitWorkoutEdit(() => navigate(destination, { replace: true }))
  }, [loc.pathname, loc.search, S.active?.editingWorkoutId, navigate])
  useEffect(() => { applyPrefs(S.theme) }, [S.theme])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (S.theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(S.theme)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [S.theme])
  // A profile that never picked a language follows the instance default or the browser (#303) —
  // worked out here, on this device, and never written into the synced state (lib/default-lang.js).
  const config = useStore(s => s.config)
  const lang = effectiveLang(S, config)
  useEffect(() => { setLang(lang, S.enParens?.[baseLang(lang)] ?? true, S.enOnly?.[baseLang(lang)] === true) }, [lang, S.enParens, S.enOnly])
  // Same shape as the language: a module-level display setting, pushed when it changes (#139).
  useEffect(() => { setWeightDecimals(S.wdec) }, [S.wdec])
  useEffect(() => { document.documentElement.lang = lang }, [langV, lang])
  // Forward navigation starts at the top; going back lands where you left off.
  // The position is recorded from scroll events rather than read at route
  // change, because by then a shorter page may already have clamped it.
  const pathRef = useRef(null)
  // iOS leaves the page displaced after the keyboard goes away (see lib/viewport-guard.js).
  useEffect(() => installViewportGuard(), [])
  // Click-drag a horizontal chip strip to scroll it sideways (lib/hchips.js) — on a desktop
  // browser there's otherwise no way to reach the filters past the edge.
  useEffect(() => installChipDrag(), [])
  useEffect(() => {
    const onScroll = () => {
      // Modals pins the body while a sheet is open; scrollY is 0 then, not a position.
      if (document.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    const samePath = pathRef.current === loc.pathname
    pathRef.current = loc.pathname
    if (navType !== 'POP') { window.scrollTo(0, 0); return }
    // A POP that stays on the route we are on is not a back-navigation: it is the history
    // entry a sheet pushed (Modals.jsx, #63) being unwound as the sheet closes. Nothing new
    // mounted, Modals puts the page back where it was itself, and a view that scrolled on
    // purpose because the sheet closed — the workout list going to the current exercise after
    // ⋯ → Layout → List (#224) — must not be dragged back to a position recorded before that
    // scroll's event had even been dispatched.
    if (samePath) return
    const y = scrollPositions.get(loc.pathname) || 0
    // the restored view needs a layout pass before it is tall enough to scroll to y
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
    return () => window.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && !S.active.editingWorkoutId && S.keepAwake !== false)

  // The profile in memory belongs to whoever is signed in; signing out drops it.
  useEffect(() => { if (!user) { useProfile.getState().reset(); useProgress.getState().reset() } }, [user?.id])
  // No tab bar while the profile loads or the onboarding is on screen (a guest has no profile).
  const profileReady = useProfile(s => s.status === 'ready' && !s.onboarding) || !user
  // Gamification numbers for a signed-in account with a profile (get_my_progress needs one): the
  // cached copy at once, the server's right after, and again whenever the app comes back.
  useEffect(() => {
    if (!user || !profileReady) return
    void useProgress.getState().load(user.id)
    return startProgressSync()
  }, [user?.id, profileReady])

  const authed = user || isGuest
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )
  // Signed out: the sign-in screen owns the whole viewport (no #app padding, no tab bar).
  if (!authed) return <ErrorBoundary><SignIn /></ErrorBoundary>

  return (
    <>
      {/* Loading, error and onboarding screens own the whole viewport, like SignIn: the gate
          sits outside #app and its padding, and the tab bar waits for a ready profile. */}
      <ErrorBoundary>
        <ProfileGate>
          {/* keyed on the route: a view that throws is contained, and switching tabs
              re-mounts the boundary, so the tab bar is always a way out */}
          <div id="app" className="vfade" key={loc.pathname}>
            <ErrorBoundary>
              <Routes>
                <Route path="/home" element={<Home />} />
                {/* Gym check-in — switched off in Settings, the route falls through to the
                    catch-all redirect below. */}
                {S.checkIn !== false && <Route path="/checkin" element={<CheckIn />} />}
                <Route path="/plan" element={<Plan />} />
                <Route path="/plan/r/:id" element={<RoutineEdit />} />
                <Route path="/workout" element={<Workout />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/history" element={<History />} />
                <Route path="/library" element={<Library />} />
                <Route path="/muscles" element={<Muscles />} />
                <Route path="/structural-balance" element={<StructuralBalance />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/perfil" element={<ProfileScreen />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </ErrorBoundary>
          </div>
        </ProfileGate>
      </ErrorBoundary>
      {/* The connection, for a signed-in account past the profile gate: never over the loading,
          error or onboarding screens. */}
      {user && profileReady && <SyncIndicator />}
      {profileReady && <TabBar onStart={startFlow} />}
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  // Android system back — sheet, then page, then press-again-to-exit (see lib/back.js)
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  // Toasts from the new screens (sonner), mounted once and outside the shell so the sign-in screen
  // has them too. The legacy toast (components/Toast.jsx) stays at the bottom; these come from the top.
  return <><HashRouter><Shell /></HashRouter><Toaster /></>
}
