// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup, waitFor } from '@testing-library/react'
import { useAppTheme } from './sonner'

afterEach(() => { cleanup(); delete document.documentElement.dataset.theme })

describe('useAppTheme', () => {
  it('follows the theme the app writes on <html>, live', async () => {
    document.documentElement.dataset.theme = 'light'
    const { result } = renderHook(() => useAppTheme())
    expect(result.current).toBe('light')
    act(() => { document.documentElement.dataset.theme = 'dark' })
    await waitFor(() => expect(result.current).toBe('dark'))
  })

  it('is dark when the app has not set one yet (the app default)', () => {
    const { result } = renderHook(() => useAppTheme())
    expect(result.current).toBe('dark')
  })
})
