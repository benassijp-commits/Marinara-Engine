# Narrative Director — correções ND-009, ND-010 e ND-011

## Status

**ND-009, ND-010 e ND-011 implementados e aguardando validação.** Nenhuma funcionalidade externa ao escopo foi adicionada. Não houve migração, compatibilidade legada ou alteração do núcleo.

## Auditoria dos prompts

Todos os textos enviados a modelos foram auditados:

| Prompt ou política | Tamanho final |
|---|---:|
| `ANALYSIS_PROMPT` | 3.436 caracteres |
| `INITIALIZATION_PROMPT` | 1.327 caracteres |
| `DEFAULT_DIRECTOR_PROMPT` | 1.443 caracteres |
| `DEFAULT_TRACKER_PROMPT` | 1.456 caracteres |
| política adaptativa anexada ao Director | 519 caracteres |
| política observável anexada ao tracker | 1.048 caracteres |

Os prompts permanecem universais. Não contêm nomes, eventos ou frases literais das fixtures, exemplos de gênero ou relação específicos, sequência obrigatória nem expectativa de ação de `{{user}}`.

Um teste percorre os quatro prompts e as duas políticas com uma lista explícita de literais exclusivos das fixtures.

## ND-009 — visibilidade do tracker

A aba Tracker agora apresenta uma projeção somente leitura da arquitetura contemporânea.

### Plano derivado

Exibe:

- segredos com `id` e status;
- arcos com ID, status, momentum e estado observado;
- candidate beats com status, elegibilidade, readiness signals e blockers;
- todos os nomes de campos `nd_*` produzidos pelo tracker.

A projeção é construída em memória por `buildTrackerProjection()` a partir de `secrets`, `narrativeArcs` e `candidateBeats`. Não existe persistência adicional.

### Estado runtime

Ao abrir a aba ou selecionar Refresh, a extensão consulta o game state do chat selecionado e mostra os sete campos:

- `nd_confirmed_facts`;
- `nd_arc_states`;
- `nd_readiness_evidence`;
- `nd_blockers`;
- `nd_eligible_beats`;
- `nd_secret_layers`;
- `nd_confidence`.

JSON válido é exibido com indentação. Valores textuais ou JSON inválido permanecem visíveis literalmente, sem serem descartados.

### Status do agente

O status é derivado da lista pública de agentes e de `chat.metadata.activeAgentIds`:

- Agent not created;
- Agent created · inactive;
- Agent active.

Nenhum `trackerStages`, `trackedSecrets`, `progressionProjection` ou modelo paralelo foi criado.

## ND-010 — classificação pública e privada

`ANALYSIS_PROMPT` agora ordena classificação fato a fato em vez de classificação por parágrafo.

Quando um trecho mistura informações públicas e privadas, o modelo deve extrair somente fatos públicos independentes, sem copiar, resumir ou parafrasear a parte privada.

O contrato diferencia:

- aparência visível;
- personalidade demonstrada;
- hábitos observáveis;
- ocupação ou função pública;
- relações aparentes conhecidas;
- situação inicial conhecida;
- fatos cotidianos sem causa oculta;

de identidades/relações escondidas, causas desconhecidas, objetivos secretos, planos futuros, habilidades desconhecidas, conhecimento restrito e condições futuras.

`characterInformation` e `cardAdditions` recebem fatos públicos úteis do personagem. `lorebookEntries` recebe somente conhecimento público reutilizável de mundo, locais, organizações, regras ou contexto, sem duplicar automaticamente personalidade. Saídas públicas e lorebook vazio continuam válidos.

A fixture mista existe apenas nos testes. O resultado validado contém o traço observável nos campos públicos, mantém o fato oculto no documento/segredo privado e deixa o lorebook vazio.

## ND-011 — estado progressivo e orçamento dinâmico

O planejamento estático de todos os blocos foi removido do fluxo. A extensão agora monta somente o próximo bloco, depois de conhecer o `previousPartialState` real.

### Orçamento por rodada

Antes de cada chamada, `buildNextInitializationBlock()` mede:

- instrução;
- documento privado;
- estado confirmado anterior;
- estado parcial consolidado;
- próximo conjunto cronológico de mensagens/partes;
- margem de segurança de 1.000 caracteres.

O orçamento total conservador é 49.000 caracteres. O `selectedText` continua sujeito à barreira pública independente de 50.000.

### Cursor e integralidade

O checkpoint contém:

- posição da mensagem ativa;
- offset exato dentro da mensagem;
- número da parte;
- quantidade de blocos concluídos;
- estado parcial consolidado;
- registro sanitizado das divisões.

O cursor só avança após uma resposta válida. Uma falha deixa o cursor anterior intacto, portanto a retomada reenvia exatamente a parte que falhou e não repete blocos concluídos.

Mensagens grandes são subdivididas dinamicamente. Ordem, autoria, `sourceIndex`, swipe ativo e conteúdo integral são preservados. Nenhum texto é truncado silenciosamente.

### Consolidação limitada

O estado parcial passa novamente pelo schema estrito antes da próxima rodada:

- não aceita mensagens brutas ou respostas anteriores completas;
- deduplica arrays de fatos/eventos;
- atualiza blocked secrets por ID;
- atualiza personagens pela identidade textual normalizada;
- mantém apenas o estado final estruturado necessário.

Se instrução, plano privado, estado confirmado e estado consolidado já consumirem o orçamento sem mensagens novas, a extensão interrompe com erro específico indicando o maior componente responsável. Nenhuma proposta parcial é persistida.

## Testes adicionados

- aba Tracker contém plano derivado, runtime e status do agente;
- projeção contém secrets/arcs/beats e todos os campos `nd_*`;
- JSON runtime é formatado e texto inválido é preservado;
- nenhum editor ou campo legado retorna;
- prompts de produção não contêm literais das fixtures;
- trecho misto mantém somente fatos públicos seguros;
- conteúdo privado não entra em cartão ou lorebook;
- lorebook vazio permanece válido;
- estado parcial grande reduz o próximo bloco;
- consolidação deduplica fatos e entidades;
- erro identifica componente fixo sem espaço;
- oito ou mais blocos ficam abaixo do limite;
- nenhuma mensagem ou parte é omitida;
- retomada repete somente a parte que falhou;
- cancelamento continua sem persistir estado parcial;
- regressões 7.1–7.6 permanecem aprovadas.

## Validação executada

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

## Arquivos alterados

- `extensions/narrative-director/src/core.js`;
- `extensions/narrative-director/src/api.js`;
- `extensions/narrative-director/src/ui.js`;
- `extensions/narrative-director/src/extension.css`;
- `extensions/narrative-director/tests/core.test.mjs`;
- `extensions/narrative-director/tests/api.test.mjs`;
- `NARRATIVE_DIRECTOR_STEP_7_7.md`.

## Isolamento

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi modificado. Não foi feito commit, push, merge ou alteração em `staging`.
