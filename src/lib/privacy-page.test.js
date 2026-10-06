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
    expect(visible).toContain('Última atualização: 6 de outubro de 2026')
    expect(visible).toContain('Last updated: October 6, 2026')
  })

  it('covers the nutrition pillar and Open Food Facts in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Nutrição')
    expect(pt).toContain('Open Food Facts')
    expect(en).toContain('Nutrition')
    expect(en).toContain('Open Food Facts')
  })

  it('tells friends can see balanced days and whether the pillar was on in a week', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('refeições equilibradas')
    expect(pt).toContain('se o pilar estava ligado')
    expect(en).toContain('balanced-meals day')
    expect(en).toContain('whether the pillar was on')
  })

  it('covers personal household measures in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('medidas caseiras pessoais')
    expect(pt).toContain('o nome da medida e o peso dela em gramas')
    expect(pt).toContain('Só você vê as suas medidas')
    expect(en).toContain('personal household measures')
    expect(en).toContain('the name of the measure and its weight in grams')
    expect(en).toContain('Only you see your measures')
  })

  it('tells the nutrition challenge needs opt-in and shows only the days on target', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('desafio de dias no alvo')
    expect(pt).toContain('só entra se aceitar compartilhar essa contagem')
    expect(pt).toContain('quantos dias você ficou na meta')
    expect(en).toContain('days-on-target challenge')
    expect(en).toContain('only join if you agree to share that count')
    expect(en).toContain('how many days you were on target')
  })

  it('points to the self-service account deletion in both languages', () => {
    expect(visible).toContain('Perfil &gt; Excluir minha conta')
    expect(visible).toContain('Profile &gt; Delete my account')
  })

  it('says unsent diary items stay on the device across sign-out, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('ainda não foram enviados ficam guardados no aparelho e sobem na próxima vez que a mesma conta entrar')
    expect(en).toContain('have not been sent yet stay saved on the device and go up the next time the same account signs in')
  })

  it('uses no dash as a pause in its visible text', () => {
    const hits = visible.match(/.{0,30}(?:[—–]|\s-\s).{0,30}/g) || []
    expect(hits).toEqual([])
  })
})
