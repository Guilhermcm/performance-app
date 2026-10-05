import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const REQUIRED = ['--background', '--foreground', '--card', '--card-foreground', '--primary',
  '--primary-foreground', '--muted', '--muted-foreground', '--border', '--input', '--ring',
  '--destructive', '--pillar-strength', '--pillar-nutrition', '--pillar-sleep', '--pillar-habits',
  '--radius', '--ease-out', '--dur-1', '--dur-2', '--dur-3']

const block = (selector: string) => {
  const i = css.indexOf(selector + ' {')
  if (i < 0) return ''
  return css.slice(i, css.indexOf('}', i))
}

describe('tokens.css', () => {
  it.each(REQUIRED)('defines %s for the dark theme', token => {
    expect(block(':root')).toContain(token + ':')
  })
  it('redefines every colour token for the light theme', () => {
    const light = block(':root[data-theme="light"]')
    for (const t of REQUIRED.filter(t => !['--radius', '--ease-out', '--dur-1', '--dur-2', '--dur-3'].includes(t))) {
      expect(light).toContain(t + ':')
    }
  })
})
