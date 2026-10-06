import { decodeBarcodeSource } from '../../lib/scan-web.js'
import { productByCode } from './off-api'
import type { FoodItem, UserFood } from './types'

// The retail formats on food packaging. The browser asks BarcodeDetector for these, or ZXing.
export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const

/** 8 to 14 digits, nothing else: EAN-8, UPC-A/E, EAN-13 and GTIN-14. */
export function isBarcode(s: string): boolean {
  return /^\d{8,14}$/.test(s)
}

/** A video frame or picture → the barcode in it, or null. BarcodeDetector first, then ZXing. */
export async function decodeBarcode(source: CanvasImageSource): Promise<string | null> {
  const code = await decodeBarcodeSource(source, [...BARCODE_FORMATS])
  return typeof code === 'string' && isBarcode(code) ? code : null
}

// A UPC-A (12 digits) is the same product as the EAN-13 with a leading zero, so codes compare
// without their leading zeros.
const bare = (s: string) => s.replace(/^0+/, '')
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

export type BarcodeLookup = { item: FoodItem } | { notFound: true } | { error: 'offline' | 'failed' }

/**
 * Own foods first (they work offline), then Open Food Facts. Offline with no own food the
 * answer is 'offline': the screen then offers to create the food. `onRemote` runs just before
 * the network request, so the screen can say it is looking.
 */
export async function lookupBarcode(code: string, foods: UserFood[], onRemote?: () => void): Promise<BarcodeLookup> {
  const want = bare(code)
  const mine = foods.find(f => f.barcode != null && bare(f.barcode) === want)
  if (mine) return { item: mine }
  if (isOffline()) return { error: 'offline' }
  onRemote?.()
  const p = await productByCode(code)
  if (p == null) return { notFound: true }
  if ('error' in p) return { error: p.error === 'offline' ? 'offline' : 'failed' }
  return { item: p }
}
