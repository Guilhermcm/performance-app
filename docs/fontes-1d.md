# Conferência das fontes da fase 1d

O catálogo está em `src/features/plan/references.ts`. As citações vieram de busca na web (PubMed, PMC,
editoras) em 2026-10-12. Não foi possível abrir as páginas nem resolver os DOIs a partir do ambiente de
desenvolvimento. Quem revisar o PR confere esta lista antes do merge. Uma referência que não se confirmar
sai do catálogo, e a recomendação que dependia só dela sai ou perde o número.

## Checklist (spec §7.3)

- [ ] 1. Cada DOI abre o artigo certo em doi.org.
- [ ] 2. Pelland 2025: volume, edição e páginas impressos e a lista de autores. Até lá, a citação mostra só o nome da revista ("Sports Med"); preencher `journal` em `references.ts` com volume, edição e páginas.
- [ ] 3. As linhas "o que o estudo achou" (escritas a partir dos resumos, sem número que não esteja no resumo). A linha do acsm2009 foi reescrita como conclusão, sem número: "Adultos saudáveis devem progredir aumentando a carga ou o volume aos poucos." Conferir se o texto do ACSM 2009 sustenta isso.
- [ ] 4. As três faixas semanais da spec §5.2 e a recomendação de frequência.
- [ ] 5. A recomendação de saúde geral da OMS para fortalecimento muscular (texto exato).
- [ ] 6. Se o ACSM 2009 recomenda equilíbrio entre grupos opostos (spec §5.4). Se não, o ⓘ do equilíbrio continua como "regra prática".
- [ ] 7. Se o ACSM 2026 (Currier et al., 10.1249/MSS.0000000000003897, encontrado na busca, não conferido) deve substituir o de 2009.

## Textos dos programas

As frases de "Por que é assim" (`src/features/plan/program-copy.tsx`) aparecem com o ⓘ das referências
do programa. Conferir se cada uma se sustenta nelas.

- [ ] Full Body e Superior/Inferior: treinar cada músculo 2 vezes por semana deu mais ganho que 1 vez
  (schoenfeld2016).
- [ ] PPL: o mesmo fato para a versão de 6 dias, e 3 ou 4 séries de 8 a 15 repetições com 2 min de
  descanso nos multiarticulares (schoenfeld2017, schoenfeld2016rest).
- [ ] 5×5: poucas repetições com carga alta treinam força (schoenfeld2021, incluído nas referências de
  força) e descansar mais ajudou a força nos multiarticulares (grgic2018rest).
- [ ] PHUL: nos dias pesados, 3 min de descanso nos básicos; os acessórios desses dias ficam em 8 a 10
  repetições com 90 s.
- [ ] Treino curto: treinos curtos com multiarticulares podem dar força e músculo (iversen2021).
- [ ] Saúde geral: as recomendações de saúde incluem fortalecer o corpo todo toda semana (who2020).
- [ ] A faixa de força de 4 a 6 repetições que a sugestão "adicionar exercício" grava
  (`src/features/plan/suggestions.ts`) não tem linha na spec nem fonte. Com ela, uma mesa flexora
  sugerida no perfil força entraria em 3 × 4 a 6.
- [ ] OMS 2020 e ACSM 2009 não dão número de séries por músculo na semana. Conferir se sustentam a
  faixa de saúde de 4 a 10 ou se ela fica como proposta do app.

### Alertas que o próprio catálogo dispara

Depois da correção da contagem (secundário só quando os dados do exercício o citam, revisão final I1),
os programas analisados no próprio perfil não acusam desequilíbrio nem músculo grande esquecido. Os
alertas abaixo continuam e estão fixados em `src/features/plan/programs.test.ts`. O código não muda o
conteúdo dos programas; a pergunta é se o programa ou a faixa deve mudar.

| Programa, perfil | Alertas | Pergunta |
|---|---|---|
| Full Body, saúde | ombros 11 e glúteos 11 acima de 10 | Aceitar 1 série acima do topo no perfil saúde? |
| Full Body, hipertrofia | peito 6, costas 9, bíceps 8,5, tríceps 6,5, quadríceps 9, posterior 9, panturrilha 8 abaixo de 10; tríceps em 1 dia | O programa de iniciante sugerido pelo app fica abaixo do mínimo em 7 grupos. Subir séries ou aceitar volume de iniciante? |
| Superior/Inferior, hipertrofia | peito 8, bíceps 9, tríceps 9 abaixo de 10 | Uma série a mais no supino e nos braços? |
| PPL 3 dias, hipertrofia | tríceps 9,5, posterior 9,5, panturrilha 9 abaixo de 10; frequência de todos os grupos | A frequência é esperada (o detalhe avisa). E o volume? |
| PPL 6 dias, hipertrofia | costas 22, ombros 30, bíceps 23 acima de 20 | Ombros recebem 0,5 dos supinos e dos deltoides posteriores das remadas. Menos ombro direto? |
| 5×5, força | costas 15, ombros 15, glúteos 15 acima de 12; panturrilha 5 abaixo de 6 | O peito, que a revisão viu em 15, agora fica em 10. As três linhas acima de 12 são esperadas num 5×5? |
| PHUL, força | costas, ombros, quadríceps, posterior, glúteos e panturrilha acima de 12 | A faixa de força lê os dias de hipertrofia como volume extra. Esperado? |
| PHUL, hipertrofia | peito 7 abaixo de 10 | Só supino e supino inclinado. Mais séries de peito? |
| Treino curto, saúde | peito 3, bíceps 3, tríceps 3, panturrilha 3 abaixo de 4 | Sem braço nem panturrilha por desenho. Aceitar? |
| Saúde geral, saúde | bíceps 3 e tríceps 3 abaixo de 4 | Sem braço direto por desenho. Aceitar? |

Abdômen abaixo do mínimo (e com frequência baixa na hipertrofia) aparece em quase todos: os programas
têm no máximo um exercício de abdômen. Está aceito no teste.

## Referências

| Id | DOI | O que conferir | Conferido |
|---|---|---|---|
| schoenfeld2017 | 10.1080/02640414.2016.1210197 | Abre o artigo certo. Mais séries por semana, mais hipertrofia, com retorno decrescente. | [ ] |
| schoenfeld2016 | 10.1007/s40279-016-0543-8 | Abre o artigo certo. Treinar cada músculo 2 vezes por semana deu mais hipertrofia que 1 vez. | [ ] |
| pelland2025 | 10.1007/s40279-025-02344-w | Abre o artigo certo. Autores, volume, edição e páginas. Volume maior, mais músculo e força, retorno decrescente. | [ ] |
| acsm2009 | 10.1249/MSS.0b013e3181915670 | Abre o artigo certo. É um modelo de progressão para adultos saudáveis. Recomenda equilíbrio entre grupos opostos? | [ ] |
| who2020 | 10.1136/bjsports-2020-102955 | Abre o artigo certo. Texto exato da recomendação de fortalecimento muscular para adultos. | [ ] |
| ralston2017 | 10.1007/s40279-017-0762-7 | Abre o artigo certo. Mais séries por semana, mais força, com retorno decrescente. | [ ] |
| schoenfeld2016rest | 10.1519/JSC.0000000000001272 | Abre o artigo certo. Descanso mais longo ajudou força e músculo em homens treinados, em multiarticulares. | [ ] |
| schoenfeld2021 | 10.3390/sports9020032 | Abre o artigo certo. Ganhos em uma faixa ampla de repetições. | [ ] |
| grgic2018freq | 10.1007/s40279-018-0872-x | Abre o artigo certo. Com o mesmo volume semanal, treinar mais vezes não fez diferença clara na força. | [ ] |
| plotkin2022 | 10.7717/peerj.14142 | Abre o artigo certo. Progredir repetições ou carga funcionou. | [ ] |
| iversen2021 | 10.1007/s40279-021-01490-1 | Abre o artigo certo. Treino curto com multiarticulares pode dar força e músculo. | [ ] |
| grgic2018rest | 10.1007/s40279-017-0788-x | Abre o artigo certo. Descanso mais longo ajudou ganho de força em multiarticulares. | [ ] |
