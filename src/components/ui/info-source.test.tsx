// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InfoSource } from './info-source'
import { REFS } from '@/features/plan/references'
import { setLang } from '../../lib/i18n.js'

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w })

beforeEach(() => setWidth(1024))
afterEach(async () => { cleanup(); await setLang('en') })

// happy-dom never plays the sheet's slide-out, so the closed Drawer would stay mounted (and keep the
// focus) waiting for an animationend that a browser fires. End it the way a browser would.
const endSheetAnimation = () => {
  for (const slot of ['drawer-content', 'drawer-overlay']) {
    const el = document.querySelector(`[data-slot="${slot}"]`)
    if (el) fireEvent.animationEnd(el)
  }
}

const open = () => {
  const button = screen.getByRole('button', { name: 'See source' })
  fireEvent.click(button)
  return button
}

describe('InfoSource', () => {
  it('is a 44 px button named "See source" (Ver fonte in pt-BR)', () => {
    render(<InfoSource refs={['schoenfeld2017']} />)
    const button = screen.getByRole('button', { name: 'See source' })
    expect(button.className).toContain('size-11')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is named "Ver fonte" in pt-BR', async () => {
    await setLang('pt-BR')
    render(<InfoSource refs={['schoenfeld2017']} />)
    expect(screen.getByRole('button', { name: 'Ver fonte' })).toBeTruthy()
  })

  it('takes a custom accessible label', () => {
    render(<InfoSource refs={['schoenfeld2017']} label="Source for the range" />)
    expect(screen.getByRole('button', { name: 'Source for the range' })).toBeTruthy()
  })

  it('opens and shows authors, year, title and a safe DOI link', async () => {
    render(<InfoSource refs={['schoenfeld2017', 'pelland2025']} />)
    open()
    const dialog = await screen.findByRole('dialog')
    for (const id of ['schoenfeld2017', 'pelland2025'] as const) {
      const ref = REFS[id]
      expect(dialog.textContent).toContain(ref.authors)
      expect(dialog.textContent).toContain(String(ref.year))
      expect(dialog.textContent).toContain(ref.title)
      const link = screen.getByRole('link', { name: new RegExp(ref.doi.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
      expect(link.getAttribute('href')).toBe(`https://doi.org/${ref.doi}`)
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('shows what the study found', async () => {
    render(<InfoSource refs={['grgic2018freq']} />)
    open()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('With the same weekly volume, training more often made no clear difference to strength.')
  })

  it('closes on Escape and gives the focus back to the button', async () => {
    render(<InfoSource refs={['schoenfeld2017']} />)
    const button = open()
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('closes with the X', async () => {
    render(<InfoSource refs={['schoenfeld2017']} />)
    open()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('closes when tapping outside', async () => {
    render(<div><p data-testid="outside">fora</p><InfoSource refs={['schoenfeld2017']} /></div>)
    open()
    await screen.findByRole('dialog')
    // Radix arms its outside listener on the next tick.
    await new Promise(r => setTimeout(r, 20))
    // A tap: Radix defers the outside dismissal to the click that follows the pointerdown.
    fireEvent.pointerDown(screen.getByTestId('outside'), { button: 0 })
    fireEvent.click(screen.getByTestId('outside'), { button: 0 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('opens as a popover on a wide screen', async () => {
    render(<InfoSource refs={['schoenfeld2017']} />)
    open()
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="drawer-content"]')).toBeNull()
  })

  it('opens as a sheet (Drawer) under 480 px', async () => {
    setWidth(375)
    render(<InfoSource refs={['schoenfeld2017']} />)
    open()
    const dialog = await screen.findByRole('dialog')
    expect(document.querySelector('[data-slot="drawer-content"]')).not.toBeNull()
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    expect(dialog.textContent).toContain(REFS.schoenfeld2017.authors)
  })

  it('closes the sheet on Escape and gives the focus back to the button (375 px)', async () => {
    setWidth(375)
    render(<InfoSource refs={['schoenfeld2017']} />)
    const button = open()
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(dialog.getAttribute('data-state')).toBe('closed'))
    endSheetAnimation()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('closes the sheet with the X (375 px)', async () => {
    setWidth(375)
    render(<InfoSource refs={['schoenfeld2017']} />)
    const button = open()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(dialog.getAttribute('data-state')).toBe('closed'))
    endSheetAnimation()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('names the year once in the citation line (review M6)', async () => {
    render(<InfoSource refs={['schoenfeld2017']} />)
    open()
    const dialog = await screen.findByRole('dialog')
    const ref = REFS.schoenfeld2017
    const line = [...dialog.querySelectorAll('p')].find(p => p.textContent?.startsWith(ref.authors))!
    expect(line.textContent).toBe(`${ref.authors} (${ref.year}). ${ref.title}. ${ref.journal}`)
    expect(line.textContent!.split(String(ref.year))).toHaveLength(2)
  })

  it('shows the rule of thumb text with no link', async () => {
    render(<InfoSource refs={['rule-of-thumb']} />)
    open()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Rule of thumb for building a workout, with no study number behind it.')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
