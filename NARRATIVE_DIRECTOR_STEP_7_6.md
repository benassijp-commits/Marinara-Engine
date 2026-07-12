# Narrative Director — correção ND-008

## Status

**ND-008 implementado, aguardando validação.** A correção remove completamente as estruturas redundantes; não foi criada migração ou camada de compatibilidade.

## Resultado

O contrato contemporâneo de análise termina em `narrativeArcs` e `candidateBeats`. A IA não recebe mais pedidos para gerar uma segunda representação linear ou textual da mesma história.

O tracker é derivado localmente de:

- `secrets`, reduzidos a `id` e `status`;
- `narrativeArcs`, com estado observado, momentum e evidência conservadora de impossibilidade;
- `candidateBeats`, com IDs relacionados, pré-requisitos, sinais observáveis e bloqueadores.

`setupStrategies`, conteúdo dos segredos, objetivos privados e condições privadas continuam fora do tracker.

## Campos removidos

- `progressionProjection`;
- `narrativeStages`;
- `currentStageId`;
- `trackerStages`;
- `trackedSecrets`;
- `trackerProjection`;
- `trackerProgression` dentro do estado inicial linear.

Esses campos não são mais gerados, normalizados, persistidos, exportados, editados ou enviados a agentes. Se aparecerem em um objeto fornecido a `createStory`, são ignorados.

## Referências e código eliminados

- normalizador exclusivo de tracker linear;
- normalizador textual de `trackerProjection`;
- validação cruzada entre stages e tracked secrets;
- builder de estado estruturado legado;
- validações de current stage e stage único;
- macro `narrative.structuredState` e payload correspondente;
- editor de narrative stages;
- editor de current stage;
- editor de tracker stages;
- editor de tracked secrets redundantes;
- textarea de legacy projection;
- seção avançada de compatibilidade;
- handlers de adicionar/remover estruturas legadas;
- campos de tracker stage na revisão da inicialização;
- testes cujo único objetivo era normalizar ou preservar o formato antigo.

Os nomes antigos permanecem apenas em testes negativos que verificam sua ausência no prompt, no modelo local, em exportações e nos payloads.

## Estruturas mantidas

- `publicPremise`;
- `storySummary` privado;
- `privateCharacters`;
- `secrets`;
- `narrativeArcs`;
- `candidateBeats`;
- `confirmedInitialState` sem progressão linear duplicada;
- plano observável derivado do tracker;
- campos persistidos `nd_*` produzidos pelo tracker.

## Prompt de análise

Antes do ND-008, após a correção de limite ND-007, `ANALYSIS_PROMPT` possuía 3.297 caracteres. Agora possui **2.670 caracteres**, redução aproximada de **627 caracteres** nesta etapa. Em relação ao prompt de 4.670 caracteres que causava ND-007, a redução acumulada é de aproximadamente 2.000 caracteres.

O formato JSON solicitado termina imediatamente após `candidateBeats`. Não há nomes de campos legados no prompt.

## Persistência, importação e exportação

`createStory` contém somente o modelo atual. IndexedDB continua armazenando o objeto normalizado por essa função. Importação e exportação também passam por `createStory`, portanto propriedades antigas fornecidas em JSON são descartadas e não reaparecem na saída.

Não foi implementada migração. Dados locais de teste antigos podem perder os campos removidos, conforme solicitado.

## Payloads

O Director recebe:

- documento e resumo privados;
- personagens privados;
- segredos;
- arcos;
- beats;
- estado inicial confirmado.

O tracker recebe `adaptiveTrackingPlan` derivado com:

- `arcs`;
- `beats` sem `setupStrategies`;
- `secrets` contendo apenas `id/status`;
- nomes dos campos `nd_*` que deve atualizar.

Nenhum dos campos removidos está presente nos payloads.

## Interface

O fluxo normal mostra apenas personagens privados, segredos, arcos adaptativos e candidate beats. Toda a seção visual de compatibilidade linear foi removida, inclusive controles invisíveis e handlers associados.

## README

O README agora descreve a derivação do tracker a partir das estruturas adaptativas, remove referências a projections/stages legados e documenta corretamente o chunking cronológico de chats longos.

## Testes

Foram adicionadas ou atualizadas verificações para garantir:

- ausência de todos os nomes legados no prompt;
- contrato JSON terminando em `candidateBeats`;
- análise válida sem campos redundantes;
- `createStory` descartando propriedades antigas;
- exportação sem propriedades antigas;
- aplicação da análise sem criar cópias redundantes;
- payloads do Director e tracker sem legado;
- tracker derivado de secrets/arcs/beats;
- continuidade das estruturas e fluxos 7.1–7.5.

Comandos executados:

```text
npm test
npm run build
node --check dist/extension.js
git diff --check
```

## Isolamento do núcleo

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi modificado.
