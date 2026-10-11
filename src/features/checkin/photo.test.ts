// @vitest-environment happy-dom
// preparePhoto with the browser parts swapped for stand-ins: decoding is faked, and the canvas is a
// stub that only ever writes bytes made from nothing but a size, so a marker in the input file
// (the EXIF a phone writes) can reach the output only by being copied, which encodeImage never does.
import { describe, it, expect, vi } from 'vitest'
import { encodeImage } from '@/lib/media-ingest.js'
import { bytes, fill, jpeg, png, latin1 } from '@/lib/media-samples.test-util.js'
import { preparePhoto, PhotoError, PHOTO_EDGE, PHOTO_MAX_BYTES } from './photo'

const KB = 1024
const hasMarker = async (blob: Blob) => {
  const b = new Uint8Array(await blob.arrayBuffer())
  for (let i = 0; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xe1) return true
  return false
}
const hasText = async (blob: Blob, text: string) => {
  const hay = new Uint8Array(await blob.arrayBuffer()), n = latin1(text)
  outer: for (let i = 0; i + n.length <= hay.length; i++) { for (let k = 0; k < n.length; k++) if (hay[i + k] !== n[k]) continue outer; return true }
  return false
}

// A clean JPEG of `size` bytes (SOI, a frame header, scan data of 0x55: no 0xFF after the markers).
const cleanJpeg = (size: number) => new Blob([bytes([0xff, 0xd8], [0xff, 0xc0, 0, 17, 8, 0, 10, 0, 10, 3], fill(9, 1), [0xff, 0xda, 0, 2], fill(Math.max(0, size - 25)))], { type: 'image/jpeg' })
const cleanWebp = (size: number) => new Blob([bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', fill(Math.max(0, size - 16)))], { type: 'image/webp' })

type Make = (type: string, q: number, w: number, h: number) => Blob | null
function fakeDoc(make: Make, log: { w: number; h: number; type: string; q: number }[] = []) {
  return {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ drawImage: vi.fn(), fillRect: vi.fn(), imageSmoothingQuality: '', globalCompositeOperation: '', fillStyle: '' }),
      toBlob(cb: (b: Blob | null) => void, type: string, q: number) {
        log.push({ w: this.width, h: this.height, type, q })
        cb(make(type, q, this.width, this.height))
      }
    })
  } as unknown as Document
}
const pic = (width: number, height: number) => ({ source: {}, width, height, close: vi.fn() })
const decodeTo = (width: number, height: number) => vi.fn(async () => pic(width, height))

describe('preparePhoto', () => {
  it('reduces 4000x3000 to 1280x960 and writes JPEG where WebP is not available', async () => {
    const log: { w: number; h: number; type: string; q: number }[] = []
    const doc = fakeDoc((type) => (type === 'image/jpeg' ? cleanJpeg(300 * KB) : null), log)
    const decode = decodeTo(4000, 3000)
    const out = await preparePhoto(new File([jpeg(4000, 3000)], 'IMG_1.JPG'), { doc, decodeImage: decode })
    expect(out).toMatchObject({ ext: 'jpg', width: 1280, height: 960 })
    expect(out.blob.size).toBe(300 * KB)
    expect(out.blob.type).toBe('image/jpeg')
    expect(PHOTO_EDGE).toBe(1280)
    expect(log.every(c => c.w === 1280 && c.h === 960)).toBe(true)
    expect(log.at(-1)).toMatchObject({ type: 'image/jpeg', q: 0.8 })
  })

  it('keeps WebP when the browser really writes it', async () => {
    const doc = fakeDoc(type => (type === 'image/webp' ? cleanWebp(200 * KB) : null))
    const out = await preparePhoto(new Blob([png(1000, 800)]), { doc, decodeImage: decodeTo(1000, 800) })
    expect(out).toMatchObject({ ext: 'webp', width: 1000, height: 800 })
    expect(out.blob.type).toBe('image/webp')
  })

  it('does not enlarge a photo that is already small', async () => {
    const doc = fakeDoc(type => (type === 'image/jpeg' ? cleanJpeg(50 * KB) : null))
    const out = await preparePhoto(new Blob([jpeg(640, 480)]), { doc, decodeImage: decodeTo(640, 480) })
    expect(out).toMatchObject({ width: 640, height: 480 })
  })

  it('sends a photo with GPS in its EXIF out without the EXIF marker', async () => {
    const input = bytes(jpeg(4000, 3000), 'GPSLatitude -23.5505 GPSLongitude -46.6333')
    expect(await hasMarker(new Blob([input]))).toBe(true)
    const doc = fakeDoc(type => (type === 'image/jpeg' ? cleanJpeg(120 * KB) : null))
    const out = await preparePhoto(new File([input], 'gps.jpg'), { doc, decodeImage: decodeTo(4000, 3000), encodeImage })
    expect(await hasMarker(out.blob)).toBe(false)
    expect(await hasText(out.blob, 'GPS')).toBe(false)
    expect(await hasText(out.blob, 'Exif')).toBe(false)
  })

  it('gives photo_unreadable when the image does not decode', async () => {
    const decodeImage = vi.fn(async () => { throw Object.assign(new Error('unreadable'), { code: 'unreadable' }) })
    const p = preparePhoto(new Blob([jpeg()]), { doc: fakeDoc(() => null), decodeImage })
    await expect(p).rejects.toBeInstanceOf(PhotoError)
    await expect(p).rejects.toMatchObject({ code: 'photo_unreadable' })
  })

  it('gives photo_unreadable for what is not a picture, without decoding it', async () => {
    const decodeImage = decodeTo(10, 10)
    for (const b of [new Blob(['<svg onload="x()"/>']), new Blob([]), new Blob([fill(100)])]) {
      await expect(preparePhoto(b, { doc: fakeDoc(() => null), decodeImage })).rejects.toMatchObject({ code: 'photo_unreadable' })
    }
    expect(decodeImage).not.toHaveBeenCalled()
  })

  it('gives photo_unreadable when the canvas cannot write the picture', async () => {
    await expect(preparePhoto(new Blob([jpeg()]), { doc: fakeDoc(() => null), decodeImage: decodeTo(640, 480) })).rejects.toMatchObject({ code: 'photo_unreadable' })
  })

  it('refuses a photo with too many pixels before decoding it', async () => {
    const decodeImage = decodeTo(9000, 7000)
    await expect(preparePhoto(new Blob([jpeg(9000, 7000)]), { doc: fakeDoc(() => null), decodeImage })).rejects.toMatchObject({ code: 'photo_too_large' })
    expect(decodeImage).not.toHaveBeenCalled()
  })

  it('tries 0.8, then 0.7, then 0.6 until it fits in 600 KB', async () => {
    const encode = vi.fn(async (_p: unknown, edge: number, q: number) => {
      const size = { 0.8: 700 * KB, 0.7: 650 * KB, 0.6: 500 * KB }[q as 0.8 | 0.7 | 0.6]
      return { blob: cleanJpeg(size), mime: 'image/jpeg', width: edge, height: 960 }
    })
    const out = await preparePhoto(new Blob([jpeg(4000, 3000)]), { decodeImage: decodeTo(4000, 3000), encodeImage: encode })
    expect(encode.mock.calls.map(c => [c[1], c[2]])).toEqual([[1280, 0.8], [1280, 0.7], [1280, 0.6]])
    expect(out.blob.size).toBe(500 * KB)
    expect(PHOTO_MAX_BYTES).toBe(600 * KB)
  })

  it('stops at the first quality that fits and accepts exactly 600 KB', async () => {
    const encode = vi.fn(async (_p: unknown, edge: number) => ({ blob: cleanJpeg(600 * KB), mime: 'image/jpeg', width: edge, height: 960 }))
    await expect(preparePhoto(new Blob([jpeg()]), { decodeImage: decodeTo(4000, 3000), encodeImage: encode })).resolves.toMatchObject({ ext: 'jpg' })
    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('gives photo_too_large when 0.6 still does not fit', async () => {
    const encode = vi.fn(async (_p: unknown, edge: number) => ({ blob: cleanJpeg(600 * KB + 1), mime: 'image/jpeg', width: edge, height: 960 }))
    await expect(preparePhoto(new Blob([jpeg()]), { decodeImage: decodeTo(4000, 3000), encodeImage: encode })).rejects.toMatchObject({ code: 'photo_too_large' })
    expect(encode).toHaveBeenCalledTimes(3)
  })

  it('closes the decoded picture, whatever happens', async () => {
    const p = pic(4000, 3000)
    const encode = vi.fn(async () => { throw new Error('boom') })
    await expect(preparePhoto(new Blob([jpeg()]), { decodeImage: vi.fn(async () => p), encodeImage: encode })).rejects.toMatchObject({ code: 'photo_unreadable' })
    expect(p.close).toHaveBeenCalledTimes(1)
  })
})
