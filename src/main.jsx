import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { useStore } from './store/useStore.js'
import { startMediaSync } from './lib/media-sync.js'
import { startNativeKeyboard } from './lib/native-keyboard.js'
import './styles/app.css'
import { setTransport } from './lib/api.js'
import { backend } from './lib/backend.ts'
import { supabase } from './lib/supabase.ts'
import { cleanAuthParams } from './features/auth/auth.ts'
import { startEventSync, clearEventQueue } from './features/gamification/events.ts'

// The store's /api/* calls are answered from Supabase, not an HTTP server of our own.
setTransport(backend)

// Back from Google: once supabase-js has traded ?code= for a session, drop it from the address bar.
supabase.auth.getSession().finally(() => cleanAuthParams())

// Gamification events wait in a local queue and go out whenever there is a session and a network.
// A sign-out clears them: the next person on this phone must not inherit someone else's XP.
startEventSync()
supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') clearEventQueue() })

// App.jsx restores per-route scroll itself; the browser's own attempt races it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// The photos and videos of custom exercises, in every build (the phone and the demo included):
// uploads of what the server lacks, the local clean-up, and the plan's files kept offline.
startMediaSync(useStore)

// Android 15 does not resize the page for the soft keyboard; the app says how much it covers and
// this keeps the focused field above it. Idle everywhere else.
startNativeKeyboard()

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // The plan's exercise media, kept by the worker for a workout opened without a network (#281).
  // It only fetches ahead while the page runs as the installed app; a tab keeps what it has shown.
  import('./lib/media-prefetch.js').then(m => m.startMediaPrefetch(useStore)).catch(() => {})
}
