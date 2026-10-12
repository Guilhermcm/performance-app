import { SLEEP_HISTORY_KEY, SLEEP_SEEN_KEY } from './storage-keys'

// Signing out: the night already told and the saved history months go. The outbox stays: it is keyed
// per account, so unsent nights wait on the device and go up the next time that same account signs in
// (the server refuses a night that closed meanwhile, and the store says so once).
export function clearSleepLocal(): void {
  for (const k of [SLEEP_SEEN_KEY, SLEEP_HISTORY_KEY]) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}
