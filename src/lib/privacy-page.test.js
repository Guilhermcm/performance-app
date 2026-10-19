// The public privacy policy (public/privacidade.html) is served as a static page, outside the
// app's locale packs, so the public-copy rule from CLAUDE.md is checked here on its visible text.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ptBR from '../locales/pt-BR.js'

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
    expect(visible).toContain('Última atualização: 19 de outubro de 2026')
    expect(visible).toContain('Last updated: October 19, 2026')
  })

  it('covers the sleep pillar: what is kept, that it is optional and who sees it, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Pilar Sono')
    expect(pt).toContain('O pilar Sono é opcional e vem desligado')
    expect(pt).toContain('o horário em que deitou, o horário em que acordou, a duração, a nota de qualidade e a observação')
    expect(pt).toContain('Só você vê seus horários, a duração, a qualidade e as observações')
    expect(pt).toContain('Seus amigos veem o nível do pilar Sono e o XP')
    expect(pt).toContain('suas conquistas, menos as de nutrição, de sono e de hábitos')
    expect(en).toContain('Sleep pillar')
    expect(en).toContain('The Sleep pillar is optional and starts off')
    expect(en).toContain('the time you went to bed, the time you woke up, the duration, the quality rating and the note')
    expect(en).toContain('Only you see your times, duration, quality and notes')
    expect(en).toContain('Your friends see your Sleep pillar level and XP')
    expect(en).toContain('your achievements, except the nutrition, sleep and habit ones')
  })

  it('tells the sleep challenge needs opt-in and shows only the nights on target, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('No desafio de noites no alvo do Sono, você só entra se aceitar compartilhar essa contagem')
    expect(pt).toContain('quantas noites você ficou no alvo')
    expect(en).toContain('In the Sleep nights-on-target challenge, you can only join if you agree to share that count')
    expect(en).toContain('how many nights you were on target')
  })

  it('lists the nutrition and sleep challenge counts under consent (art. 7, I), in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('nos desafios, o volume e as contagens de dias no alvo da Nutrição, de noites no alvo do Sono e de checks dos Hábitos, depende do seu consentimento (art. 7º, I)')
    expect(en).toContain('in challenges, volume and the counts of Nutrition days on target, Sleep nights on target and Habit checks, depends on your consent (art. 7, I)')
  })

  it('covers the habits pillar: what is kept, that it is optional and who sees it, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Pilar Hábitos')
    expect(pt).toContain('O pilar Hábitos é opcional e vem desligado')
    expect(pt).toContain('o nome, o ícone e a meta semanal')
    expect(pt).toContain('os checks que você marca')
    expect(pt).toContain('Só você vê os nomes, os ícones, as metas e os checks dos seus hábitos')
    expect(pt).toContain('Seus amigos veem o nível do pilar Hábitos e o XP')
    expect(pt).toContain('se o pilar estava ligado nela')
    expect(en).toContain('Habits pillar')
    expect(en).toContain('The Habits pillar is optional and starts off')
    expect(en).toContain('the name, the icon and the weekly goal')
    expect(en).toContain('the checks you mark')
    expect(en).toContain('Only you see the names, icons, goals and checks of your habits')
    expect(en).toContain('Your friends see your Habits pillar level and XP')
    expect(en).toContain('whether the pillar was on that week')
  })

  it('tells the habit checks challenge needs opt-in and shows only the count, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('No desafio de checks de hábitos, você só entra se aceitar compartilhar essa contagem')
    expect(pt).toContain('quantos checks você marcou dentro das metas, nunca seus hábitos, os ícones ou os dias')
    expect(en).toContain('In the Habit checks challenge, you can only join if you agree to share that count')
    expect(en).toContain('how many checks you marked within your goals, never your habits, their icons or the days')
  })

  it('says unsent habits and checks stay on the device, and that deleting the account removes them', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('os hábitos e os checks que ainda não foram enviados')
    expect(pt).toContain('os hábitos com seus checks e metas')
    expect(en).toContain('habits and checks that have not been sent yet')
    expect(en).toContain('habits with their checks and goals')
  })

  it('covers trackers: what is kept, that only you see it and that nothing is shared, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('Trackers')
    expect(pt).toContain('O app só guarda dados de trackers depois que você cria o primeiro')
    expect(pt).toContain('o nome, o ícone, o tipo (número, duração ou rótulo), a unidade e, nos de rótulo, as opções')
    expect(pt).toContain('os registros que você faz, cada um com o dia, a hora, o valor e uma nota opcional')
    expect(pt).toContain('Só você vê seus trackers e seus registros')
    expect(pt).toContain('Nada deles vai para seus amigos, para o feed ou para os desafios, e eles não rendem XP')
    expect(en).toContain('Trackers')
    expect(en).toContain('The app keeps no tracker data until you create your first one')
    expect(en).toContain('the name, the icon, the type (number, duration or choice), the unit and, for choice trackers, the options')
    expect(en).toContain('the entries you log, each with the day, the time, the value and an optional note')
    expect(en).toContain('Only you see your trackers and entries')
    expect(en).toContain('None of it goes to your friends, the feed or challenges, and it earns no XP')
  })

  it('says unsent trackers and entries stay on the device, and that deleting the account removes them', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('os trackers e os registros que ainda não foram enviados')
    expect(pt).toContain('os trackers com seus registros')
    expect(pt).toContain('as suas noites de sono, os seus hábitos ou os seus trackers')
    expect(pt).toContain('as noites de sono e os registros dos trackers podem dizer algo sobre a sua saúde')
    expect(en).toContain('trackers and entries that have not been sent yet')
    expect(en).toContain('trackers with their entries')
    expect(en).toContain('your sleep nights, your habits or your trackers')
    expect(en).toContain('your sleep nights and your tracker entries can say something about your health')
  })

  it('covers running: what is kept, what only you see and what friends see, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('A corrida é opcional')
    expect(pt).toContain('a sua meta, o prazo, os seus ritmos e os treinos de cada semana')
    expect(pt).toContain('a distância, o esforço de 1 a 10 e os blocos que você correu')
    expect(pt).toContain('Só você vê o plano, a meta, o prazo, os ritmos, o esforço e os blocos')
    expect(pt).toContain('seus amigos veem apenas o tipo de treino e a distância')
    expect(pt).toContain('os check-ins de corrida que ainda não chegaram ao servidor')
    expect(en).toContain('Running is optional')
    expect(en).toContain('your goal, the deadline, your paces and each week\'s workouts')
    expect(en).toContain('the distance, the effort from 1 to 10 and the blocks you ran')
    expect(en).toContain('Only you see the plan, the goal, the deadline, the paces, the effort and the blocks')
    expect(en).toContain('your friends see only the workout type and the distance')
    expect(en).toContain('running check-ins that have not reached the server yet')
  })

  it('says the device keeps a copy of the recent check-ins, 14 days with the run data (1e-b final review M4)', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('da área social e dos seus check-ins dos últimos 14 dias')
    expect(pt).toContain('uma cópia do plano e dos seus check-ins recentes (os dos últimos 14 dias, com os dados de corrida)')
    expect(en).toContain('social data and of your check-ins from the last 14 days')
    expect(en).toContain('a copy of the plan and of your recent check-ins (those from the last 14 days, with their running data)')
  })

  it('lists the running plan, effort and blocks among what nobody sees, and the run type and distance among what friends see', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('a observação privada dos check-ins, o plano de corrida, o esforço e os blocos, o seu diário alimentar')
    expect(en).toContain('the private note on your check-ins, your running plan, effort and blocks, your food diary')
    expect(pt).toContain('o dia e a duração e, num check-in de corrida, o tipo de treino e a distância')
    expect(en).toContain('the day and the duration and, on a running check-in, the workout type and the distance')
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

  it('names the two Profile controls exactly as the app shows them, and not the removed switch', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    for (const key of ['Default check-in visibility', 'Show friends my workouts from before check-ins']) {
      expect(pt, key).toContain(ptBR[key])
      expect(en, key).toContain(key)
    }
    expect(visible).not.toContain('Compartilhar treinos e PRs com amigos')
    expect(visible).not.toContain('Share workouts and PRs with friends')
    // The old switch now covers only the workouts from before the check-ins, and not the check-ins.
    expect(pt).toContain('Essa opção não muda seus check-ins')
    expect(en).toContain('This switch does not change your check-ins')
  })

  it('says access ends at once for new requests and an open photo link lasts up to 1 hour, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('o acesso acaba na hora para novos pedidos')
    expect(pt).toContain('expira em até 1 hora')
    expect(en).toContain('access ends right away for new requests')
    expect(en).toContain('expires within 1 hour')
    expect(pt).not.toContain('deixa de ver seus check-ins na hora')
    expect(en).not.toContain('stops seeing your check-ins right away')
  })

  it('lists the routine name among what friends see on a check-in, in both languages', () => {
    const pt = visible.slice(0, visible.indexOf('Privacy Policy'))
    const en = visible.slice(visible.indexOf('Privacy Policy'))
    expect(pt).toContain('a foto, a atividade, o nome da rotina, o título')
    expect(en).toContain('the photo, the activity, the routine name, the title')
  })

  it('uses no dash as a pause in its visible text', () => {
    const hits = visible.match(/.{0,30}(?:[—–]|\s-\s).{0,30}/g) || []
    expect(hits).toEqual([])
  })
})
