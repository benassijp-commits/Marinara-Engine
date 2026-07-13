# Narrative Director, revisão arquitetural v2

> Historical checkpoint: the server-memory limitation described below was subsequently resolved inside the extension by `NARRATIVE_DIRECTOR_LOREBOOK_TRANSPORT.md`. The current runtime transport is one guarded chat-scoped lorebook; the core remains unchanged.

## Resultado

A extensão foi reconstruída no modelo v2 exclusivamente em `extensions/narrative-director/`.

O lado controlado pela extensão está implementado:

- dois tipos fixos de agente;
- nenhuma criação ou alteração de configuração de agente;
- memória separada por agente e chat;
- representação intermediária com fatos atômicos;
- revisão Public, Private e Uncertain;
- compilação pública local e determinística;
- cartões com campos nativos;
- tracker mínimo;
- reparo de JSON em uma única tentativa;
- inicialização progressiva de chats longos;
- exportação/importação somente do schema v2;
- smoke isolado.

Existe uma lacuna comprovada no pipeline atual do Marinara: agentes customizados genéricos não recebem a memória persistida pelas rotas `/api/agents/memory` em `AgentContext.memory`. A extensão consegue sincronizar, recuperar e separar os documentos no servidor, mas os dois agentes customizados fixos não conseguem consumi-los durante o roleplay sem suporte upstream. Nenhum arquivo do núcleo foi alterado para contornar essa limitação.

## Arquivos alterados

- `extensions/narrative-director/src/core.js`: schema v2, prompts, compilador, memória, tracker, status e chunking.
- `extensions/narrative-director/src/api.js`: rotas públicas, reparo único, memória por chat, status e ativação dos tipos fixos.
- `extensions/narrative-director/src/storage.js`: IndexedDB v2 exclusivo para rascunhos locais.
- `extensions/narrative-director/src/ui.js`: fluxo v2 de importação, revisão, Apply, Initialize, memória e status.
- `extensions/narrative-director/src/extension.css`: layout desktop/mobile da nova interface.
- `extensions/narrative-director/presets/marinara-agents.json`: preset oficial importável dos dois agentes.
- `extensions/narrative-director/scripts/build.mjs`: inclui o preset no distributável.
- `extensions/narrative-director/scripts/smoke.mjs`: smoke isolado com dados fictícios.
- `extensions/narrative-director/tests/*.test.mjs`: testes da arquitetura contemporânea.
- `extensions/narrative-director/README.md`: instalação, contratos, privacidade e limitação comprovada.
- `extensions/narrative-director/package.json`, `manifest.json`: comando de smoke e descrição v2.

## Contratos públicos comprovados

### Agentes e memória

Rotas confirmadas em `packages/server/src/routes/agents.routes.ts`:

- `GET /api/agents`
- `GET /api/agents/memory/:agentType/:chatId`
- `PATCH /api/agents/memory/:agentType/:chatId`, body `{ "patch": { ... } }`
- `DELETE /api/agents/memory/:agentType/:chatId`
- `POST /api/agents/suite/rewrite`

O PATCH de memória procura a configuração pelo tipo. Para um tipo customizado ausente, retorna 404. Por isso a extensão verifica os dois tipos antes da sincronização e não tenta criá-los.

O schema de rewrite confirma:

- `instruction`: 1 a 4.000 caracteres;
- `selectedText`: 1 a 50.000 caracteres.

### Contexto real de agente

`AgentContext`, em `packages/shared/src/types/agent.ts`, contém:

- chat e modo;
- mensagens recentes;
- resposta principal para pós-processamento;
- game state;
- personagens e persona;
- `memory`;
- lorebook ativado;
- resumo do chat;
- injeções pré-geração e resultados paralelos.

Entretanto, o pipeline genérico em `packages/server/src/routes/generate.routes.ts` constrói `memory: {}`. A busca `agentsStore.getMemory()` é feita apenas para o Director nativo/Secret Plot. `renderAgentPromptTemplate()` resolve macros de `settings` e macros comuns, não chaves da memória persistida. Esta é a menor lacuna real restante.

### Custom Tracker

O contrato comprovado usa `custom_tracker_update`. O resultado precisa ser objeto com array `fields`. O pipeline mescla esse array em `playerStats.customTrackerFields` quando o agente customizado possui a capability `edit_trackers`.

Formato adotado:

```json
{
  "fields": [
    { "name": "nd_confirmed_facts", "value": "[]" },
    { "name": "nd_arc_states", "value": "{}" },
    { "name": "nd_readiness_evidence", "value": "{}" },
    { "name": "nd_blockers", "value": "{}" },
    { "name": "nd_eligible_beats", "value": "[]" },
    { "name": "nd_secret_layers", "value": "{}" },
    { "name": "nd_confidence", "value": "{}" }
  ]
}
```

Cada `value` é uma string contendo JSON compacto.

### Cartões

O schema público `createCharacterSchema` recebe `{ data }`. O compilador preenche os campos nativos comprovados:

- `name`;
- `description`;
- `personality`;
- `scenario`;
- `extensions.appearance`;
- defaults exigidos para os demais campos V2.

Criação usa `POST /api/characters`.

### Lorebooks

Rotas usadas:

- `POST /api/lorebooks`;
- `POST /api/lorebooks/:id/entries`;
- `PATCH /api/chats/:id/metadata` para associação.

O compilador não duplica automaticamente o mesmo personagem em cartão separado e lorebook.

### Chats

Rotas usadas:

- `GET /api/chats`;
- `GET /api/chats/:id`;
- `GET /api/chats/:id/messages`;
- `GET /api/chats/:id/game-state`;
- `PATCH /api/chats/:id` para associar cartões;
- `PATCH /api/chats/:id/metadata` para lorebook e ativação.

Ativação preserva todos os demais `activeAgentIds`.

## Arquitetura final

### Tipos fixos

- Director: `narrative-story-director`
- Tracker: `narrative-story-tracker`

Não existe tipo derivado de projeto. Projetos e chats reutilizam os mesmos dois tipos.

### Configuração exata

Director:

- phase `pre_generation`;
- result `director_event`;
- saída textual curta;
- não recebe capability de escrita;
- temperatura sugerida `0.2`;
- nunca deve narrar, dialogar, imprimir status ou controlar `{{user}}`.

Tracker:

- phase `post_processing`;
- result `custom_tracker_update`;
- capability `customCapabilities.edit_trackers = true`;
- temperatura sugerida `0.1`;
- somente JSON com o array `fields` exato;
- nunca Context Injection.

O preset usa o formato oficial `marinara.agent-folder`, versão 1. A extensão não o importa automaticamente e não escolhe conexões.

## Formatos de memória

### Director

Contém:

- `schemaVersion`, `projectId`, `projectType`, `title`;
- `privateDocument`, `completeStorySummary`;
- `privateCharacters`, `secrets`, `knowledgeMatrix`;
- `narrativeArcs`, `candidateBeats`, `setupStrategies`;
- `confirmedInitialState`, `editorialInstructions`;
- `publicResourceIds`;
- `structuredProject` completo para recuperação em outro navegador;
- decisões de disclosure e seleção de recursos públicos.

### Tracker

Contém apenas:

- `schemaVersion`, `projectId`;
- IDs de segredo com camada;
- IDs de arco com status e momentum;
- IDs de fatos observáveis;
- sinais de readiness e bloqueadores observáveis por beat ID;
- IDs de beats elegíveis;
- confiança;
- nomes dos sete campos `nd_*`.

Não contém documento privado, resumo completo, conteúdo/condição de segredo, objetivo privado, setup strategy ou evento futuro privado.

## Importação estruturada

O usuário escolhe `character_focus` ou `world_ensemble`. Essa escolha é anexada à instruction da análise.

A IA retorna representação intermediária com:

- entidades separadas;
- personagem principal e secundários;
- lugares, organizações e regras;
- fatos atômicos;
- visibilidade `public`, `private` ou `uncertain`;
- matriz de conhecimento;
- segredos, arcos e candidate beats.

A UI permite editar fatos, personagens, segredos, arcos e beats. Apply fica bloqueado enquanto houver fato uncertain sem decisão.

Creative enrichment aparece como ação separada e desabilitada por padrão; nenhuma geração criativa foi acoplada à extração.

## Tamanhos dos prompts

- Analysis, Character focus: 2.997 caracteres.
- Analysis, World / ensemble: 2.996 caracteres.
- Initialization: 676 caracteres.
- JSON repair: 227 caracteres.
- Director preset: 527 caracteres.
- Tracker preset: 785 caracteres.

Todos os prompts enviados como `instruction` estão abaixo de 4.000 caracteres e têm teste explícito.

## Limpeza realizada

Foram removidos do código de produção e do schema local:

- chave/tipo por história;
- criação e upsert de agente;
- payloads de configuração de agente;
- IDs de agente salvos no projeto;
- conexão, prompt, context size, max tokens e temperatura dentro do projeto;
- armazenamento em settings de configuração;
- editores de agentes;
- políticas/macros injetadas automaticamente;
- estruturas lineares anteriores.

Nomes removidos aparecem apenas em testes negativos que comprovam a ausência.

## Testes e smoke

Executados com sucesso:

```text
npm test
npm run build
node --check dist/extension.js
node --check scripts/smoke.mjs
npm run smoke
git diff --check
```

Cobertura inclui:

- ausência de POST/PATCH de configuração de agente;
- tipos fixos e status ausente/inativo/ativo;
- memórias independentes por chat;
- recuperação server-side;
- separação Director/Tracker;
- Character focus e World / ensemble;
- campos nativos do cartão e permanência de NPCs;
- fatos mistos e bloqueio de uncertain;
- limites de instruction/source/selectedText;
- uma tentativa de reparo;
- tracker mínimo e sem Context Injection;
- validação de saída editorial do Director;
- chunking, cancelamento e retomada;
- export/import v2;
- ausência do legado;
- responsividade estática e proteção contra overflow.

O smoke fictício percorre criação, análise, persistência/reabertura, preview, preparação de Initialize, construção das duas memórias e export/import.

## Limitações comprovadas e validação manual restante

1. Bloqueio upstream: memória persistente não chega a custom agents genéricos durante geração. A configuração atual não atende o consumo runtime da memória sem suporte do núcleo.
2. A extensão pode validar formato e detectar cópias literais privadas, mas revisão humana continua necessária para vazamentos semânticos parafraseados.
3. Não foi executado smoke visual num navegador Marinara real. Validar manualmente desktop e mobile, importação do preset, criação de recursos, status e ativação.
4. Validar com um modelo fraco se o Tracker respeita o JSON mínimo; a extensão não intercepta o pós-processamento para reparar saída.
5. Validar manualmente a regeneração: o Marinara reutiliza injeções pré-geração armazenadas conforme seu pipeline atual.

## Isolamento do núcleo

`git diff --name-only -- packages/client packages/server packages/shared` não retornou arquivos. Nenhum arquivo do núcleo foi alterado.

Não foi feito commit, push, merge ou alteração em `staging`.
