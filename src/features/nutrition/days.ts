import { isoOf } from '../../lib/format.js'

// Local calendar arithmetic on YYYY-MM-DD strings (the diary's day keys).
export const shiftDay = (iso: string, by: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  return isoOf(new Date(y, m - 1, d + by))
}
