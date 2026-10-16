// Browser-storage keys of the trackers feature that outlive a screen.
// The unsent tracker and entry writes, per account. Never cleared on sign-out: they go up on that account's next sign-in.
export const TRACKERS_OUTBOX_KEY = 'perf_trackers_outbox_v1'
// The saved copy of the store (every tracker and the entries of the last 90 days) for one account. Cleared on sign-out.
export const TRACKERS_CACHE_KEY = 'perf_trackers_v1'
