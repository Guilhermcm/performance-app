// Stub with the final signature; Task 10 replaces it with the queue that sends to activity_events.
export type EventKind = 'workout_completed' | 'pr' | 'weight_logged'
export function emit(_kind: EventKind, _payload: Record<string, unknown>, _sourceRef: string, _occurredOn: string): void {}
