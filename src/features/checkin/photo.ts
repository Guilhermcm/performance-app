// A picked photo → the file that is uploaded. It is decoded and drawn again on a canvas, which is
// what drops EXIF, GPS and colour profiles: the location a phone writes into a photo does not
// survive a canvas, by construction rather than by a scrub that could miss a field.
import { decodeImage as realDecode, encodeImage as realEncode } from '@/lib/media-ingest.js'
import { sniffKind, imageDims } from '@/lib/media-sniff.js'
import { MAX_PHOTO_MP } from '@/lib/media-limits.js'

export const PHOTO_EDGE = 1280
export const PHOTO_MAX_BYTES = 600 * 1024
// First try 0.8; each retry only when the file is still over the cap.
export const PHOTO_QUALITIES = [0.8, 0.7, 0.6] as const

export type PhotoErrorCode = 'photo_unreadable' | 'photo_too_large'
export class PhotoError extends Error {
  readonly code: PhotoErrorCode
  constructor(code: PhotoErrorCode) { super(code); this.name = 'PhotoError'; this.code = code }
}

export type PreparedPhoto = { blob: Blob; ext: 'jpg' | 'webp'; width: number; height: number }

type Pic = { source: unknown; width: number; height: number; close: () => void }
type Encoded = { blob: Blob; mime: string; width: number; height: number }
// The browser parts, swapped for stand-ins in the tests.
export type PhotoDeps = {
  doc?: Document
  decodeImage?: (blob: Blob, mime: string, o: { doc?: Document }) => Promise<Pic>
  encodeImage?: (pic: Pic, edge: number, quality: number, o: { doc?: Document }) => Promise<Encoded>
}

export async function preparePhoto(file: File | Blob, deps: PhotoDeps = {}): Promise<PreparedPhoto> {
  const decode = deps.decodeImage ?? (realDecode as NonNullable<PhotoDeps['decodeImage']>)
  const encode = deps.encodeImage ?? (realEncode as NonNullable<PhotoDeps['encodeImage']>)
  const o = deps.doc ? { doc: deps.doc } : {}

  let sniffed: { mime: string; kind: string } | null = null
  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
    sniffed = sniffKind(head)
  } catch { throw new PhotoError('photo_unreadable') }
  // Only a still picture: not a video, not a PDF or an SVG whatever its name says.
  if (!sniffed || (sniffed.kind !== 'image' && sniffed.kind !== 'gif')) throw new PhotoError('photo_unreadable')
  // The header says how many pixels the decode would need; a 100-megapixel photo is refused before it.
  const dims = imageDims(head)
  if (dims && dims.width * dims.height > MAX_PHOTO_MP * 1e6) throw new PhotoError('photo_too_large')

  let pic: Pic
  try { pic = await decode(file, sniffed.mime, o) } catch { throw new PhotoError('photo_unreadable') }
  try {
    if (pic.width * pic.height > MAX_PHOTO_MP * 1e6) throw new PhotoError('photo_too_large')
    for (const q of PHOTO_QUALITIES) {
      let out: Encoded
      try { out = await encode(pic, PHOTO_EDGE, q, o) } catch { throw new PhotoError('photo_unreadable') }
      if (out.blob.size <= PHOTO_MAX_BYTES) {
        return { blob: out.blob, ext: out.mime === 'image/webp' ? 'webp' : 'jpg', width: out.width, height: out.height }
      }
    }
    throw new PhotoError('photo_too_large')
  } finally {
    try { pic.close() } catch { /* already gone */ }
  }
}
