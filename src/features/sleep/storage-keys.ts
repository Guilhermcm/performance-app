// Browser-storage keys of the sleep feature that outlive a screen.
// The unsent night writes, per account. Never cleared on sign-out: they go up on that account's next sign-in.
export const SLEEP_OUTBOX_KEY = 'perf_sleep_outbox_v1'
// The saved copy of the store (today, yesterday, targets, recent closed nights) for one account.
export const SLEEP_CACHE_KEY = 'perf_sleep_v1'
// The last closed night the toast told about ({ userId, day }, read by CelebrationHost); the first
// answer on a device only records it. Cleared on sign-out.
export const SLEEP_SEEN_KEY = 'perf_sleep_seen_v1'
// The months of the history calendar read so far, for one account. Cleared on sign-out.
export const SLEEP_HISTORY_KEY = 'perf_sleep_history_v1'
