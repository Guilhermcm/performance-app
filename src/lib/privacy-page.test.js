// The public privacy policy (public/privacidade.html) is served as a static page, outside the
// app's locale packs, so the public-copy rule from CLAUDE.md is checked here on its visible text.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const html = readFileSync(fileURLToPath(new URL('../../public/privacidade.html', import.meta.url)), 'utf8')

// What a reader sees: no head, styles, scripts, comments or tags; entities left as they are.
const visible = html
  .replace(/<head[\s\S]*?<\/head>/i, ' ')
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')

describe('privacy policy page', () => {
  it('gives the contact e-mail', () => {
    expect(visible).toContain('guilhermemendonca.cm@gmail.com')
  })

  it('has the English version and the update date', () => {
    expect(html).toContain('id="en"')
    expect(visible).toContain('Última atualização: 5 de outubro de 2026')
  })

  it('points to the self-service account deletion in both languages', () => {
    expect(visible).toContain('Perfil &gt; Excluir minha conta')
    expect(visible).toContain('Profile &gt; Delete my account')
  })

  it('uses no dash as a pause in its visible text', () => {
    const hits = visible.match(/.{0,30}(?:[—–]|\s-\s).{0,30}/g) || []
    expect(hits).toEqual([])
  })
})
