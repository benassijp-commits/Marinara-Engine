# Narrative Director — Etapa 7.3

## Status

**Etapa 7.3 implementada, aguardando validação.** Nenhuma funcionalidade posterior da Etapa 7 foi iniciada.

## Resultado

A extensão agora representa planejamento narrativo como arcos adaptativos e beats candidatos, preserva cinco camadas graduais de revelação e usa o estado confirmado do tracker na rodada seguinte do Director. O fluxo continua utilizando exclusivamente agentes customizados e o pipeline público existente do Marinara, sem chamada adicional de IA e sem alteração do núcleo.

O Director recebe o plano privado completo e pode manter a cena, preparar um beat, oferecer uma pista, criar uma cena-ponte, mover NPCs, modular tensão, adiar, adaptar ou abandonar uma possibilidade. Sua política obrigatória proíbe controlar ou presumir ações, fala, pensamentos, sentimentos, desejos, decisões, consentimento ou personalidade de `{{user}}`. Recusa, atraso, inação e divergência devem ser aceitos sem punição nem convergência forçada.

O tracker registra apenas observações: fatos confirmados, estado de arcos, evidências de prontidão, bloqueadores, IDs de beats elegíveis, camadas de revelação e confiança. Estratégias privadas, objetivos, resumos de segredos e condições privadas não fazem parte do payload do tracker.

## Arquivos alterados nesta etapa

- `extensions/narrative-director/src/core.js`
  - estruturas `narrativeArcs` e `candidateBeats`;
  - cinco estados de revelação;
  - validação de IDs duplicados e referências entre personagens, segredos, arcos, beats e tracker;
  - políticas obrigatórias de agência e observação;
  - payloads privados do Director e sanitizados do tracker;
  - leitura normalizada dos campos adaptativos persistidos no estado do chat.
- `extensions/narrative-director/src/ui.js`
  - editores recolhíveis de arcos e beats;
  - edição de pré-requisitos, sinais, bloqueadores, estratégias e relações;
  - seleção das cinco camadas de revelação;
  - estrutura linear anterior mantida apenas em seção avançada de compatibilidade.
- `extensions/narrative-director/tests/core.test.mjs`
  - testes de estruturas, referências, privacidade, agência, elegibilidade e ponte de estado.
- `extensions/narrative-director/tests/api.test.mjs`
  - fixture de análise atualizada para o contrato adaptativo.
- `NARRATIVE_DIRECTOR_STEP_7_3.md`
  - este relatório.

Há outras alterações de etapas anteriores já presentes no worktree; elas foram preservadas.

## Estruturas implementadas

### Arcos

Cada item contém `id`, `title`, `status` (`inactive`, `active`, `paused`, `completed` ou `abandoned`), `observedState` e `momentum` (`low`, `medium` ou `high`).

### Beats candidatos

Cada item contém `id`, `title`, `relatedArcIds`, `status` (`unavailable`, `eligible`, `active`, `deferred`, `completed` ou `skipped`), `hardPrerequisites`, `readinessSignals`, `blockers`, `setupStrategies` e `relatedSecretIds`.

`eligible` significa somente que o beat pode ser considerado. Não autoriza sua execução e não permite fabricar ação ou intenção do jogador.

### Revelação gradual

Segredos privados e segredos rastreados aceitam `locked`, `foreshadowed`, `suspected`, `partially_revealed` e `confirmed`.

## Ponte tracker → Director (ND-004)

A prova usa o pipeline real já existente:

1. O tracker customizado roda em `post_processing` e retorna `custom_tracker_update`.
2. O Marinara reconhece esse result type como capacidade `edit_trackers` em `packages/shared/src/types/agent.ts:492` e valida agentes customizados em `packages/server/src/routes/generate/agent-result-capabilities.ts:41`.
3. O resultado é persistido nos campos customizados do snapshot do chat por `packages/server/src/routes/generate.routes.ts:6694`.
4. Na geração seguinte, o snapshot comprometido é atribuído a `AgentContext.gameState` em `packages/server/src/routes/generate.routes.ts:2560`.
5. O executor inclui esse estado em `<current_game_state>` para o agente pré-geração em `packages/server/src/services/agents/agent-executor.ts:2090`.
6. A política do Director determina que esse estado comprometido prevalece sobre a inicialização quando houver diferença.

Os campos persistidos são:

- `nd_confirmed_facts`;
- `nd_arc_states`;
- `nd_readiness_evidence`;
- `nd_blockers`;
- `nd_eligible_beats`;
- `nd_secret_layers`;
- `nd_confidence`.

Campos estruturados usam strings JSON porque essa é a forma pública aceita por `custom_tracker_update`. Não foi usada a injeção nativa de Custom Tracker no narrador principal; a ponte ocorre diretamente pelo `AgentContext.gameState` que o pipeline fornece ao Director. Assim, o estado observado chega ao Director sem duplicar o pipeline e sem enviar o plano privado ao narrador.

## Privacidade e validação

- O Director recebe personagens privados, segredos, condições, arcos, beats e estratégias.
- O tracker recebe IDs, estados e critérios observáveis, mas não `setupStrategies`, objetivos privados, resumos de segredos, condições privadas ou documento completo.
- IDs duplicados, owner/known-by desconhecidos, relações com arcos ou segredos inexistentes e segredos rastreados sem segredo privado correspondente bloqueiam a validação com mensagem explícita.
- Prompts personalizados antigos recebem automaticamente as políticas obrigatórias e os macros adaptativos quando os agentes são atualizados.
- O tracker deve preservar o valor anterior quando não houver evidência suficiente.

## Testes executados

Em `extensions/narrative-director`:

```text
npm test
  3 arquivos de teste aprovados

npm run build
  Built 4 modules into dist/extension.js

node --check dist/extension.js
  aprovado, sem saída

git diff --check
  aprovado, sem saída
```

Os testes cobrem arcos, beats, relações, IDs duplicados, cinco estados de revelação, separação do tracker, preservação por evidência insuficiente, elegibilidade não obrigatória, agência de `{{user}}` e leitura do estado persistido para a rodada seguinte.

## Validação manual recomendada

1. Reanalisar uma história fictícia e revisar arcos, beats e camadas de revelação.
2. Ativar os agentes em um chat de teste.
3. Produzir uma resposta que confirme um sinal observável e verificar os campos `nd_*` no estado do tracker.
4. Gerar a rodada seguinte e, com diagnóstico de agentes habilitado no Marinara, confirmar que o Director recebe o novo `<current_game_state>`.
5. Recusar ou ignorar uma oportunidade e confirmar que a instrução filtrada adapta NPCs/ambiente sem narrar ação, intenção ou emoção de `{{user}}`.
6. Remover uma referência de arco/segredo e confirmar que o salvamento é bloqueado com erro legível.

## Limitações

- O teste automatizado prova o contrato do payload e a leitura dos campos; a confirmação ponta a ponta com um provedor real e inspeção do prompt deve ser feita manualmente no Marinara.
- A estrutura linear anterior permanece apenas para compatibilidade interna com dados das etapas anteriores e não é a fonte principal do planejamento adaptativo.
- Não foi implementada migração complexa de dados de teste antigos, conforme o escopo vigente.

## Isolamento do núcleo

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi modificado. Esses arquivos foram somente lidos para comprovar o comportamento público do pipeline existente.
