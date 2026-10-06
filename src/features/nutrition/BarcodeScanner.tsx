import { useEffect, useRef, useState } from 'react'
import { CameraOff, Flashlight, Keyboard, ScanBarcode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { t } from '../../lib/i18n.js'
import { MOBILE } from '../../lib/mobile.js'
import { decodeBarcode, isBarcode } from './barcode'
import { Field } from './form'

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onCode: (code: string) => void }
type Camera = 'starting' | 'on' | 'denied' | 'unavailable'
type Torch = { track: MediaStreamTrack; on: boolean }

const TICK_MS = 150

// Reads a food's barcode. In a browser: the rear camera in a <video>, a frame decoded every
// 150 ms (BarcodeDetector, or ZXing where there is none) until a code shows up, the flashlight
// when the camera has one. In the app: ML Kit's own scanner (lib/scan.js). Always: "Type code".
// A denied or missing camera leaves a message and the typed path, never a dead end.
export default function BarcodeScanner({ open, onOpenChange, onCode }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camera, setCamera] = useState<Camera>('starting')
  const [torch, setTorch] = useState<Torch | null>(null)
  const [typing, setTyping] = useState(false)
  const [code, setCode] = useState('')
  const [tried, setTried] = useState(false)
  const [nativeTry, setNativeTry] = useState(0)
  // The effect below runs once per opening; the latest callbacks are read through refs.
  const done = useRef({ onCode, onOpenChange })
  done.current = { onCode, onOpenChange }

  useEffect(() => {
    if (!open) return
    setCamera('starting'); setTorch(null); setTyping(false); setCode(''); setTried(false)
    let stopped = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = () => {
      stopped = true
      if (timer) clearTimeout(timer)
      stream?.getTracks().forEach(tr => tr.stop())
    }
    const found = (c: string) => {
      stop()
      done.current.onCode(c)
      done.current.onOpenChange(false)
    }

    if (MOBILE) {
      void (async () => {
        try {
          const { scanCode } = await import('../../lib/scan.js')
          const hit = await scanCode()
          if (stopped) return
          if (hit && isBarcode(hit.value)) found(hit.value)
          else { setCamera('on'); setTyping(!hit) }
        } catch (e) {
          if (stopped) return
          setCamera(String((e as Error)?.message) === 'permission-denied' ? 'denied' : 'unavailable')
        }
      })()
      return stop
    }

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera('unavailable'); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      } catch (e) {
        const name = (e as { name?: string } | null)?.name
        if (!stopped) setCamera(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
        return
      }
      if (stopped) { stream.getTracks().forEach(tr => tr.stop()); return }
      setCamera('on')
      const track = stream.getVideoTracks?.()[0]
      const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined
      if (track && caps?.torch) setTorch({ track, on: false })
      const v = videoRef.current
      if (!v) return
      v.srcObject = stream
      try { await v.play() } catch { /* autoplay rules; the loop waits for frames */ }
      const tick = async () => {
        if (stopped) return
        if (v.readyState >= 2) {
          let c: string | null = null
          try { c = await decodeBarcode(v) } catch { /* keep trying */ }
          if (c && !stopped) { found(c); return }
        }
        if (!stopped) timer = setTimeout(tick, TICK_MS)
      }
      void tick()
    })()
    return stop
  }, [open, nativeTry])

  const toggleTorch = async () => {
    if (!torch) return
    const on = !torch.on
    try {
      await torch.track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
      setTorch({ ...torch, on })
    } catch { setTorch(null) }
  }

  const digits = code.trim()
  const codeError = tried && !isBarcode(digits) ? t('Barcodes have 8 to 14 digits.') : null
  const submit = () => {
    setTried(true)
    if (!isBarcode(digits)) return
    onCode(digits)
    onOpenChange(false)
  }

  const failed = camera === 'denied' || camera === 'unavailable'

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[96dvh] max-h-[96dvh]">
        <DrawerHeader className="flex-row items-center gap-3 text-left group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <div className="min-w-0 flex-1">
            <DrawerTitle className="text-xl">{t('Scan barcode')}</DrawerTitle>
            <DrawerDescription>{failed ? '' : t('Point the camera at the barcode.')}</DrawerDescription>
          </div>
          {torch && (
            <Button variant="secondary" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t('Flashlight')}
              aria-pressed={torch.on} onClick={() => void toggleTorch()}>
              <Flashlight aria-hidden className={cn('size-5', torch.on && 'fill-current')} />
            </Button>
          )}
        </DrawerHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {failed ? (
            <div role="alert" className="flex items-start gap-3 rounded-2xl bg-card p-4">
              <CameraOff aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <p className="text-[15px] leading-snug">
                {camera === 'denied'
                  ? t('Camera access was denied. Allow it in your browser settings or type the code.')
                  : t('Camera is not available here. Type the code instead.')}
              </p>
            </div>
          ) : MOBILE ? (
            <Button variant="secondary" className="h-12 gap-2 rounded-xl" onClick={() => setNativeTry(n => n + 1)}>
              <ScanBarcode aria-hidden className="size-5" />{t('Scan')}
            </Button>
          ) : (
            <div className={cn('relative min-h-64 flex-1 overflow-hidden rounded-3xl bg-black', typing && 'min-h-40 flex-none basis-40')}>
              {/* playsInline keeps iOS from going full screen; muted satisfies autoplay rules. */}
              <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
              <div aria-hidden className="pointer-events-none absolute inset-x-8 top-1/2 h-28 -translate-y-1/2 rounded-2xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}

          {typing && (
            <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); submit() }}>
              <Field id="scan-code" className="flex-1" label={t('Barcode')} value={code} numeric maxLength={14}
                onChange={v => { setCode(v.replace(/\D/g, '')); setTried(false) }} error={codeError} />
              <Button type="submit" className={cn('h-11 rounded-xl', codeError && 'mb-6')}>{t('Look up')}</Button>
            </form>
          )}
        </div>

        <DrawerFooter className="border-t border-border pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {!typing && (
            <Button variant="secondary" className="h-12 gap-2 rounded-xl text-[15px]" onClick={() => setTyping(true)}>
              <Keyboard aria-hidden className="size-5" />{t('Type code')}
            </Button>
          )}
          <Button variant="ghost" className="h-12 rounded-xl text-[15px]" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
