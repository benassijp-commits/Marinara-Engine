# Plano técnico — extensão Narrative Director

## Resumo executivo

O Marinara Engine possui dois runtimes de extensão, ambos instalados pela interface **Settings → Addons → Extension Library**:

- extensões de navegador (`marinara.extension`), com CSS/JavaScript executado no cliente;
- extensões de servidor (`marinara.server-extension`), com JavaScript executado em um `node:vm` restrito.

O sistema atual de extensões não oferece hooks formais de geração, acesso aos stores do cliente, registro de rotas no Fastify, acesso ao banco ou acesso ao pipeline interno de agentes. Portanto, uma extensão de navegador consegue construir a interface e usar as APIs HTTP existentes para personagens, chats, mensagens, lorebooks, agentes e conexões, mas não consegue interceptar de modo confiável e atômico toda geração. A extensão de servidor atual também não resolve essa lacuna: seu helper contém somente log, `fetch` externo seguro, timers e cleanup.

O núcleo, por outro lado, já contém quase todas as primitivas necessárias: agentes com fases `pre_generation`, `parallel` e `post_processing`; um Narrative Director embutido; memória de agente por chat; contexto com personagem, persona, mensagens recentes, resumo, lorebook e game state; injeções pré-geração; trackers pós-geração; resolução de conexões/modelos; runs persistidos; e snapshots de game state por mensagem/swipe.

Há uma incompatibilidade de segurança importante entre o recurso embutido e o objetivo deste projeto: o Secret Plot do Director é carregado da memória privada, usado pelo agente, **mas o arco completo também é posteriormente formatado e anexado ao prompt principal do narrador** por `formatSecretPlotSystemBlock`/`appendSecretPlotSystemMessage` em `generate.routes.ts`. Esse caminho não pode ser reutilizado sem alteração, pois viola a regra de que somente instruções filtradas da cena chegam ao narrador.

Conclusão revisada após investigar o executor de agentes: **a opção A é tecnicamente possível para um MVP automático**, sem duplicar o pipeline e sem hooks novos, se o documento privado for armazenado em `settings` de agentes customizados e inserido apenas no template desses agentes por macros de settings. Um agente customizado `pre_generation` com `resultType: "director_event"` pode retornar somente a instrução filtrada; um agente customizado `post_processing` com `resultType: "custom_tracker_update"` pode atualizar o game state por chat. Cartão, lorebook, agentes, memória e game state já possuem APIs acessíveis à extensão.

Essa opção ainda não oferece a fronteira de isolamento mais forte: agentes que compartilham provider/model podem ser agrupados em uma mesma chamada, settings de agentes são legíveis pelas APIs/UI administrativas, e memória arbitrária persistida por chat não é carregada genericamente no contexto de agentes customizados. Portanto, a recomendação passa a ser: validar primeiro a opção A com restrições explícitas; se o requisito “privado nunca alcança nenhum outro agente do lote” for absoluto, escolher a opção B com uma alteração pequena para execução individual/contexto privado. Hooks genéricos da opção C não são tecnicamente indispensáveis para este projeto.

## Investigação focada: reutilização do sistema de agentes

### 1. Contexto privado para agente customizado

Sim, por um caminho existente que não é a memória: `renderAgentPromptTemplate()` em `packages/server/src/services/agents/agent-executor.ts` executa primeiro `renderAgentSettingsMacros()`. Qualquer caminho presente em `agent.settings` pode ser usado no template, por exemplo `{{narrative.privateDocument}}`. Objetos são serializados como JSON. Esse texto entra no prompt do agente, não no prompt principal do narrador.

Exemplo conceitual de configuração, sem implementar:

```json
{
  "type": "narrative-director-story-<id>",
  "phase": "pre_generation",
  "resultType": "director_event",
  "promptTemplate": "Documento privado:\n<private_story>{{narrative.privateDocument}}</private_story>\nRetorne somente uma instrução filtrada para a cena.",
  "settings": {
    "narrative": { "privateDocument": { "secrets": [], "events": [], "progressions": [] } },
    "contextSize": 20
  }
}
```

Limites da privacidade:

- o narrador recebe apenas o resultado pré-geração, não o template/settings;
- a configuração completa pode ser lida por `GET /api/agents` e pela UI administrativa; é “privada do modelo narrador”, não secreta para o administrador/browser;
- o debug de agentes pode registrar/mostrar prompts completos;
- agentes com o mesmo provider/model podem ser batched por `agent-pipeline.ts`; o mesmo request contém as tarefas do lote. Isso não envia o documento ao narrador principal, mas o modelo do lote e outras saídas do lote podem sofrer contaminação;
- `shouldRunAgentIndividually()` não possui hoje uma flag genérica `privateContext`/`runIndividually`.

### 2. Campos disponíveis ao template e contexto do agente

Macros de settings: qualquer chave alfanumérica, `_`, `-` ou caminho com pontos em `settings`, via `{{chave}}`/`{{objeto.chave}}`.

Macros de contexto construídas por `buildAgentPromptMacroContext()` e `resolveMacros()`:

- `{{user}}`, `{{persona}}` e campos separados da persona;
- `{{char}}`, `{{characters}}`;
- `{{description}}`, `{{personality}}`, `{{backstory}}`, `{{appearance}}`, `{{scenario}}`, `{{example}}`;
- `{{charSysInfo}}`, `{{charPostHistory}}`;
- `{{input}}`, `{{chatId}}`;
- data, hora, timezone, random/dice, condicionais e transformações de texto.

No `AgentContext` real também existem:

- `chatId`, `chatMode`, `wrapFormat`;
- `recentMessages`, limitadas por `settings.contextSize` entre 1 e 200, com conteúdo cortado a 2.000 caracteres por mensagem;
- `mainResponse` para pós-processamento;
- `gameState` atual e snapshots comprometidos das três últimas respostas elegíveis inseridos no histórico do agente;
- cards dos personagens com nome, descrição, personalidade, cenário, creator notes, system prompt, backstory, aparência, exemplos, first message e post-history instructions;
- persona e stats;
- `activatedLorebookEntries`, `writableLorebookIds`, `chatSummary`;
- `preGenInjections` e `parallelResults` somente se o agente pós tiver `includePreGenInjections`/`includeParallelResults`;
- `memory`, embora memória persistida genérica não seja carregada automaticamente;
- `signal`, streaming e canal de debug.

`buildLoreBlock()` inclui cards/persona/lore relevante no system prompt do agente. `buildAgentMessages()` inclui histórico multi-turn, tracker comprometido e, no pós-processamento, `<assistant_response>`.

### 3–5. Memória arbitrária, escopo e API

`agentMemory` aceita valores JSON arbitrários por chave, associados a `agentConfigId + chatId`. As rotas existentes são:

- `GET /api/agents/memory/:agentType/:chatId`;
- `PATCH /api/agents/memory/:agentType/:chatId` com `{ patch: {...} }`;
- `DELETE /api/agents/memory/:agentType/:chatId`.

Uma extensão de navegador pode chamá-las por `marinara.apiFetch`. Para tipos `director` e `secret-plot-driver`, o patch passa por `normalizeSecretPlotMemoryPatch`; para tipos customizados é arbitrário.

Entretanto, no pipeline principal `agentContext` começa com `memory: {}`. A única leitura persistente explícita em `generate.routes.ts` é a memória do Director/Secret Plot; outros conteúdos de `memory` são preenchidos internamente para features específicas. Portanto:

- memória customizada **pode armazenar** documento e estado;
- a extensão **pode ler e atualizar** essa memória;
- o agente customizado **não a recebe automaticamente** hoje;
- a memória é por chat, não por personagem;
- não existe compartilhamento automático entre chats.

Para compartilhar uma história entre chats sem núcleo, guardar o documento em `agent.settings` é melhor: a configuração do agente é global e o mesmo agent ID pode ser ativado em vários chats. A extensão mantém `storyId ↔ characterId ↔ directorAgentId ↔ trackerAgentId` no seu próprio IndexedDB/export. Estado por chat fica no game state/Custom Tracker ou em chat variables.

### 6. Saída filtrada pré-geração

Sim. `runPreGenerationAgents()` aceita qualquer resultado `director_event` ou `context_injection` e cria um `AgentInjection` somente com o texto retornado.

- Um tipo customizado com `settings.resultType = "director_event"` é tratado como saída textual, não JSON, porque `director_event` pertence a `TEXT_RESULT_TYPES` e o tipo não está em `JSON_AGENTS`.
- O texto passa por `sanitizeTextAgentResponse()`, que remove blocos vazados de tracker e assistant response.
- A injeção é colocada no prompt principal. Tipos customizados usam o caminho genérico de injeção de sistema em depth 0; apenas os IDs `director`, `knowledge-retrieval` e `knowledge-router` usam o placement separado especial.
- Em regenerações, o pipeline normalmente reutiliza `contextInjections` em cache em vez de executar novamente todos os agentes pré-geração. Isso preserva o comportamento manual e precisa ser aceito ou documentado: a direção original tende a ser reutilizada no swipe.

Para defesa em profundidade, o template deve ordenar resposta curta sem segredos e a extensão deve limitar tamanho. A sanitização atual não detecta vazamento semântico de segredos; nenhum modelo oferece garantia matemática de filtragem.

### 7–8. Tracker pós-processamento e estado editável

Sim. Um agente customizado pode usar:

- `phase: "post_processing"`;
- `settings.resultType: "custom_tracker_update"`;
- capability `edit_trackers` (inferida automaticamente pelo result type, além de poder ser explícita);
- saída `{ "fields": [{ "name": "...", "value": "..." }] }`.

`generate.routes.ts` mescla esses campos em `playerStats.customTrackerFields` no snapshot de game state associado ao `messageId + swipeIndex`. O agente recebe a resposta final em `<assistant_response>`, histórico e estado comprometido. Isso reutiliza integralmente o pipeline e a persistência existentes.

A extensão pode ler e editar o estado por:

- `GET /api/chats/:id/game-state`;
- `PATCH /api/chats/:id/game-state`;
- UI/tracker existente do Marinara.

Limitações: Custom Tracker armazena pares nome/valor em strings e aparece na UI de tracker. Um estado narrativo complexo teria de ser dividido em campos estáveis ou serializado em JSON numa string, o que é menos ergonômico. O tracker também precisa conhecer o documento privado; sem memória genérica, a opção A duplica o documento em `trackerAgent.settings` ou fornece ao tracker apenas progressões/IDs necessários.

Alternativa: habilitar `read_chat_variable` e `write_chat_variable`. As tools operam em `chat.metadata.agentVariables`, são por chat e editáveis via metadata, mas o agente precisa chamá-las; não são macros automaticamente preenchidas no template.

### 9. Tools, MCP e APIs agentivas

O Marinara tem function calling interno, não uma camada MCP de extensão para este caso. Tools embutidas incluem:

- `save_lorebook_entry`, `search_lorebook`;
- `update_game_state`;
- `read_chat_variable`, `write_chat_variable`;
- resumo, dice, eventos, expressão e outras tools de mídia.

Agentes recebem tools listadas em `settings.enabledTools`. `tool-resolution-runtime.ts` cria um `toolContext`, aplica allowlist/capabilities e executa via `tool-executor.ts`. `save_lorebook_entry` aceita lorebook alvo configurado e respeita aprovação de escrita. Não há tool embutida para criar/editar cartão de personagem nem para criar a entidade “história privada”. Há resultados estruturados `lorebook_update` e `character_card_update`, mas a aplicação automática de card é lógica especializada e não substitui o CRUD explícito e revisável da extensão.

Custom tools podem ser webhook, static ou script e receber hidden context server-side, mas não ganham acesso arbitrário a storage interno; scripts usam o executor controlado. Usá-las para hospedar segredos externamente ampliaria superfície e não é necessário.

As referências a MCP em `claude-subscription.provider.ts` são defensivas: o provider força `ENABLE_CLAUDEAI_MCP_SERVERS=false` e detecta connectors MCP que a conta possa expor indevidamente. Não constituem API MCP do Marinara. “App tools” dos conectores do ambiente Codex também não fazem parte do runtime do produto.

Para a extração inicial da história, A pode reutilizar `POST /api/agents/suite/rewrite`: a rota recebe `connectionId`, `selectedText`, instrução e contexto, chama a conexão configurada e devolve `{ rewrittenText }`. A extensão pode pedir JSON no schema das três partes e validá-lo localmente. A rota não oferece JSON Schema/structured output nem retry tipado; resposta inválida deve voltar à revisão/retry manual. Isso evita criar uma segunda integração de provider, embora a semântica oficial da rota seja reescrita assistida de um fragmento.

### 10. Secret Plot nativo

Não existe configuração para “manter o arco privado, mas não anexá-lo ao narrador”. As opções atuais são habilitar ou desabilitar `narrativeDirectorSecretPlotEnabled`. Quando habilitado, o runtime mantém memória e depois chama `formatSecretPlotSystemBlock()`/`appendSecretPlotSystemMessage()` para anexar o arco ao prompt principal. Quando desabilitado, não há manutenção do arco.

Portanto, a opção A não deve usar Secret Plot nativo. Deve criar um tipo customizado com `director_event`, cujo documento privado vive em settings e cuja única saída é a direção.

### 11. Novo tipo de agente

A API `POST /api/agents` aceita uma string `type` arbitrária. O storage torna o tipo customizado único, e o pipeline genérico respeita `phase`, `connectionId`, prompt, settings, tools e `resultType`. Assim, a extensão pode criar um novo **ID/tipo customizado configurado por dados**, sem código core.

Isso não cria um built-in com manifest, prompt padrão, UI dedicada, mode allowlist, cadence especial, parsing/aplicação nova ou acesso privilegiado a memória. Um novo tipo com comportamento especial exige código em manifests/shared e, conforme a função, executor/generate route.

### 12. Menor lacuna real

Para um MVP: nenhuma lacuna bloqueante se forem aceitos settings como storage privado compartilhado, Custom Tracker visível e o risco de batching. A opção A funciona.

Para uma garantia forte de isolamento e melhor modelagem, a menor lacuna não são hooks genéricos. É uma destas alterações pequenas da opção B:

1. `settings.runIndividually`/`settings.privateContext` fazer `shouldRunAgentIndividually()` separar o agente do batch; e
2. opcionalmente carregar a memória persistida por agente/chat no contexto daquele agente e expor uma macro/bloco `privateMemory`, evitando duplicar documento em settings e permitindo estado JSON privado.

O item 1 é a correção mínima de segurança. O item 2 melhora storage e compartilhamento, mas memória continua por chat; para documento por personagem, settings globais do agente ou uma referência gerenciada pela extensão continuam mais naturais.

## Comparação A/B/C

| Opção | O que funciona | O que não funciona / limite | Vazamento | Atualizações | Arquivos core | Esforço |
|---|---|---|---|---|---|---|
| **A. Extensão + agentes customizados** | UI; CRUD de card/lorebook; um Director por história via settings; ativação em vários chats; `director_event`; Custom Tracker pós; estado por chat; conexões e tools existentes | memória arbitrária não chega ao agente; documento duplicado no tracker; tracker string/visível; batching; sem slot UI/contexto atual oficial | Médio: não vai ao narrador diretamente, mas pode contaminar batch, debug e é legível por APIs de agents | Melhor: zero patch core; depende apenas de contratos HTTP/agent existentes e DOM para UI | Nenhum core; apenas pacote da extensão | **Baixo–médio** |
| **B. Extensão + nova configuração/comportamento de agente no pipeline atual** | Tudo de A, mais execução isolada; opcional memória privada por chat carregada; parsing/estado dedicado sem hooks paralelos | ainda requer manter pequeno patch upstream; um built-in completo aumenta registry/UI/testes | Baixo se `privateContext` isola batch e debug é redigido; somente direção entra no narrador | Bom se a mudança for genérica e upstream; manutenção concentrada no pipeline de agentes | Mínimo: `agent-executor.ts`, `agent-pipeline.ts`, schema/tipos/settings UI e testes. Se built-in: manifest/registry, prompts e trechos de `generate.routes.ts` | **Médio** |
| **C. Extensão + hooks genéricos** | Storage/hook/model API totalmente flexíveis; isolamento explícito; UI e servidor desacoplados | duplica uma superfície de orchestration que agentes já cobrem; novo contrato público amplo, segurança/timeouts/versionamento | Baixo em tese, mas maior superfície de implementação e auditoria | Pior: API nova precisa compatibilidade duradoura e extensão híbrida | runtime de extensões, geração, storage, models, schemas, docs, testes e possivelmente rotas | **Alto** |

### Recomendação entre as opções

1. **Começar por A**, com um agente Director e um Custom Tracker por história, conexão dedicada (ou ao menos diferente dos demais agentes) para reduzir batching, debug desligado para segredos e testes de prompt/peek/replay.
2. Se conexão dedicada não garantir grupo separado de forma comprovada, ou se a política exigir isolamento estrito, adotar **B mínima** com `privateContext/runIndividually`. Não criar hooks.
3. Considerar memória genérica carregada por agente como segunda melhoria de B, não como pré-requisito do MVP.
4. Usar C somente se futuramente extensões precisarem de operações fora das três fases e result types do pipeline.

## 1. Arquitetura relevante do Marinara

### 1.1 Pacotes

- `packages/client`: React 19, Zustand e React Query. Carrega extensões do navegador e contém editores de personagem, lorebook, agentes e tracker.
- `packages/server`: Fastify, storage persistente, rotas HTTP, montagem do prompt, execução de modelos e pipeline de agentes.
- `packages/shared`: tipos, schemas Zod, manifests de agentes e prompts padrão compartilhados.

### 1.2 Instalação e armazenamento de extensões

O formato oficial está documentado em `docs/EXTENSIONS.md`. Um pacote simples usa:

```text
Narrative Director/
  manifest.json
  extension.js
  extension.css
```

Um pacote de servidor usa `server-extension.js`. Um pack pode usar a organização lógica `Extensions/<Nome>/manifest.json` e um `marinara-extensions.json` na raiz. Esses são caminhos dentro do arquivo/pasta de importação e exportação, não uma pasta de código carregada diretamente pelo servidor.

Depois da importação, o conteúdo de CSS/JS é salvo como dados da extensão por `packages/server/src/services/storage/extensions.storage.ts`, usando o schema `packages/server/src/db/schema/extensions.ts` (ou o backend de storage selecionado pelo Marinara). Não há instalação física de módulos em `packages/client` ou `packages/server`, nem compilação de TypeScript. O instalador aceita `.json`, `.css`, `.js`, `.mjs`, `.cjs`, `.server.js`, `.zip` ou pasta; TypeScript pode estar no pacote como texto, mas não é compilado para execução.

Arquivos centrais:

- `docs/EXTENSIONS.md`: contrato, manifests e limitações oficiais;
- `packages/client/src/components/panels/SettingsPanel.tsx`: importação, exportação, habilitação e remoção;
- `packages/client/src/lib/extension-transfer.ts`: geração/leitura da estrutura `Extensions/...`;
- `packages/shared/src/schemas/extension.schema.ts`: validação e limites (JS de até 1 MiB);
- `packages/server/src/routes/extensions.routes.ts`: CRUD `/api/extensions`, protegido para instalação/alteração;
- `packages/server/src/services/storage/extensions.storage.ts`: persistência;
- `packages/client/src/components/layout/CustomThemeInjector.tsx`: loader do runtime cliente;
- `packages/server/src/services/extensions/server-extension-runtime.ts`: loader do runtime servidor.

### 1.3 API de extensão do navegador

`CustomThemeInjector.tsx` executa o JS habilitado como módulo por Blob URL e passa o objeto `marinara`:

- `extensionId`, `extensionName`;
- `addStyle`, `addElement`;
- `apiFetch(path, options)` para rotas sob `/api`, exceto `/extensions` e `/admin`;
- `on`, `observe`, `setInterval`, `setTimeout`, `onCleanup`.

APIs normais do navegador também permanecem disponíveis. Isso permite criar um painel próprio e chamar os CRUDs públicos. Não há API para React, Zustand, React Query, roteador, chat atual, personagem atual, geração ou prompt. Também não existe catálogo oficial de eventos de domínio. O exemplo `marinara-extension-ready` em `docs/examples/extensions/minimal/extension.js` é um evento criado pela própria extensão, não um evento emitido pelo Marinara.

### 1.4 API de extensão do servidor

`server-extension-runtime.ts` executa cada extensão em `node:vm` e expõe:

- identificação e versão do runtime;
- logger;
- `marinara.fetch` para HTTP/HTTPS com proteções;
- timers;
- cleanup.

Não expõe `FastifyInstance`, banco/storage, `require`, filesystem, imports dinâmicos do núcleo, registro de rota, eventos ou hooks de prompt. Além disso, `marinara.fetch` é voltado a URLs externas seguras e não é uma ponte privilegiada para os serviços internos.

## 2. APIs e funções úteis existentes

### 2.1 Identificar personagem e chat atuais

Internamente, o cliente mantém `activeChatId` e `activeChat` em `packages/client/src/stores/chat.store.ts` (`useChatStore`). O chat contém `characterIds`, `personaId`, conexão e metadata. `ChatArea.tsx` usa `useChat(activeChatId)` e `useChatMessages(activeChatId, ...)`.

Uma extensão importada não pode importar esses módulos de forma suportada nem recebe o store. As alternativas sem núcleo são frágeis:

- inferir o chat pelo DOM;
- observar mudanças de interface;
- interceptar `fetch` global;
- pedir ao usuário que selecione explicitamente personagem/chat na UI da extensão.

Para o MVP sem núcleo, deve-se usar seleção explícita carregada por `GET /api/chats` e `GET /api/characters`; não afirmar que existe detecção confiável do contexto atual. Isso não bloqueia o pipeline: depois que a extensão grava os agent IDs em `chat.metadata.activeAgentIds`, o servidor conhece o chat e personagens durante cada geração. Uma API `marinara.context.getCurrent()` seria apenas melhoria de UX.

### 2.2 Personagens e cartões

Tipos e validação:

- `packages/shared/src/types/character.ts`: `Character`, `CharacterData`, `CharacterExtensions`, `CharacterBook`;
- `packages/shared/src/schemas/character.schema.ts`: `createCharacterSchema`, `updateCharacterSchema`.

Rotas em `packages/server/src/routes/characters.routes.ts`:

- `GET /api/characters` e `GET /api/characters/:id`;
- `POST /api/characters` com `{ data: CharacterData }`;
- `PATCH /api/characters/:id` com `{ data: Partial<CharacterData>, versionSource?, versionReason? }`;
- histórico/restauração em `/:id/versions`;
- importação/associação de lorebook embutido em `/:id/embedded-lorebook/...`.

O cartão público pode usar `description`, `personality`, `scenario`, `extensions.backstory` e `extensions.appearance`. Para aplicar uma história a cartão existente, a extensão deve primeiro buscar o cartão completo, calcular apenas linhas ausentes e enviar patch aditivo. Atenção: a rota chama storage com `mergeExtensions: false`; portanto, ao atualizar `data.extensions`, o cliente deve preservar explicitamente todas as chaves existentes, ou preferir campos top-level quando possível. Nunca enviar uma reconstrução parcial de `extensions` sem merge local.

### 2.3 Lorebooks

Tipos e validação:

- `packages/shared/src/types/lorebook.ts`;
- `packages/shared/src/schemas/lorebook.schema.ts`.

Rotas em `packages/server/src/routes/lorebooks.routes.ts`:

- `GET/POST/PATCH /api/lorebooks`;
- `GET/POST/PATCH/DELETE /api/lorebooks/:id/entries...`;
- bulk de entries e folders;
- consulta por `characterId`, `personaId` ou `chatId`.

Um lorebook pode ser ligado por `characterId`/`characterIds`, por `chatId`, ou usar `scope: { mode: "specific", chatIds: [...] }`. Para histórias reutilizáveis em vários chats do mesmo personagem, a associação primária recomendada é `characterIds: [characterId]`. A extensão deve criar entries públicas/contextuais com keywords, posição, role e regras explícitas, e nunca colocar segredos do Diretor no lorebook, pois conteúdo ativado pode entrar no prompt principal.

O núcleo já possui scan e injeção em:

- `packages/server/src/services/lorebook/keyword-scanner.ts`;
- `packages/server/src/services/lorebook/prompt-injector.ts`;
- `packages/server/src/routes/generate/lorebook-scan-snapshot.ts`;
- `packages/server/src/services/agents/knowledge-router.ts` e `knowledge-retrieval.ts`.

### 2.4 Chats, mensagens e estado

Tipos:

- `packages/shared/src/types/chat.ts`: `Chat`, `ChatMetadata`, mensagens e configurações de agentes;
- `packages/shared/src/types/game-state.ts`: snapshots de `GameState` por chat/mensagem/swipe.

Rotas relevantes em `packages/server/src/routes/chats.routes.ts`:

- `GET /api/chats`, `GET /api/chats/:id`, `PATCH /api/chats/:id`;
- `PATCH /api/chats/:id/metadata` (merge parcial);
- `GET /api/chats/:id/messages` e `GET /api/chats/:id/message-count`;
- `GET/PATCH /api/chats/:id/game-state`;
- rotas de swipes e branch;
- `POST /api/chats/:id/peek-prompt` para inspeção do prompt.

`ChatMetadata` já guarda seleção/override de agentes, templates, variáveis, lorebooks excluídos e configurações do Director. `GameState` já guarda estado por mensagem e swipe e é a base dos trackers. Para dados próprios, não é recomendável misturar o documento inteiro do Diretor em metadata: ele pode vazar em exports, respostas gerais de chat e ferramentas de debug, além de não ter schema/limites dedicados.

### 2.5 Agentes, modelos e conexões

O sistema interno de agentes é a primitiva mais próxima do objetivo:

- `packages/shared/src/types/agent.ts`: `AgentPhase`, `AgentContext`, `AgentResultType`;
- `packages/shared/src/schemas/agent.schema.ts`: criação/edição de agentes customizados;
- `packages/server/src/services/agents/agent-pipeline.ts`: `runPreGenerationAgents`, `runParallelAgents`, `runPostProcessingAgents`, `createAgentPipeline`;
- `packages/server/src/services/agents/agent-executor.ts`: montagem de contexto, chamada ao provider e sanitização de resultados;
- `packages/server/src/services/generation/agent-resolution.ts`: resolução da conexão/modelo e defaults;
- `packages/server/src/routes/agents.routes.ts`: configs, runs, cadence, memória e edição assistida.

O `AgentContext` inclui chat, modo, mensagens recentes, game state, personagens, persona, memória própria, lorebook ativado, resumo, injeções prévias e resposta principal (na fase pós). Agentes podem ter `connectionId`; quando ausente, a resolução usa a conexão padrão para agentes. As conexões configuradas são administradas por `/api/connections` e `packages/server/src/routes/connections.routes.ts`.

Uma extensão de navegador pode criar agentes customizados via `POST /api/agents`, selecionar `connectionId`, colocar o documento privado em `settings`, referenciá-lo no template por macro e ativar os agent IDs em `chat.metadata.activeAgentIds`. Um pré-agente pode emitir `director_event`; um pós-agente pode emitir `custom_tracker_update`, que já possui handler e storage.

A rota `PATCH /api/agents/memory/:agentType/:chatId` oferece memória arbitrária por chat para tipos customizados, mas o pipeline não a carrega genericamente. Para `director`, o patch passa por normalização específica de Secret Plot. Logo, memória serve para edição/exportação pela extensão, mas não como contexto automático na opção A.

## 3. Fluxo real de geração

O fluxo principal está em `packages/server/src/routes/generate.routes.ts`:

1. carrega chat, personagens, persona, mensagens, resumo, lorebooks, game state e conexões;
2. resolve agentes por `resolveAgentsForGeneration` em `agent-resolution.ts`;
3. cria `AgentContext`;
4. cria o pipeline por `createAgentPipeline`;
5. executa agentes `pre_generation` e converte resultados em `AgentInjection`;
6. insere injeções no prompt final, com tratamento específico para Director/knowledge agents;
7. chama o provider principal e persiste a mensagem/swipe;
8. aguarda agentes paralelos e chama `pipeline.postGenerate(combinedResponse, ...)`;
9. valida/aplica resultados e persiste runs e snapshots do tracker.

Esse é exatamente o ponto em que a solução deve integrar. Não há evento público equivalente antes ou depois dessas etapas.

### Director existente

- Manifest: `packages/shared/src/features/agents/director/manifest.ts`.
- Prompt: `NARRATIVE_DIRECTOR_SECRET_PLOT_PROMPT` e prompt `director` em `packages/shared/src/constants/agent-prompts.ts`.
- Memória: storage de agentes e `/api/agents/memory/...`.
- Runtime específico: blocos `narrative-director` em `generate.routes.ts`.

O Director normal é one-shot, pré-geração, e retorna `{"direction":"..."}`; `runPreGenerationAgents` converte isso em uma instrução injetável. Isso é reutilizável conceitualmente.

O Secret Plot existente mantém um arco oculto por chat e tem cadence. Contudo, depois de usar esse estado no agente, `generate.routes.ts` chama `formatSecretPlotSystemBlock(...)` e `appendSecretPlotSystemMessage(...)`, enviando o arco ao modelo principal. Para esta extensão, esse passo deve ser omitido: somente o `direction` filtrado pode ser injetado.

### Trackers existentes

Há agentes de `post_processing` para World State, Character Tracker, Persona Stats, Quest e Custom Tracker. Os resultados são aplicados depois da mensagem e associados ao `messageId` e `swipeIndex`. Arquivos principais:

- manifests em `packages/shared/src/features/agents/*/manifest.ts`;
- prompts em `packages/shared/src/constants/agent-prompts.ts`;
- persistência em `packages/server/src/services/storage/game-state.storage.ts`;
- contexto consolidado em `packages/server/src/services/generation/committed-tracker-context.ts`;
- aplicação de resultados em `packages/server/src/routes/generate.routes.ts`.

Esse mecanismo já atende a semântica “estado separado por chat e atualizado após a resposta”. O novo tracker deve produzir um patch do estado narrativo próprio, baseado na resposta final, estado anterior e instrução filtrada, sem reescrever histórico.

## 4. Modelo de dados proposto

Não guardar segredos no cartão, lorebook, mensagens, `contextInjections`, prompt replay ou metadata geral.

```ts
type NarrativeStory = {
  id: string;
  schemaVersion: 1;
  name: string;
  sourceText?: string; // opcional; permitir ao usuário apagar após extração
  characterId: string;
  publicCard: {
    proposedLines: Array<{ field: string; text: string; permanent: boolean }>;
  };
  publicLorebook: {
    lorebookId?: string;
    entries: NarrativeLoreEntry[];
  };
  privateDirector: {
    secrets: NarrativeSecret[];
    futureEvents: NarrativeEvent[];
    progressions: NarrativeProgression[];
    futureChanges: NarrativeFutureChange[];
    directorNotes: string;
  };
  directorConnectionId: string | null;
  trackerConnectionId: string | null;
  createdAt: string;
  updatedAt: string;
};

type NarrativeChatState = {
  storyId: string;
  chatId: string;
  revision: number;
  currentStage: string;
  reachedMilestones: string[];
  activeThreads: string[];
  revealedSecretIds: string[];
  relationshipChanges: Record<string, unknown>;
  appearanceChanges: Record<string, unknown>;
  situationChanges: Record<string, unknown>;
  lastProcessedMessageId: string | null;
  updatedAt: string;
};
```

Relações:

- uma história pertence a um personagem;
- um personagem possui várias histórias;
- uma história pode ser associada a vários chats;
- cada par `storyId + chatId` possui um estado independente;
- `lastProcessedMessageId` torna o tracker idempotente;
- `revision` permite compare-and-swap e evita que duas gerações concorrentes sobrescrevam estado.

O documento exportado deve conter `schemaVersion`, histórias, associações e, opcionalmente, estados por chat. A UI deve oferecer exportação com ou sem dados privados e exibir aviso explícito, pois o JSON privado contém spoilers/segredos.

## 5. Onde armazenar

### Opção recomendada para A (sem núcleo)

- Documento compartilhado: `settings.narrative.privateDocument` do agente Director criado para a história.
- Associação personagem/história/agents: IndexedDB da extensão e JSON exportável.
- Associação ao chat: `chat.metadata.activeAgentIds` já existente.
- Estado por chat: `GameState.playerStats.customTrackerFields`, atualizado pelo pós-agente e acessível por `/api/chats/:id/game-state`.
- Se o tracker precisar do documento completo, duplicá-lo em seus settings; preferir uma projeção mínima de progressões/IDs para reduzir exposição.

Esse desenho protege contra envio direto ao narrador, mas não contra administradores do Marinara, leitura da API de agentes ou debug de agentes. Criptografia em repouso não existe para settings.

### Opção sem núcleo, somente protótipo manual

IndexedDB no navegador, namespaced pelo ID da extensão. Isso permite múltiplas histórias, edição e JSON, mas tem limitações severas: dados presos ao browser/perfil, sem execução server-side confiável, sem backup central, sem atomicidade e indisponíveis para gerações autônomas ou iniciadas por outro cliente. `localStorage` não é indicado pelo volume e pela ausência de transações.

### Opções rejeitadas

- cartão/lorebook: vazam no prompt principal;
- mensagens ocultas: ainda pertencem ao histórico e podem aparecer em export/debug/bugs de filtro;
- `ChatMetadata`: mistura segredos com configuração pública e não fornece isolamento;
- memória do Director embutido: por chat, schema específico e atualmente reinjetada no narrador;
- código/config da própria extensão: global, não apropriado a dados mutáveis por usuário.

## 6. Contrato de hooks considerado para C (não recomendado para o MVP)

Esta foi a proposta inicial, preservada apenas para comparação. A investigação dos agentes mostrou que ela não é necessária para o MVP. Uma API futura poderia ser:

```ts
marinara.generation.onBeforeMain(async (ctx) => {
  // ctx: generationId, chatId, trigger, regenerateMessageId,
  // characters, persona, relevantHistory, summary, committedState
  return {
    injections: [{ id, role: "system", text, placement: "director" }],
    privateRunData: { storyId, stateRevision }
  };
});

marinara.generation.onAfterPersist(async (ctx) => {
  // ctx: generationId, chatId, messageId, swipeIndex,
  // finalResponse, privateRunData
});

marinara.storage.get/set/list/delete(namespace, scope, key);
marinara.models.generate({ connectionId, messages, responseSchema, signal });
marinara.routes.register(...); // opcional se a UI usar storage helpers via API namespaced
```

Regras do contrato:

- callbacks têm timeout, abort signal, logs e cleanup;
- `onBeforeMain` roda no servidor para todas as gerações suportadas;
- o retorno aceita somente texto filtrado e limites de tamanho;
- dados privados de entrada não são serializados em SSE, runs do narrador, replay ou peek-prompt;
- `privateRunData` fica server-side e só transita para o hook pós-geração;
- `onAfterPersist` recebe a resposta já final e o `messageId`/`swipeIndex` definitivo;
- regeneração é explicitamente distinguida. Pela regra do produto, ela continua acionada manualmente; o sistema pode rodar Diretor/tracker quando o usuário regenera, mas não inicia regeneração por conta própria;
- falha do Director deve ser fail-open configurável (seguir sem direção) e nunca inserir o documento privado bruto;
- falha do tracker não bloqueia nem remove a resposta; fica pendente para retry manual;
- logs de debug devem redigir o documento privado ou exigir uma opção separada e explícita.

Antes dessa API, preferir B: uma flag genérica `privateContext/runIndividually` e, opcionalmente, carregamento de memória por agente. Um built-in “story-director” com storage próprio também é possível, mas transforma a funcionalidade em feature core.

## 7. Fluxo proposto

### 7.1 Criar história nova

1. Usuário cola texto e seleciona/cria personagem.
2. Extensão chama um modelo configurado para extração estruturada com schema estrito.
3. Modelo retorna três envelopes separados: `publicCard`, `publicLorebook`, `privateDirector`.
4. Validação local/servidor rejeita campos cruzados e conteúdo sem schema.
5. UI mostra revisão editável; nada é aplicado automaticamente antes da confirmação.
6. Ao confirmar:
   - cria/preenche cartão;
   - cria lorebook ligado ao personagem e entries públicas;
   - salva documento privado no storage isolado;
   - salva a história e suas referências.

### 7.2 Aplicar a chat existente

1. Seleciona história e chat cujo `characterIds` contém o personagem associado (permitir override explícito com aviso).
2. Busca cartão e lorebooks atuais.
3. Calcula somente acréscimos indispensáveis ao cartão, linha por linha.
4. Mostra diff aditivo; nunca oferece deleção/substituição automática.
5. Cria ou complementa lorebook; entries existentes não são removidas.
6. Analisa mensagens existentes somente para inicializar `NarrativeChatState`.
7. Persiste associação e estado, sem patch em mensagens passadas.

### 7.3 Antes de cada resposta

1. Hook recebe chat, história associada, estado comprometido e histórico relevante.
2. Director recebe o documento privado completo, estado atual, resumo/cartões públicos e histórico limitado.
3. Director retorna schema restrito:

```json
{
  "instruction": "instrução breve para esta cena",
  "usedPrivateIds": ["event-2"],
  "confidence": 0.82
}
```

4. O servidor valida tamanho/schema, remove tags e recusa campos extras.
5. Somente `instruction` é inserida no prompt principal. `usedPrivateIds` permanece privado.

### 7.4 Depois da resposta

1. Hook pós-persistência recebe a resposta final e a âncora `messageId + swipeIndex`.
2. Tracker recebe estado anterior, instrução usada, resposta e trecho relevante do histórico.
3. Retorna JSON Patch limitado aos campos permitidos do `NarrativeChatState`.
4. Servidor valida, aplica com controle de revisão e salva `lastProcessedMessageId`.
5. Nenhuma mensagem é alterada. Em erro, marca update pendente para retry manual.

## 8. O que cabe sem modificar o núcleo

- manifest, carregamento, CSS e painel DOM da extensão;
- lista/seleção explícita de personagens e chats pelas APIs;
- CRUD de cartão e versões;
- CRUD e associação de lorebooks/entries;
- criação/edição de agentes customizados e seleção de conexões;
- leitura/edição de game state e memória de agentes onde o schema permitir;
- extração manual por uma rota one-shot existente apenas se ela aceitar o caso de uso; `/api/agents/suite/rewrite` é útil para reescrita assistida, mas não é uma API genérica de structured generation;
- histórias e estados em IndexedDB;
- revisão, edição, diff aditivo e import/export JSON;
- análise manual do histórico quando o usuário clica “Inicializar/Atualizar estado”.

Não existe hoje uma rota pública genérica e estável para “chame qualquer conexão com este schema”. O caminho suportado para modelos é o pipeline de agentes ou rotas especializadas. Criar um agente customizado pode executar durante uma geração normal, mas não resolve sozinho a extração inicial nem o acesso isolado aos segredos.

## 9. O que somente exige núcleo para garantias/UX adicionais

O pipeline de agentes já cobre interceptação pré, resposta final pós, conexão/modelo, mensagem/swipe, streaming e persistência de tracker. Mudanças core só são necessárias para:

- garantir execução individual do agente privado independentemente da conexão/modelo;
- carregar memória persistida específica de cada agente customizado em seu contexto;
- oferecer estado JSON privado que não apareça no painel de Custom Tracker;
- detectar o chat atual por API de extensão e oferecer um slot de UI estável;
- redigir automaticamente settings/memória privada de debug e exports administrativos;
- oferecer garantia formal de que dados privados não entram em batch, peek-prompt, replay, SSE ou logs.

## 10. Menor MVP possível

### MVP A — menor versão automática, sem núcleo

- extensão de navegador;
- histórias e mapeamentos em IndexedDB/export JSON;
- agentes customizados criados/atualizados pela extensão;
- documento privado nos settings do Director e projeção privada mínima nos settings do tracker;
- um Director `pre_generation`/`director_event` por história;
- um tracker `post_processing`/`custom_tracker_update` por história;
- agentes ativados nos chats por `activeAgentIds`;
- uma história por personagem inicialmente, mas schema/lista já aceitando várias;
- uma história ativa por chat;
- extração estruturada e revisão;
- patch aditivo de cartão e criação de lorebook;
- Director pré-geração com saída `instruction` apenas;
- tracker pós-geração com patch de estado;
- configuração separada de conexão para Director e tracker;
- import/export JSON;
- sem automação de regeneração, validação/bloqueio de resposta, simulação, multi-director ou reescrita histórica.

Restrições de lançamento: recomendar conexão dedicada para agentes privados, desativar debug de agentes quando houver segredos, informar que configurações são legíveis pelo administrador e testar batching/replay/peek-prompt.

### MVP B — hardening mínimo, se isolamento estrito for obrigatório

Adicionar somente `settings.privateContext/runIndividually` ao executor/pipeline e testes de redaction. Opcionalmente carregar memória por agente/chat. Todo o restante permanece igual ao MVP A.

## 11. Estrutura proposta do pacote

Como Marinara não compila TypeScript de extensões, os arquivos distribuídos devem ser JavaScript já bundled. O repositório-fonte da extensão pode usar TypeScript fora do pacote importável.

```text
narrative-director-extension/
  package.json
  tsconfig.json
  src/
    shared/
      schemas.ts
      types.ts
      constants.ts
      redaction.ts
    client/
      index.ts
      api.ts
      context.ts
      storage.ts
      ui/
        panel.ts
        story-editor.ts
        review.ts
        state-view.ts
        settings.ts
        import-export.ts
    agents/
      director-config.ts
      tracker-config.ts
      activation.ts
  tests/
    schema.test.ts
    redaction.test.ts
    additive-card-merge.test.ts
    state-patch.test.ts
    privacy-boundary.test.ts
  dist/
    manifest.json
    extension.js
    extension.css
```

Para A, o pacote distribuído contém apenas `manifest.json`, `extension.js` e `extension.css`. Os “agentes internos” são registros criados pela API `/api/agents`, não código de servidor da extensão. Se B for adotada, suas mudanças pertencem ao core/upstream e o pacote continua client-only.

## 12. Ordem de implementação em etapas pequenas

1. **Fixar invariantes e schemas**: história, documento privado, projeção do tracker, saída textual do Director e `{fields}` do Custom Tracker.
2. **Provar A sem writes de produto**: com configurações temporárias locais, inspecionar prompt do agente e prompt principal; provar que settings privados ficam apenas no primeiro e que só a direção aparece no segundo.
3. **Provar batching**: ativar outro pré-agente com mesma conexão/modelo e verificar se as tarefas são agrupadas; decidir se conexão dedicada basta ou se B é obrigatória.
4. **Provar tracker**: pós-agente customizado em chat descartável, resposta final em `<assistant_response>` e snapshot correto por mensagem/swipe.
5. **Construir UI e IndexedDB**: histórias, revisão, editores, associação, estado, conexões e mapeamento dos agent IDs.
6. **Gerenciar agentes pela extensão**: criar/atualizar Director e tracker, templates/settings, ativar/desativar em `activeAgentIds`, sem duplicar o pipeline.
7. **Implementar criação inicial**: extractor/revisão, cartão e lorebook pelas APIs, depois configs privadas dos agentes.
8. **Aplicar a chat existente**: diff somente aditivo, lorebook complementar e inicialização do estado via game-state; nenhum write em mensagens.
9. **Import/export**: versionamento, migração, export público/privado e reconciliação de agent IDs ausentes.
10. **Adotar B apenas se necessário**: `privateContext/runIndividually`, redaction e testes; não adicionar hooks.
11. **Hardening**: prompt injection, limites, concorrência, falhas, debug, permissões, regeneração/cache e group chat.
12. **Validação integrada**: `pnpm check`, `pnpm regression:prompt`, privacidade e smoke UI; remover `.test.ts` temporário conforme regra do repositório.

## 13. Riscos técnicos

### Críticos

- **Vazamento de segredos**: reutilizar o Secret Plot atual envia o arco ao narrador. Também podem vazar por lorebook, metadata, logs debug, SSE, peek-prompt, replay, erros ou export.
- **Monkey-patching no cliente**: interceptar `window.fetch` não cobre gerações server-side/autônomas, é sensível à ordem de carregamento e pode quebrar streaming/abort.
- **Concorrência e swipes**: duas gerações ou regenerações podem atualizar o mesmo estado. Estado deve ser ligado a `messageId + swipeIndex` e usar revisão otimista.
- **Prompt injection no texto da história**: a história é input não confiável. O extractor e o Director precisam de delimitadores, schema estrito e instruções de precedência; sua saída nunca deve ser aceita como estrutura arbitrária de mensagens.

### Altos

- **Atualização destrutiva de cartão**: patches de `extensions` podem substituir o objeto; sempre fazer read/merge/preserve e mostrar diff.
- **Associação de lorebook**: `characterId`, `characterIds`, `chatId`, `isGlobal` e `scope` têm regras de conflito; usar os schemas oficiais e evitar ativação global acidental.
- **Contexto em regeneração**: o núcleo reutiliza `contextInjections` em regens e possui regras próprias para Secret Plot. O novo Director precisa de política explícita: recalcular a instrução para o swipe ou reutilizar a instrução original. Recomenda-se recalcular, mantendo estado baseado no snapshot anterior ao alvo e sem avançar o tracker até o novo swipe ser persistido.
- **Modelo/conexão indisponível**: Director deve falhar sem bloquear a resposta; tracker deve ficar pendente. Nunca usar resposta não validada como fallback.
- **Compatibilidade com grupos**: uma história é vinculada a um personagem, mas um chat pode ter vários. A instrução deve respeitar todos os personagens e não forçar o personagem dono a falar.

### Médios

- IndexedDB não sincroniza entre clientes;
- storage privado aumenta responsabilidade de export/backup e exclusão;
- prompts e schemas podem consumir tokens em histórias longas; será necessário resumir/indexar o documento privado sem perder a fonte editável;
- extensões importadas têm limite de 1 MiB por JS e não compilam TS;
- UI DOM criada por extensão pode quebrar com mudanças no layout, salvo se houver slot oficial de painel.

## 14. Decisões recomendadas antes de implementar

1. Aprovar primeiro um spike da opção A e o critério de isolamento: “não enviado ao narrador principal” ou “não compartilhado nem com agentes batched”. O segundo critério provavelmente exige B mínima.
2. Definir se o texto fonte completo permanece salvo após a extração. Recomendação: opcional, com botão para apagar e manter apenas a estrutura privada revisada.
3. Definir comportamento de regenerate/swipe. Recomendação: recalcular direção usando o estado anterior ao alvo; salvar novo estado no swipe novo; nunca regenerar automaticamente.
4. Definir se uma ou várias histórias podem estar ativas simultaneamente no mesmo chat. Para o primeiro MVP, permitir várias salvas, mas somente uma ativa por chat.
5. Tratar export privado como segredo: nome de arquivo distinto, aviso e opção de export público sem Director/estado.

## Veredito

O projeto pode reutilizar o pipeline existente sem duplicá-lo. A opção **A** cobre o ciclo automático com uma extensão de UI que cria dois agentes customizados por história: Director pré-geração alimentado por settings privados e Custom Tracker pós-processamento alimentado pela resposta final/game state. Cartão, lorebook, associação a chat, conexão, estado e edição já têm APIs.

A lacuna real não é ausência de hooks. É a qualidade da fronteira privada: memória arbitrária existe mas não é carregada genericamente, e agentes podem ser batched. Se “nunca ao narrador” significa especificamente o modelo principal, A satisfaz a arquitetura com os cuidados descritos. Se significa isolamento também de qualquer outro agente/model request e debug, a escolha correta é **B mínima**, adicionando execução individual/contexto privado ao sistema de agentes atual. **C não é tecnicamente indispensável e não deve ser priorizada.**
