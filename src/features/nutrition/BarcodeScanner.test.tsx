// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ decode: vi.fn() }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('./barcode', async (orig) => ({ ...(await orig<typeof import('./barcode')>()), decodeBarcode: h.decode }))

import BarcodeScanner from './BarcodeScanner'

const onCode = vi.fn(), onOpenChange = vi.fn()
const setCamera = (getUserMedia: (() => Promise<unknown>) | undefined) =>
  Object.defineProperty(navigator, 'mediaDevices', { value: getUserMedia ? { getUserMedia } : undefined, configurable: true })
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
const typeCode = (v: string) => {
  fireEvent.click(screen.getByRole('button', { name: 'Type code' }))
  fireEvent.change(screen.getByLabelText('Barcode'), { target: { value: v } })
  fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
}

beforeEach(() => { onCode.mockReset(); onOpenChange.mockReset(); h.decode.mockReset() })
afterEach(() => { cleanup(); setCamera(undefined) })

describe('BarcodeScanner', () => {
  it('explains a denied camera and offers to type the code', async () => {
    setCamera(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }) })
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    expect(screen.getByText(/Camera access was denied/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Type code' })).toBeTruthy()
  })

  it('says when there is no camera at all', async () => {
    setCamera(undefined)
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    expect(screen.getByText(/Camera is not available here/)).toBeTruthy()
  })

  it('refuses a typed code that is not a barcode', async () => {
    setCamera(undefined)
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    typeCode('12345')
    expect(onCode).not.toHaveBeenCalled()
    expect(screen.getByText('Barcodes have 8 to 14 digits.')).toBeTruthy()
  })

  it('hands a valid typed code on and closes', async () => {
    setCamera(undefined)
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    typeCode('7891000100103')
    expect(onCode).toHaveBeenCalledWith('7891000100103')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('stops the camera once a frame gives a code', async () => {
    const stop = vi.fn()
    // happy-dom checks srcObject's type: a real MediaStream with stand-in tracks.
    const stream = Object.assign(new MediaStream(), { getTracks: () => [{ stop }], getVideoTracks: () => [{ stop, getCapabilities: () => ({}) }] })
    setCamera(async () => stream)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    const ready = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState')
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 4, configurable: true })
    h.decode.mockResolvedValue('7891000100103')
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    expect(onCode).toHaveBeenCalledWith('7891000100103')
    expect(stop).toHaveBeenCalled()
    if (ready) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', ready)
    else delete (HTMLMediaElement.prototype as { readyState?: number }).readyState
  })
})
