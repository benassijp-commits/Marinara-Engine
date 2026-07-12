# Narrative Director — Etapa 7.1

## Status

**ND-001 corrigido e estrutura narrativa privada implementada, aguardando validação.**

Esta entrega não adiciona integrações externas nem altera os fluxos de cartão, lorebook, inicialização de chat ou ativação criados nas Etapas 3–6.

## Arquivos alterados

- `extensions/narrative-director/src/core.js`
- `extensions/narrative-director/src/api.js`
- `extensions/narrative-director/src/ui.js`
- `extensions/narrative-director/src/extension.css`
- `extensions/narrative-director/tests/core.test.mjs`
- `extensions/narrative-director/tests/api.test.mjs`
- `extensions/narrative-director/tests/storage.test.mjs`
- `extensions/narrative-director/README.md`
- artefatos reconstruídos e ignorados em `extensions/narrative-director/dist/`
- este relatório, `NARRATIVE_DIRECTOR_STEP_7_1.md`

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi alterado.

## Correção ND-001

O prompt de análise agora:

- exige que todos os valores legíveis sejam escritos no idioma predominante do texto fonte;
- exige explicitamente que `trackerProjection` seja uma string não vazia;
- descreve as novas coleções narrativas privadas e suas relações;
- instrui o modelo a não marcar um segredo como revelado somente porque ele aparece no planejamento privado.

O parser mantém strings válidas e normaliza objetos ou arrays JSON não vazios de `trackerProjection` para uma string JSON indentada. Valores `null`, strings vazias, objetos vazios e arrays vazios continuam rejeitados.

## Resposta bruta em memória

`api.js` mantém a última `rewrittenText` de análise em uma variável privada da instância da API antes de executar o parser. Assim, uma falha de parsing não destrói a evidência útil para diagnóstico.

A aba Story possui uma seção recolhível **Raw AI response** que:

- aparece após análise bem-sucedida ou erro de parsing;
- mostra a resposta integral em texto;
- oferece cópia para a área de transferência;
- avisa que o conteúdo pode incluir a história completa e dados privados;
- é apagada ao fechar o painel e no cleanup/reload da extensão.

A resposta bruta não pertence ao objeto de história. Portanto, ela não entra no IndexedDB, importação/exportação, logs ou diagnóstico sanitizado.

## Estrutura narrativa privada

As histórias agora armazenam três coleções editáveis:

### Personagens privados

- `id`
- `name`
- `role`
- `privateGoal`

### Segredos

- `id`
- `title`
- `ownerCharacterId`
- `knownByCharacterIds`
- `status`: `locked` ou `revealed`
- `summary`
- `revealCondition`

### Estágios narrativos

- `id`
- `title`
- `status`: `pending`, `current` ou `completed`
- `completionCondition`
- `relatedSecretIds`

O parser valida IDs duplicados, proprietário do segredo, personagens conhecedores e referências de estágio para segredo. Os IDs são preservados literalmente entre parsing, persistência e exportação.

Histórias antigas sem as coleções recebem listas vazias. Não foi adicionada migração complexa.

## Interface

A aba Director mostra três grupos com entradas recolhíveis. Cada entrada possui campos próprios, em vez de um editor JSON único. É possível:

- expandir e recolher entradas;
- editar todos os campos;
- adicionar personagens, segredos e estágios;
- remover entradas individualmente;
- informar vários conhecedores ou segredos relacionados usando IDs separados por vírgula.

O documento textual privado continua disponível como visão complementar.

## Fronteira Director/tracker

O payload do Director contém:

- documento privado complementar;
- personagens privados;
- segredos completos;
- condições de revelação;
- estágios e condições de conclusão;
- estado confirmado do chat, quando existente.

O payload do tracker contém somente:

- IDs de todos os estágios;
- ID do estágio atual;
- IDs dos estágios/eventos concluídos;
- IDs dos segredos revelados;
- IDs dos segredos bloqueados.

O tracker não recebe resumos ou condições de segredos bloqueados, objetivos privados, condições de conclusão ou o documento privado. Além de construir um payload mínimo, o gerador rejeita configurações cujo prompt contenha qualquer um desses valores privados.

## Testes executados

Em `extensions/narrative-director`:

```text
npm test
  3 arquivos de teste aprovados
  0 falhas

npm run build
  Built 4 modules into dist/extension.js

node --check dist/extension.js
  aprovado, sem erros de sintaxe
```

A cobertura adicionada verifica:

- instrução de preservação do idioma no prompt;
- exigência de `trackerProjection` string;
- preservação de string válida;
- normalização de objeto e array;
- rejeição de string, objeto, array ou valor nulo vazio;
- resposta bruta disponível depois de erro de parsing;
- limpeza explícita da resposta bruta;
- ausência da resposta bruta em história, IndexedDB e exportação;
- segredo associado ao personagem proprietário;
- múltiplos personagens conhecendo um segredo;
- estabilidade dos IDs;
- estados `locked` e `revealed`;
- relação entre estágio e segredo;
- estrutura completa presente no Director;
- tracker limitado a IDs e estados;
- ausência de resumo, condição e objetivos privados no tracker;
- rejeição de prompt de tracker contaminado com conteúdo privado.

## Limitações

- A revisão de relações usa IDs editáveis; o painel não oferece autocomplete nesta correção.
- A qualidade semântica da extração e a escolha do idioma ainda dependem do modelo, embora o contrato esteja explícito e validado estruturalmente.
- A resposta bruta existe somente até fechar o painel ou recarregar a extensão. Isso é intencional para evitar persistência acidental de conteúdo sensível.
- Remover um personagem ou segredo referenciado torna a estrutura inválida e bloqueia validação/ativação até o usuário corrigir as referências.

## Isolamento do núcleo

Toda a implementação permanece na extensão oficial e neste relatório. Não foram alterados hooks, rotas, schemas, pipeline ou arquivos centrais do Marinara.
