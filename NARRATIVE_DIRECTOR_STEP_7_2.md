# Narrative Director — Etapa 7.2

## Status

**ND-002 e ND-003 corrigidos, aguardando validação.**

Esta rodada corrige a fronteira público/privado e substitui o tracker textual como editor principal. Não adiciona integrações externas ao roadmap.

## Arquivos alterados

- `extensions/narrative-director/src/core.js`
- `extensions/narrative-director/src/ui.js`
- `extensions/narrative-director/README.md`
- `extensions/narrative-director/tests/core.test.mjs`
- `extensions/narrative-director/tests/api.test.mjs`
- artefatos ignorados reconstruídos em `extensions/narrative-director/dist/`
- este relatório, `NARRATIVE_DIRECTOR_STEP_7_2.md`

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi alterado.

## ND-002: separação público/privado

A análise agora produz `publicPremise`, definido como somente a situação aparente que `{{user}}` e os personagens presentes podem conhecer no início.

O prompt declara explicitamente que:

- worldbuilding não é automaticamente público;
- segredos, spoilers, planos futuros, fatos desconhecidos, conhecimento limitado, revelações futuras, identidades e relações ocultas são privados;
- sociedades secretas, poderes ocultos, parentescos escondidos, planos e eventos futuros não devem gerar lorebook público;
- cartão e lorebook podem ficar vazios quando não houver conteúdo inicial seguro.

O resumo completo continua armazenado em `storySummary`, mas agora é contexto privado do Director, entregue como `settings.narrative.completeStorySummary`. Ele não participa do cartão, lorebook ou tracker.

### Cartão

O preview do cartão pode usar somente:

- `publicPremise`;
- `characterInformation` externamente observável e inicialmente segura;
- `cardAdditions` explicitamente seguras.

Mesmo que uma história antiga tenha `storySummary` entre as seleções, `createStory()` remove essa chave. Uma nova análise redefine a seleção para os três campos públicos permitidos.

### Lorebook

- A descrição usa `publicPremise`, nunca `storySummary`.
- As entradas continuam revisáveis e selecionáveis.
- Um array vazio de entradas é válido.
- Um lorebook vazio pode ser criado e associado quando o usuário confirmar.

### Defesa adicional

O parser e o preview rejeitam cópia literal de títulos/resumos/condições de segredos, objetivos privados ou estágios futuros nos campos públicos. Essa verificação complementa a instrução do modelo e a revisão humana; não pretende substituir análise semântica completa.

O preview mostra o aviso solicitado: `Confirm that these fields contain no unrevealed information.`

## ND-003: tracker estruturado

O tracker agora possui fonte de dados própria:

```text
currentStageId
trackerStages[]
  id
  title
  status: pending | current | completed
  completionSignals[]
  revealSecretIds[]
trackedSecrets[]
  id
  status: locked | revealed
  revealSignals[]
```

O parser valida:

- IDs únicos;
- status permitidos;
- sinais observáveis não vazios;
- `revealSecretIds` existentes;
- `currentStageId` existente e com status `current`;
- no máximo um estágio marcado como atual.

## Interface do tracker

A aba Tracker agora mostra:

- campo próprio para `currentStageId`;
- estágios recolhíveis com título, status, sinais e segredos revelados;
- segredos rastreados recolhíveis com status e sinais mínimos de revelação;
- botões para adicionar e remover entradas.

O antigo `progressionProjection` permanece somente dentro da área avançada como compatibilidade. Ele não é a fonte usada para construir o payload do tracker.

## Payloads

### Director

Recebe:

- documento privado;
- resumo completo privado;
- personagens privados;
- segredos e condições privadas;
- estágios narrativos privados;
- estado confirmado existente.

### Tracker

Recebe somente:

- `currentStageId`;
- estágios com IDs, títulos, status e sinais observáveis;
- IDs de segredos desbloqueados por estágio;
- segredos rastreados com ID, status e sinais observáveis de revelação.

Não recebe resumo completo, documento privado, objetivos privados, resumos de segredo, condições privadas de revelação ou condições narrativas privadas.

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

A cobertura inclui:

- definição estrita de público no prompt;
- permissão de campos públicos e lorebook vazios;
- rejeição de segredo copiado para cartão;
- rejeição de condição privada copiada para lorebook;
- ausência do resumo completo no preview público;
- uso exclusivo de `publicPremise` na descrição do lorebook;
- estrutura do tracker, sinais e referências;
- validação de estágio atual inexistente;
- validação de segredo rastreado inexistente;
- resumo completo presente no Director;
- resumo completo ausente do tracker;
- tracker contendo somente a estrutura observável;
- regressões da Etapa 7.1, incluindo resposta bruta em memória.

## Limitações

- A barreira determinística detecta cópia literal de valores privados. Paráfrases ou inferências continuam dependendo do prompt e da revisão humana.
- Sinais observáveis são texto curto produzido/editado pelo usuário; sua qualidade semântica depende de revisão.
- O campo textual legado permanece armazenado para compatibilidade, mas não é enviado como fonte principal ao tracker.
- Não foi adicionada migração complexa. Histórias antigas começam com a nova estrutura do tracker vazia até nova análise ou edição manual.

## Isolamento do núcleo

Toda a implementação permanece dentro da extensão oficial e destes relatórios. Nenhuma rota, schema, hook ou pipeline central do Marinara foi alterado.
