# Narrative Director — Etapa 7.4

## Status

**Etapa 7.4 implementada, aguardando validação.** O trabalho foi limitado a ND-006 e à regra conservadora de `abandoned`.

## Resultado

A inicialização de chats existentes agora mantém o fluxo simples de uma chamada para entradas abaixo de 50.000 caracteres e usa análise progressiva em blocos cronológicos quando o envelope excede o limite público de `/api/agents/suite/rewrite`.

Nenhuma mensagem ativa é truncada ou descartada. A divisão prioriza fronteiras entre mensagens; uma mensagem individual grande demais é dividida em partes identificadas por número da mensagem, parte atual e total de partes.

Estados intermediários, checkpoints e respostas de blocos permanecem somente em memória. IndexedDB, exportações e logs não recebem conteúdo parcial.

## Arquivos alterados nesta etapa

- `extensions/narrative-director/src/core.js`
  - orçamento seguro de 49.000 caracteres para a rota pública;
  - divisão cronológica e reconstruível de mensagens;
  - envelope progressivo com `previousPartialState`;
  - validação estrita de abandono;
  - instruções conservadoras nos prompts de análise, tracker e Director.
- `extensions/narrative-director/src/api.js`
  - fluxo normal para chats abaixo do limite;
  - processamento sequencial de blocos longos;
  - checkpoint em memória e repetição do bloco que falhou;
  - cancelamento sem retornar proposta parcial.
- `extensions/narrative-director/src/ui.js`
  - progresso `Analyzing block X of Y`;
  - intervalo de mensagens e divisões explícitas;
  - botão de cancelamento;
  - contagem total de mensagens e blocos na proposta;
  - editor de evidência de impossibilidade, fato confirmado e confiança.
- `extensions/narrative-director/src/extension.css`
  - estados responsivos de progresso, cancelamento e evidência de abandono.
- `extensions/narrative-director/tests/core.test.mjs`
  - cobertura de chunking, ordem, integralidade, passagem de estado e abandono.
- `extensions/narrative-director/tests/api.test.mjs`
  - cobertura do fluxo curto/longo, cancelamento e retomada após falha.
- `NARRATIVE_DIRECTOR_STEP_7_4.md`
  - este relatório.

Alterações anteriores já presentes no worktree foram preservadas.

## ND-006: funcionamento

1. A extensão lê a lista pública de mensagens do chat, que já representa o conteúdo ativo, sem implementar gerenciamento próprio de swipes.
2. Tenta primeiro o envelope normal. Se ele couber, realiza uma única chamada, preservando o comportamento anterior.
3. Se exceder o limite, monta blocos em ordem cronológica abaixo de 49.000 caracteres.
4. Cada resposta validada torna-se `previousPartialState` do bloco seguinte.
5. O painel mostra bloco atual, total de blocos e intervalo de mensagens.
6. Apenas o resultado do último bloco é apresentado como proposta consolidada.
7. A confirmação continua sendo a única ação que persiste o estado e atualiza os agentes.

Se uma mensagem for dividida, cada parte preserva `sourceIndex`, `part` e `partCount`. Os testes reconstroem cada mensagem original concatenando suas partes e verificam igualdade integral.

### Falha e repetição

Uma falha informa `block X of Y`. O checkpoint contém somente o último estado parcial validado e o índice do próximo bloco, exclusivamente em memória. Uma nova tentativa na mesma sessão reexecuta o bloco que falhou, sem repetir os anteriores.

O diagnóstico persistido usa apenas etapa, números do bloco, chat e contagem. Não contém mensagens, plano privado ou resposta intermediária.

### Cancelamento

O cancelamento é observado antes do próximo bloco e imediatamente depois de uma chamada em andamento. Nenhuma proposta parcial é retornada ou persistida; o estado confirmado anterior permanece visível e intacto.

## Regra conservadora de `abandoned`

Um arco com status `abandoned` passa na validação somente quando contém:

- `impossibilityEvidence` não vazio;
- `impossibilityFact` não vazio;
- `confidence` igual a `high`.

Prompts customizados existentes recebem a política obrigatória de que recusa momentânea, demora, baixa readiness, ausência temporária, beat ignorado e divergência recuperável não justificam abandono. Nesses casos, o arco deve permanecer ativo com momentum baixo ou ser pausado. O Director não pode abandonar por preferência narrativa.

O editor mantém esses campos recolhidos junto de cada arco e explica quando são necessários.

## Testes executados

Em `extensions/narrative-director`:

```text
npm test
  aprovado: api, core e storage

npm run build
  Built 4 modules into dist/extension.js

node --check dist/extension.js
  aprovado, sem saída

git diff --check
  aprovado, sem saída
```

Cobertura adicionada:

- chat curto continua no fluxo normal;
- chat longo é dividido cronologicamente;
- mensagens e partes são reconstruídas sem omissão;
- estado parcial entra no bloco seguinte;
- cancelamento não produz proposta parcial;
- falha retoma no bloco corrente;
- proposta final é retornada uma única vez;
- arco pausado pode voltar a ativo;
- abandono sem evidência é rejeitado;
- impossibilidade definitiva com confiança alta é aceita;
- prompts rejeitam abandono por recusa ou atraso.

## Validação manual recomendada

1. Inicializar um chat curto e confirmar que aparece `1 block`.
2. Inicializar um chat com mais de 50.000 caracteres e observar progresso e intervalos.
3. Cancelar durante um bloco e confirmar que o estado anterior permanece.
4. Simular falha do provedor num bloco intermediário e tentar novamente na mesma sessão.
5. Editar um arco para `abandoned` sem evidência e confirmar que o salvamento é bloqueado.
6. Preencher evidência definitiva, fato e confiança alta e confirmar que a validação passa.

## Limitações

- Uma requisição de provedor já iniciada não é abortada no transporte porque a API pública utilizada não expõe `AbortSignal`; o resultado é descartado assim que a chamada retorna.
- Se o documento privado sozinho ocupar o orçamento da rota, a extensão mostra erro explícito. Não há truncamento silencioso.
- Se o estado parcial produzido pelo modelo crescer a ponto de tornar o próximo envelope maior que 50.000 caracteres, o bloco falha explicitamente e nada é persistido.

## Isolamento do núcleo

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi modificado. Não foram adicionados hooks, patches ou rotas.
