import { DAY_SEEN_KEY, HISTORY_KEY, INVITE_DISMISSED_KEY } from './storage-keys'

// Signing out: the seen-day and invite flags and the saved history months go. The outbox stays: it
// is keyed per account, so unsent diary writes wait on the device and go up the next time that same
// account signs in.
export function clearNutritionLocal(): void {
  for (const k of [DAY_SEEN_KEY, INVITE_DISMISSED_KEY, HISTORY_KEY]) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}
