# Dados da TACO

`taco-4ed.csv` tem os 597 alimentos da Tabela Brasileira de Composição de Alimentos (TACO), 4ª
edição, por 100 g: energia (kcal), proteína, carboidrato, lipídeos e fibra alimentar. O
`scripts/build-taco.mjs` transforma este arquivo em `src/features/nutrition/data/taco.json`.

## Origem

- Planilha oficial: `Taco_4a_edicao_2011.xls`, publicada pelo NEPA/Unicamp em
  https://www.nepa.unicamp.br/taco/ (arquivo original em https://www.nepa.unicamp.br/).
- Cópia usada: repositório público MIT https://github.com/brolesi/taco, commit
  `4b8a38496c4e9a7bfab96c1ed526b6380fec41e7`, que guarda a planilha em
  `data/raw/taco/Taco_4a_edicao_2011.xls` e o CSV tratado em
  `data/processed/taco/taco_composicao.csv`.
- Este CSV vem do CSV tratado, com valores arredondados para 1 casa decimal. Células "Tr" (traço)
  da planilha ficam como `Tr`; "NA", "*" e vazios ficam em branco.

## Termos de uso

A publicação oficial (página ii da 4ª edição ampliada e revisada) diz: "Tabela Brasileira de
Composição de Alimentos – TACO é uma publicação do NEPA. É permitida a reprodução total ou parcial
do material, desde que seja citada a fonte."

Citação: NEPA/UNICAMP. Tabela Brasileira de Composição de Alimentos (TACO). 4ª ed. Campinas, 2011.

## Conferência

Os 597 registros foram comparados com a planilha oficial (.xls) por número, nome e as cinco
colunas: todos os valores numéricos coincidem, e cada "Tr" da planilha aparece como `Tr` aqui.
As exceções de kcal estão em `KCAL_EXCEPTIONS`, no `build-taco.mjs`.

# Medidas caseiras da POF

`pof-medidas.csv` tem as 11.801 linhas da Tabela de Medidas Referidas para os Alimentos Consumidos
no Brasil, da Pesquisa de Orçamentos Familiares (POF) 2008-2009 do IBGE: o peso em gramas de cada
medida caseira ("colher de sopa", "concha", "fatia") por alimento e preparo. `taco-pof-map.csv`
liga cada alimento da TACO a um alimento e um preparo da POF, e o `scripts/build-taco.mjs` usa os
dois para gerar `src/features/nutrition/data/taco-measures.json`.

## Origem

- Planilha oficial: `tabelamedidas_bd.xls` (aba "Tab_Medidas Caseiras"), no pacote
  https://ftp.ibge.gov.br/Orcamentos_Familiares/Pesquisa_de_Orcamentos_Familiares_2008_2009/Tabela_de_Medidas_Referidas_para_os_Alimentos_Consumidos_no_Brasil/tabelamedidas_bd.zip
  publicado pelo IBGE.
- Cópia usada: o mesmo repositório https://github.com/brolesi/taco, commit
  `4b8a38496c4e9a7bfab96c1ed526b6380fec41e7`, arquivo `data/processed/pof/pof_medidas_caseiras.csv`,
  gerado por `scripts/process_pof.py` a partir da planilha. O nosso CSV é esse arquivo sem
  mudança, com três linhas `#` de procedência no topo.

## Conferência

As 11.801 linhas foram comparadas com a planilha oficial (.xls): código e descrição do alimento,
preparo, medida, gramas e fonte coincidem em todas.

## Mapa TACO x POF

`taco-pof-map.csv` (`taco_id,pof_codigo_alimento,pof_codigo_preparacao,nota`) cobre 113 alimentos
comuns. `node scripts/suggest-taco-pof-map.mjs` propõe candidatos pelo nome; cada linha foi
conferida à mão, e a coluna `nota` explica os casamentos que não são óbvios (a POF agrupa os
feijões comuns, por exemplo). As regras que escolhem as medidas de cada alimento (rótulos, pesos
copiados de outra medida, faixas plausíveis e exclusões) estão no `build-taco.mjs`, junto de
`POF_LABEL`, `PLAUSIBLE_G` e `MEASURE_EXCLUSIONS`.

Citação: Medidas: POF 2008-2009, IBGE.
