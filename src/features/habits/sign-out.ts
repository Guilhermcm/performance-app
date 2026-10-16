import { HABITS_CACHE_KEY, HABITS_HISTORY_KEY } from './storage-keys'

// Signing out: the saved copy and the saved history months go (plan decision 17). The outbox stays:
// it is keyed per account, so unsent habits and checks wait on the device and go up the next time
// that same account signs in (the server refuses a day that closed meanwhile, and the store says so once).
export function clearHabitsLocal(): void {
  for (const k of [HABITS_CACHE_KEY, HABITS_HISTORY_KEY]) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}
