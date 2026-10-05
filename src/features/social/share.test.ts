import { describe, it, expect, vi } from 'vitest'
import { shareLink } from './share'

const URL_ = 'https://perf.app/#/convite/AbCdEfGh12'
const abort = () => Object.assign(new Error('cancelled'), { name: 'AbortError' })

describe('shareLink', () => {
  it('uses the share sheet when there is one', async () => {
    const share = vi.fn(async () => {})
    await expect(shareLink(URL_, 'Bora', { share })).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith({ text: 'Bora', url: URL_ })
  })

  it('does nothing else when the person closes the sheet', async () => {
    const writeText = vi.fn(async () => {})
    await expect(shareLink(URL_, 'Bora', { share: vi.fn(async () => { throw abort() }), clipboard: { writeText } })).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the link when sharing is missing or fails', async () => {
    const writeText = vi.fn(async () => {})
    await expect(shareLink(URL_, 'Bora', { clipboard: { writeText } })).resolves.toBe('copied')
    await expect(shareLink(URL_, 'Bora', { share: vi.fn(async () => { throw new Error('NotAllowedError') }), clipboard: { writeText } })).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL_)
  })

  it('says so when nothing worked', async () => {
    await expect(shareLink(URL_, 'Bora', {})).resolves.toBe('failed')
    await expect(shareLink(URL_, 'Bora', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })).resolves.toBe('failed')
  })
})
