// Browser-side QR decoding for the gym check-in — the PWA half of lib/scan.js. The app build
// hands scanning to ML Kit; here in a browser tab (installed PWA on a phone, most often) we do
// it ourselves: draw the source — an uploaded photo or a live <video> frame — onto an offscreen
// canvas and decode the pixels.
//
// Two decoders, tried in order:
//   1. BarcodeDetector — the browser's own (Chrome/Edge on Android, Samsung Internet). Native
//      speed and quality when it exists; asked for QR only.
//   2. jsQR (Apache-2.0, see NOTICE.md) — pure JS, works everywhere including iOS Safari, which
//      has no BarcodeDetector. Loaded with a dynamic import so it only ships when someone scans.
//
// decodeImageData is the pure core (pixels in, string out) and is what the unit test exercises;
// decodeSource wraps it with the canvas plumbing the browser paths need. Retail barcodes for the
// nutrition scanner have their own pair at the end of the file (decodeBarcodeSource).
import { normalizeFmt } from './qr.js'

let _jsqr = null
async function loadJsQr() {
  if (!_jsqr) _jsqr = (await import('jsqr')).default
  return _jsqr
}

let _detector = null
function nativeDetector() {
  if (_detector !== null) return _detector
  try {
    _detector = (typeof BarcodeDetector === 'function') ? new BarcodeDetector({ formats: ['qr_code'] }) : false
  } catch (e) { _detector = false }
  return _detector
}

// { data, width, height } (an ImageData or anything shaped like one) → { value, fmt } | null.
// jsQR only; the native detector wants a drawable, not raw pixels, so it lives in decodeSource.
export async function decodeImageData(img) {
  if (!img || !img.data || !img.width || !img.height) return null
  const jsQR = await loadJsQr()
  const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })
  return hit && hit.data ? { value: hit.data, fmt: 'qrcode' } : null
}

// Decode from anything drawImage accepts: <video>, <img>, ImageBitmap, canvas. The source is
// scaled down to at most MAX px on its long edge — plenty for a QR, and it keeps jsQR fast enough
// to run on every few video frames on a phone. Reuses one canvas across calls.
const MAX = 800
let _canvas = null
// Draws the source onto the shared canvas, at most `max` px on its long edge. Null when the
// source has no size yet (a video before its first frame) or there is no 2D context.
function drawFrame(source, max) {
  const sw = source.videoWidth || source.naturalWidth || source.width || 0
  const sh = source.videoHeight || source.naturalHeight || source.height || 0
  if (!sw || !sh) return null
  const k = Math.min(1, max / Math.max(sw, sh))
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k))
  if (!_canvas) _canvas = document.createElement('canvas')
  _canvas.width = w; _canvas.height = h
  const ctx = _canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas: _canvas, ctx, w, h }
}

export async function decodeSource(source) {
  const f = drawFrame(source, MAX)
  if (!f) return null
  const { ctx, w, h } = f

  const det = nativeDetector()
  if (det) {
    try {
      const found = await det.detect(_canvas)
      const b = found && found.find(x => x.rawValue)
      if (b) return { value: b.rawValue, fmt: normalizeFmt(b.format) || 'qrcode' }
    } catch (e) { /* fall through to jsQR */ }
  }
  return decodeImageData(ctx.getImageData(0, 0, w, h))
}

// ── Retail barcodes (food packaging) ─────────────────────────────────────────────────────────
// The nutrition scanner reads EAN-13, EAN-8, UPC-A and UPC-E. Separate from the QR path above so
// the check-in keeps asking for QR only. Two decoders, tried in order:
//   1. BarcodeDetector asked for those formats, when the browser has one and supports them.
//   2. ZXing (@zxing/library, Apache-2.0, see NOTICE.md), MultiFormatReader limited to the same
//      four formats. Dynamic import: it only ships to browsers without BarcodeDetector, Safari on
//      the iPhone above all, and only when someone scans.
// Codes are wider than they are tall and need horizontal detail, hence the larger frame.
const BARCODE_MAX = 1280

let _barDetector = null, _barDetectorFor = null, _barKey = ''
// A detector for `formats`, or null to use ZXing. Some browsers ship BarcodeDetector without the
// retail formats (it may only read QR there): getSupportedFormats says so, when it exists.
async function nativeBarcodeDetector(formats) {
  const Ctor = typeof BarcodeDetector === 'function' ? BarcodeDetector : null
  const key = formats.join(',')
  if (Ctor !== _barDetectorFor || key !== _barKey) {
    _barDetectorFor = Ctor; _barKey = key
    _barDetector = (async () => {
      if (!Ctor) return null
      try {
        let use = formats
        if (typeof Ctor.getSupportedFormats === 'function') {
          const have = await Ctor.getSupportedFormats()
          use = formats.filter(f => have.includes(f))
          if (!use.length) return null
        }
        return new Ctor({ formats: use })
      } catch (e) { return null }
    })()
  }
  return _barDetector
}

const ZXING_FORMATS = { ean_13: 'EAN_13', ean_8: 'EAN_8', upc_a: 'UPC_A', upc_e: 'UPC_E' }
let _zxing = null
async function loadZxing(formats) {
  if (!_zxing) {
    _zxing = import('@zxing/library').then(Z => {
      const reader = new Z.MultiFormatReader()
      const hints = new Map()
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, formats.map(f => Z.BarcodeFormat[ZXING_FORMATS[f]]).filter(x => x != null))
      hints.set(Z.DecodeHintType.TRY_HARDER, true)
      reader.setHints(hints)
      return { Z, reader }
    }).catch(e => { _zxing = null; throw e })
  }
  return _zxing
}

// RGBA pixels → one luminance byte per pixel (the green-weighted average ZXing itself uses).
function luminance(img) {
  const n = img.width * img.height
  const out = new Uint8ClampedArray(n)
  const d = img.data
  for (let i = 0, p = 0; i < n; i++, p += 4) out[i] = (d[p] + 2 * d[p + 1] + d[p + 2]) >> 2
  return out
}

// { data, width, height } → the code's text, or null. ZXing only.
export async function decodeBarcodeImageData(img, formats) {
  if (!img || !img.data || !img.width || !img.height) return null
  const { Z, reader } = await loadZxing(formats)
  try {
    const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(luminance(img), img.width, img.height)))
    const hit = reader.decodeWithState(bitmap)
    return hit && hit.getText() ? hit.getText() : null
  } catch (e) {
    return null // NotFoundException and friends: nothing in this frame
  } finally {
    try { reader.reset && reader.reset() } catch (e) { /* */ }
  }
}

// Anything drawImage accepts → the barcode's text, or null. `formats` uses the BarcodeDetector
// names (ean_13, ean_8, upc_a, upc_e).
export async function decodeBarcodeSource(source, formats) {
  const f = drawFrame(source, BARCODE_MAX)
  if (!f) return null
  const det = await nativeBarcodeDetector(formats)
  if (det) {
    try {
      const found = await det.detect(f.canvas)
      const b = found && found.find(x => x.rawValue)
      return b ? b.rawValue : null
    } catch (e) { /* fall through to ZXing */ }
  }
  return decodeBarcodeImageData(f.ctx.getImageData(0, 0, f.w, f.h), formats)
}

// A picked File → { value, fmt } | null. createImageBitmap honours EXIF orientation where the
// browser supports it, which matters for photos of a card taken in portrait.
export async function importCodeFromImageWeb(file) {
  if (!file) return null
  let bmp
  if (typeof createImageBitmap === 'function') {
    bmp = await createImageBitmap(file)
  } else {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('bad image'))
      img.src = URL.createObjectURL(file)
    })
  }
  try { return await decodeSource(bmp) } finally { if (bmp.close) bmp.close() }
}
