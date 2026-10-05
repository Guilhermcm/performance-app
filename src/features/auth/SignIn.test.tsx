// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const { go, cfg } = vi.hoisted(() => ({ go: vi.fn(async () => {}), cfg: { configured: true } }))
vi.mock('./auth', () => ({ signInWithGoogle: () => go() }))
vi.mock('@/lib/supabase', () => ({ get supabaseConfigured() { return cfg.configured } }))

import SignIn from './SignIn'

afterEach(() => { cleanup(); go.mockReset(); cfg.configured = true })

describe('SignIn', () => {
  it('starts Google sign-in from the main button', async () => {
    render(<SignIn />)
    fireEvent.click(screen.getByRole('button', { name: /google/i }))
    expect(go).toHaveBeenCalledOnce()
  })

  it('shows what went wrong and lets the user try again', async () => {
    go.mockRejectedValueOnce(new Error('provider disabled'))
    render(<SignIn />)
    fireEvent.click(screen.getByRole('button', { name: /google/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('provider disabled')
    expect((screen.getByRole('button', { name: /google/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('links to the public privacy policy page', () => {
    render(<SignIn />)
    const link = screen.getByRole('link', { name: /privac/i })
    expect(link.getAttribute('href')).toBe('/privacidade')
  })

  it('says so and keeps the button off when the server is not configured', () => {
    cfg.configured = false
    render(<SignIn />)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect((screen.getByRole('button', { name: /google/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
