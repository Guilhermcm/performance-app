import { clearOutbox } from './outbox'
import { DAY_SEEN_KEY, INVITE_DISMISSED_KEY } from './storage-keys'

// Signing out: what the nutrition feature keeps on this device for the account that left.
export function clearNutritionLocal(): void {
  clearOutbox()
  for (const k of [DAY_SEEN_KEY, INVITE_DISMISSED_KEY]) {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  }
}
