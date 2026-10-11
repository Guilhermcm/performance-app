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
    expect(visible).toContain('Última atualização: 11 de outubro de 2026')
    expect(visible).toContain('Last updated: October 11, 2026')
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

  it('covers check-in photos in Storage, visibility and metadata removal in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Check-ins com foto')
    expect(pt).toContain('Supabase Storage')
    expect(pt).toContain('balde privado')
    expect(pt).toContain('link temporário de 1 hora')
    expect(pt).toContain('Amigos ou Só eu')
    expect(pt).toContain('Check-in privado')
    expect(pt).toContain('remove os metadados')
    expect(pt).toContain('localização')
    expect(en).toContain('Photo check-ins')
    expect(en).toContain('Supabase Storage')
    expect(en).toContain('private bucket')
    expect(en).toContain('temporary 1-hour link')
    expect(en).toContain('Friends or Only me')
    expect(en).toContain('Private check-in')
    expect(en).toContain('removes the metadata')
    expect(en).toContain('location')
  })

  it('says the private note and the workout detail never leave the account, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Só você vê a observação privada e o detalhe do treino')
    expect(pt).toContain('nunca saem da sua conta')
    expect(en).toContain('Only you see the private note and the workout detail')
    expect(en).toContain('never leave your account')
  })

  it('says reactions and comments follow who can see the post, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('As reações e os comentários ficam visíveis para quem pode ver o check-in')
    expect(en).toContain('Reactions and comments are visible to whoever can see the check-in')
  })

  it('says photos are deleted with the check-in and with the account, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Ao apagar um check-in, a foto some do Supabase Storage junto com ele')
    expect(pt).toContain('Antes de excluir a conta, o app apaga todas as suas fotos do Storage')
    expect(en).toContain('When you delete a check-in, the photo is removed from Supabase Storage with it')
    expect(en).toContain('Before deleting the account, the app deletes all your photos from Storage')
  })

  it('says unsent check-ins and photos stay on the device until they go up, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('check-ins e fotos que ainda não foram enviados')
    expect(en).toContain('check-ins and photos that have not been sent yet')
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
