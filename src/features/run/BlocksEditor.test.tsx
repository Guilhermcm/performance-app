// @vitest-environment happy-dom
// "Ajustar" (plan decision 1): the planned workout's items, with the zone and minutes of each block
// and the count of each repeat to change; no item is added or taken away.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import BlocksEditor from './BlocksEditor'
import { setLang } from '../../lib/i18n.js'
import type { Item } from './types'

const ITEMS: Item[] = [
  { zone: 'easy', min: 10 },
  { repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] },
  { zone: 'easy', min: 5 },
]

const seen = vi.fn()
function Harness({ items = ITEMS }: { items?: Item[] }) {
  const [list, setList] = useState(items)
  return <BlocksEditor items={list} onChange={v => { seen(v); setList(v) }} />
}
const part = (name: string) => screen.getByRole('group', { name })
const last = () => seen.mock.calls.at(-1)![0] as Item[]

afterEach(() => { cleanup(); seen.mockReset() })

describe('BlocksEditor', () => {
  it('shows each item of the workout with its zone and minutes, and each repeat with its count', () => {
    render(<Harness />)
    expect((within(part('Part 1')).getByLabelText('Zone') as HTMLSelectElement).value).toBe('easy')
    expect((within(part('Part 1')).getByLabelText('Minutes') as HTMLInputElement).value).toBe('10')
    expect((within(part('Part 2')).getByLabelText('Repeats') as HTMLInputElement).value).toBe('5')
    expect((within(part('Part 2.1')).getByLabelText('Zone') as HTMLSelectElement).value).toBe('hard')
    expect((within(part('Part 2.2')).getByLabelText('Minutes') as HTMLInputElement).value).toBe('2')
    expect((within(part('Part 3')).getByLabelText('Minutes') as HTMLInputElement).value).toBe('5')
    // Zone names, in the order of the plan's zones.
    const options = [...(within(part('Part 1')).getByLabelText('Zone') as HTMLSelectElement).options].map(o => o.textContent)
    expect(options).toEqual(['Easy', 'Moderate', 'Hard zone', 'Walk'])
    // Nothing to add or remove.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('changes the zone and the minutes of a block, and the count of a repeat, leaving the rest', () => {
    render(<Harness />)
    fireEvent.change(within(part('Part 1')).getByLabelText('Zone'), { target: { value: 'moderate' } })
    fireEvent.change(within(part('Part 2.1')).getByLabelText('Minutes'), { target: { value: '3' } })
    fireEvent.change(within(part('Part 2')).getByLabelText('Repeats'), { target: { value: '6' } })
    expect(last()).toEqual([
      { zone: 'moderate', min: 10 },
      { repeat: 6, blocks: [{ zone: 'hard', min: 3 }, { zone: 'easy', min: 2 }] },
      { zone: 'easy', min: 5 },
    ])
    // The items it was given are not changed in place.
    expect(ITEMS[0]).toEqual({ zone: 'easy', min: 10 })
    expect(ITEMS[1]).toEqual({ repeat: 5, blocks: [{ zone: 'hard', min: 2 }, { zone: 'easy', min: 2 }] })
  })

  it('says why minutes out of 1 to 300 and repeats out of 2 to 20 are wrong', () => {
    render(<Harness />)
    const minutes = within(part('Part 1')).getByLabelText('Minutes') as HTMLInputElement
    for (const bad of ['0', '301', '']) {
      fireEvent.change(minutes, { target: { value: bad } })
      expect(screen.getByText('Minutes go from 1 to 300.')).toBeTruthy()
      expect(minutes.getAttribute('aria-invalid')).toBe('true')
    }
    // An empty field goes out as no number, which the check refuses.
    expect(Number.isNaN((last()[0] as { min: number }).min)).toBe(true)
    fireEvent.change(minutes, { target: { value: '300' } })
    expect(screen.queryByText('Minutes go from 1 to 300.')).toBeNull()
    expect(minutes.hasAttribute('aria-invalid')).toBe(false)

    const repeats = within(part('Part 2')).getByLabelText('Repeats') as HTMLInputElement
    for (const bad of ['1', '21']) {
      fireEvent.change(repeats, { target: { value: bad } })
      expect(screen.getByText('Repeats go from 2 to 20.')).toBeTruthy()
    }
    fireEvent.change(repeats, { target: { value: '20' } })
    expect(screen.queryByText('Repeats go from 2 to 20.')).toBeNull()
  })

  it('takes digits only', () => {
    render(<Harness />)
    const minutes = within(part('Part 1')).getByLabelText('Minutes') as HTMLInputElement
    fireEvent.change(minutes, { target: { value: '1a2,5' } })
    expect(minutes.value).toBe('125')
    expect((last()[0] as { min: number }).min).toBe(125)
  })

  it('speaks the language of the app', async () => {
    await setLang('pt-BR')
    try {
      render(<Harness />)
      expect(within(screen.getByRole('group', { name: 'Parte 2' })).getByLabelText('Repetições')).toBeTruthy()
      fireEvent.change(within(screen.getByRole('group', { name: 'Parte 1' })).getByLabelText('Minutos'), { target: { value: '0' } })
      expect(screen.getByText('Os minutos vão de 1 a 300.')).toBeTruthy()
    } finally { await setLang('en') }
  })
})
