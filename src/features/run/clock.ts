// Race and target times as text: h:mm:ss from one hour, m:ss below it.

/** A time typed as h:mm:ss or m:ss, in minutes; null when it is not one. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(text.trim())
  if (!m) return null
  const [a, b] = [Number(m[1]), Number(m[2])]
  return m[3] === undefined ? a + b / 60 : a * 60 + b + Number(m[3]) / 60
}

/** Minutes as h:mm:ss from one hour, m:ss below it, to the second. */
export function formatClock(minutes: number): string {
  const total = Math.round(minutes * 60)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
