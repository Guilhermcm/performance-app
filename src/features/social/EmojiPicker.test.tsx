// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

import { EmojiPicker, QUICK_EMOJIS, emojiProblem } from './EmojiPicker'

afterEach(cleanup)

const paste = (v: string) => {
  fireEvent.change(screen.getByLabelText('Paste any emoji'), { target: { value: v } })
  fireEvent.click(screen.getByRole('button', { name: 'Use' }))
}

describe('emojiProblem', () => {
  it('takes exactly one emoji, skin tones, flags and keycaps included', () => {
    for (const e of ['💪', '🦄', '👍🏽', '🇧🇷', '❤️', '1️⃣', '🏳️‍🌈', ' 🔥 ']) expect(emojiProblem(e)).toBeNull()
  })

  it('refuses text, two emojis and nothing', () => {
    for (const e of ['', 'a', 'ok', '1', '💪💪', '💪a', 'kkk']) expect(emojiProblem(e)).toBe('not_one')
  })

  it('refuses an emoji over the 16 bytes the server keeps', () => {
    expect(emojiProblem('👨‍👩‍👧‍👦')).toBe('too_long')
  })
})

describe('EmojiPicker', () => {
  it('starts with the shortcuts 💪 🔥 👏 😂 😮', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} />)
    expect(QUICK_EMOJIS).toEqual(['💪', '🔥', '👏', '😂', '😮'])
    const quick = screen.getByRole('group', { name: 'Quick reactions' })
    expect(within(quick).getAllByRole('button').map(b => b.textContent)).toEqual(QUICK_EMOJIS)
    fireEvent.click(within(quick).getByRole('button', { name: '🔥' }))
    expect(onPick).toHaveBeenCalledWith('🔥')
  })

  it('lists common emojis by category', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} />)
    for (const name of ['Faces', 'Gestures', 'Sports', 'Food', 'Nature', 'Symbols']) {
      expect(screen.getByRole('group', { name })).toBeTruthy()
    }
    fireEvent.click(within(screen.getByRole('group', { name: 'Sports' })).getByRole('button', { name: '🏋️' }))
    expect(onPick).toHaveBeenCalledWith('🏋️')
  })

  it('takes a pasted emoji', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} />)
    paste(' 🦄 ')
    expect(onPick).toHaveBeenCalledWith('🦄')
  })

  it('refuses pasted text and says why', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} />)
    paste('haha')
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText('Paste a single emoji.')).toBeTruthy()
    expect(screen.getByLabelText('Paste any emoji').getAttribute('aria-invalid')).toBe('true')
    paste('👨‍👩‍👧‍👦')
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByText('This emoji doesn’t work here. Try another one.')).toBeTruthy()
  })

  it('marks the emojis already chosen, and at 10 only lets them be taken back', () => {
    const onPick = vi.fn()
    render(<EmojiPicker onPick={onPick} chosen={['💪']} full />)
    expect(screen.getByText('You already left 10 reactions here. Remove one to add another.')).toBeTruthy()
    const quick = screen.getByRole('group', { name: 'Quick reactions' })
    const flex = within(quick).getByRole('button', { name: '💪' })
    expect(flex.getAttribute('aria-pressed')).toBe('true')
    expect((within(quick).getByRole('button', { name: '🔥' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(flex)
    expect(onPick).toHaveBeenCalledWith('💪')
    paste('🦄')
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
