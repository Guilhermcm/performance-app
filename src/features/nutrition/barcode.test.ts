// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ZXing is the fallback for browsers without BarcodeDetector (Safari on the iPhone). Here it is a
// stand-in that records what it was asked and answers with a fixed code.
const z = vi.hoisted(() => ({ decode: vi.fn(), hints: null as unknown, luminance: null as unknown }))
vi.mock('@zxing/library', () => {
  class MultiFormatReader {
    setHints(h: unknown) { z.hints = h }
    decodeWithState(bitmap: unknown) { return z.decode(bitmap) }
  }
  class RGBLuminanceSource { constructor(lum: unknown, w: number, h: number) { z.luminance = { lum, w, h } } }
  class HybridBinarizer { constructor(public src: unknown) {} }
  class BinaryBitmap { constructor(public bin: unknown) {} }
  return {
    MultiFormatReader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap,
    BarcodeFormat: { EAN_13: 'EAN_13', EAN_8: 'EAN_8', UPC_A: 'UPC_A', UPC_E: 'UPC_E', QR_CODE: 'QR_CODE' },
    DecodeHintType: { POSSIBLE_FORMATS: 'POSSIBLE_FORMATS', TRY_HARDER: 'TRY_HARDER' }
  }
})
const off = vi.hoisted(() => ({ productByCode: vi.fn() }))
vi.mock('./off-api', () => off)

import { BARCODE_FORMATS, decodeBarcode, isBarcode, lookupBarcode } from './barcode'
import { foodOf, itemOf } from './test-nutrition'

// happy-dom has no 2D canvas: a context that draws nothing and hands back grey pixels.
const ctx = {
  drawImage: vi.fn(),
  getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(128), width: w, height: h })
}
const frame = { width: 640, height: 480 } as unknown as CanvasImageSource
const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { value: on, configurable: true })

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never)
  z.decode.mockReset(); z.hints = null; z.luminance = null
  off.productByCode.mockReset()
  setOnline(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector
  setOnline(true)
})

describe('isBarcode', () => {
  it('takes 8 to 14 digits only', () => {
    expect(isBarcode('78912345')).toBe(true)
    expect(isBarcode('7891000100103')).toBe(true)
    expect(isBarcode('12345678901234')).toBe(true)
    expect(isBarcode('1234567')).toBe(false)
    expect(isBarcode('123456789012345')).toBe(false)
    expect(isBarcode('7891000a00103')).toBe(false)
    expect(isBarcode(' 7891000100103')).toBe(false)
  })
})

describe('decodeBarcode', () => {
  it('asks the native detector for the four retail formats when the browser has one', async () => {
    const detect = vi.fn(async () => [{ rawValue: '7891000100103', format: 'ean_13' }])
    const made: unknown[] = []
    ;(globalThis as { BarcodeDetector?: unknown }).BarcodeDetector = class { constructor(o: unknown) { made.push(o) } detect = detect }
    expect(await decodeBarcode(frame)).toBe('7891000100103')
    expect(made[0]).toEqual({ formats: [...BARCODE_FORMATS] })
    expect(z.decode).not.toHaveBeenCalled()
  })

  it('falls back to ZXing without BarcodeDetector, with the same four formats', async () => {
    z.decode.mockReturnValue({ getText: () => '7891000100103' })
    expect(await decodeBarcode(frame)).toBe('7891000100103')
    expect(z.decode).toHaveBeenCalledTimes(1)
    const hints = z.hints as Map<string, unknown>
    expect(hints.get('POSSIBLE_FORMATS')).toEqual(['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E'])
    // Grey pixels in, one luminance byte per pixel out.
    const lum = z.luminance as { lum: Uint8ClampedArray; w: number; h: number }
    expect(lum.lum.length).toBe(lum.w * lum.h)
    expect(lum.lum[0]).toBe(128)
  })

  it('returns null when ZXing finds nothing in the frame', async () => {
    z.decode.mockImplementation(() => { throw new Error('NotFoundException') })
    expect(await decodeBarcode(frame)).toBeNull()
  })

  it('ignores what is not a retail barcode', async () => {
    z.decode.mockReturnValue({ getText: () => 'https://example.com' })
    expect(await decodeBarcode(frame)).toBeNull()
  })
})

describe('lookupBarcode', () => {
  it('finds the person\'s own food first, without going online', async () => {
    const mine = foodOf({ source: 'custom', source_id: null, name: 'Granola da casa', barcode: '7891000100103' })
    expect(await lookupBarcode('7891000100103', [foodOf({ barcode: '111' }), mine])).toEqual({ item: mine })
    expect(off.productByCode).not.toHaveBeenCalled()
  })

  it('matches a 12 digit UPC-A against the same code stored with a leading zero', async () => {
    const mine = foodOf({ barcode: '0012345678905' })
    expect(await lookupBarcode('012345678905', [mine])).toEqual({ item: mine })
  })

  it('then asks Open Food Facts', async () => {
    const item = itemOf({ source: 'off', source_id: '7891000100103', name: 'Leite', barcode: '7891000100103' })
    off.productByCode.mockResolvedValue(item)
    expect(await lookupBarcode('7891000100103', [])).toEqual({ item })
    expect(off.productByCode).toHaveBeenCalledWith('7891000100103')
  })

  it('reports a code nobody knows as not found', async () => {
    off.productByCode.mockResolvedValue(null)
    expect(await lookupBarcode('7891000100103', [])).toEqual({ notFound: true })
  })

  it('offline, looks only among the own foods and says it is offline', async () => {
    setOnline(false)
    expect(await lookupBarcode('7891000100103', [foodOf({ barcode: '78900000' })])).toEqual({ error: 'offline' })
    expect(off.productByCode).not.toHaveBeenCalled()
  })

  it('passes on the errors of Open Food Facts', async () => {
    off.productByCode.mockResolvedValue({ error: 'offline' })
    expect(await lookupBarcode('7891000100103', [])).toEqual({ error: 'offline' })
    off.productByCode.mockResolvedValue({ error: 'failed' })
    expect(await lookupBarcode('7891000100103', [])).toEqual({ error: 'failed' })
  })
})
