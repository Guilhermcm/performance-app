// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

vi.mock('@/components/ui/drawer', () => import('../social/test-drawer'))

import { NightSheet } from './NightSheet'
import { setLang } from '../../lib/i18n.js'
import { nightOf } from './test-sleep'

afterEach(async () => { cleanup(); await setLang('en') })

const row = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling!.textContent

describe('NightSheet', () => {
  it('shows the times, the length, the quality, the note, the goal of that night and the XP', async () => {
    await setLang('pt-BR')
    const night = nightOf({ night: '2026-10-01', bed_time: '23:20', wake_time: '07:00', duration_min: 460, quality: 4, note: 'Acordei uma vez', xp: 130 })
    render(<NightSheet night={night} open onOpenChange={() => {}} />)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading').textContent).toBe('quinta-feira, 1 de outubro')
    expect(within(sheet).getByText('No alvo')).toBeTruthy()
    expect(row('Deitou')).toBe('23:20')
    expect(row('Acordou')).toBe('07:00')
    expect(row('Duração')).toBe('7h 40')
    expect(row('Qualidade do sono')).toBe('Boa')
    expect(row('Meta da noite')).toBe('8h · 23:00')
    expect(row('Nota')).toBe('Acordei uma vez')
    expect(within(sheet).getByText('+130 XP')).toBeTruthy()
  })

  it('says a night without a log had none, and keeps its goal', async () => {
    await setLang('pt-BR')
    const night = nightOf({ night: '2026-10-03', logged: false, on_target: false, duration_min: null, bed_time: null, wake_time: null, bed_diff_min: null, xp: 0 })
    render(<NightSheet night={night} open onOpenChange={() => {}} />)
    expect(screen.getByText('Sem registro')).toBeTruthy()
    expect(screen.queryByText('Deitou', { selector: 'dt' })).toBeNull()
    expect(row('Meta da noite')).toBe('8h · 23:00')
  })

  it('leaves out what was not given and says when no goal was in force', () => {
    const night = nightOf({ night: '2026-10-02', on_target: false, target: null, bed_diff_min: null, quality: null, note: null, xp: 0 })
    render(<NightSheet night={night} open onOpenChange={() => {}} />)
    expect(screen.getByText('Logged')).toBeTruthy()
    expect(screen.queryByText('Sleep quality', { selector: 'dt' })).toBeNull()
    expect(screen.queryByText('Note', { selector: 'dt' })).toBeNull()
    expect(row('Goal that night')).toBe('No goal')
  })

  it('closes from its button', () => {
    const onOpenChange = vi.fn()
    render(<NightSheet night={nightOf()} open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
