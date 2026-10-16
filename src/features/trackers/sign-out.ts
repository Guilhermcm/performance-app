import { TRACKERS_CACHE_KEY } from './storage-keys'

// Signing out: the saved copy goes. The outbox stays: it is keyed per account, so unsent trackers
// and entries wait on the device and go up the next time that same account signs in.
export function clearTrackersLocal(): void {
  try { localStorage.removeItem(TRACKERS_CACHE_KEY) } catch { /* ignore */ }
}
