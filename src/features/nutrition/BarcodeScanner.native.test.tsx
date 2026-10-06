// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'

// The app build: ML Kit's scanner reads any code, a QR included.
const h = vi.hoisted(() => ({ scanCode: vi.fn() }))
vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))
vi.mock('../../lib/mobile.js', () => ({ MOBILE: true }))
vi.mock('../../lib/scan.js', () => ({ scanCode: h.scanCode }))

import BarcodeScanner from './BarcodeScanner'

const onCode = vi.fn(), onOpenChange = vi.fn()
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

beforeEach(() => { onCode.mockReset(); onOpenChange.mockReset(); h.scanCode.mockReset() })
afterEach(cleanup)

describe('BarcodeScanner in the app', () => {
  it('hands a product barcode on and closes', async () => {
    h.scanCode.mockResolvedValue({ value: '7891000100103' })
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    expect(onCode).toHaveBeenCalledWith('7891000100103')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('says a QR code is not a product barcode and switches to typing', async () => {
    h.scanCode.mockResolvedValue({ value: 'https://example.com/checkin' })
    render(<BarcodeScanner open onOpenChange={onOpenChange} onCode={onCode} />)
    await settle()
    expect(onCode).not.toHaveBeenCalled()
    expect(screen.getByText('Barcodes have 8 to 14 digits.')).toBeTruthy()
    expect(screen.getByLabelText('Barcode')).toBeTruthy()
  })
})
