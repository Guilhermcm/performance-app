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
