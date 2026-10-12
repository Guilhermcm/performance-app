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
