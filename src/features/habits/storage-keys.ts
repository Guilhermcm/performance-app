// Browser-storage keys of the habits feature that outlive a screen.
// The unsent habit and check writes, per account. Never cleared on sign-out: they go up on that account's next sign-in.
export const HABITS_OUTBOX_KEY = 'perf_habits_outbox_v1'
// The saved copy of the store (habits, this week's checks and targets, recent history) for one account. Cleared on sign-out.
export const HABITS_CACHE_KEY = 'perf_habits_v1'
// The months of the history calendar read so far, for one account. Cleared on sign-out.
export const HABITS_HISTORY_KEY = 'perf_habits_history_v1'
