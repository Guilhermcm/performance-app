import { describe, it, expect } from 'vitest'
import { generate } from 'lean-qr'
import { decodeImageData, decodeBarcodeImageData } from './scan-web.js'

// Round trip through the two libraries the browser path relies on: lean-qr draws a code (the
// same renderer the card view uses), jsQR reads it back. Pixels are built by hand from
// code.get(x, y) — no canvas in this environment — scaled 4× with a 4-module quiet zone, which
// is what a phone camera would roughly see.
function rasterize(code, scale = 4, quiet = 4) {
  const n = code.size + quiet * 2
  const w = n * scale
  const data = new Uint8ClampedArray(w * w * 4)
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      const mx = Math.floor(x / scale) - quiet, my = Math.floor(y / scale) - quiet
      const dark = mx >= 0 && my >= 0 && mx < code.size && my < code.size && code.get(mx, my)
      const v = dark ? 0 : 255
      const i = (y * w + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return { data, width: w, height: w }
}

describe('decodeImageData', () => {
  it('reads back a code lean-qr generated', async () => {
    const value = 'MEMBER-0042-FITZONE'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit).toEqual({ value, fmt: 'qrcode' })
  })

  it('reads a URL-shaped code, the other common gym format', async () => {
    const value = 'https://checkin.example.com/m/8f3a1c?v=2'
    const hit = await decodeImageData(rasterize(generate(value)))
    expect(hit?.value).toBe(value)
  })

  it('returns null for blank pixels and for junk input', async () => {
    const blank = { data: new Uint8ClampedArray(64 * 64 * 4).fill(255), width: 64, height: 64 }
    expect(await decodeImageData(blank)).toBeNull()
    expect(await decodeImageData(null)).toBeNull()
    expect(await decodeImageData({ data: null, width: 1, height: 1 })).toBeNull()
  })
})

// The barcode path for the nutrition scanner: an EAN-13 and an EAN-8 drawn by hand from the
// standard's bar patterns, read back by ZXing's MultiFormatReader (the fallback for browsers
// without BarcodeDetector). ZXing ships no EAN writer, hence the encoder here.
describe('decodeBarcodeImageData', () => {
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
  const R = L.map(c => [...c].map(b => (b === '1' ? '0' : '1')).join(''))
  const G = R.map(c => [...c].reverse().join(''))
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']
  function bars(value) {
    const d = [...value].map(Number)
    if (d.length === 8) return '101' + d.slice(0, 4).map(n => L[n]).join('') + '01010' + d.slice(4).map(n => R[n]).join('') + '101'
    const par = PARITY[d[0]]
    return '101' + d.slice(1, 7).map((n, i) => (par[i] === 'L' ? L : G)[n]).join('') + '01010' + d.slice(7).map(n => R[n]).join('') + '101'
  }
  function drawBarcode(value) {
    const b = bars(value)
    const scale = 3, quiet = 12, rows = 60
    const w = (b.length + quiet * 2) * scale
    const data = new Uint8ClampedArray(w * rows * 4)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < w; x++) {
        const mx = Math.floor(x / scale) - quiet
        const v = mx >= 0 && mx < b.length && b[mx] === '1' ? 0 : 255
        const i = (y * w + x) * 4
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
      }
    }
    return { data, width: w, height: rows }
  }

  it('reads back an EAN-13 and an EAN-8', async () => {
    expect(await decodeBarcodeImageData(drawBarcode('7891000100103'), FORMATS)).toBe('7891000100103')
    expect(await decodeBarcodeImageData(drawBarcode('96385074'), FORMATS)).toBe('96385074')
  })

  it('returns null for blank pixels, and does not read a QR code', async () => {
    const blank = { data: new Uint8ClampedArray(200 * 60 * 4).fill(255), width: 200, height: 60 }
    expect(await decodeBarcodeImageData(blank, FORMATS)).toBeNull()
    expect(await decodeBarcodeImageData(rasterize(generate('7891000100103')), FORMATS)).toBeNull()
  })
})
