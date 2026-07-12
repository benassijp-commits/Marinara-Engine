# Narrative Director: conclusão da Etapa 3

## Status

Etapa 3 concluída: MVP visual e funcional básico da extensão oficial de navegador.

A extensão é client-only, instalável pelo sistema oficial do Marinara e usa somente IndexedDB, APIs públicas e agentes customizados. Nenhuma implementação da Etapa 4 foi iniciada: não há análise automática por IA, criação de cartão, criação de lorebook ou análise de chats existentes.

## Arquivos criados

```text
extensions/narrative-director/
  .gitignore
  README.md
  manifest.json
  package.json
  scripts/
    build.mjs
  src/
    api.js
    core.js
    extension.css
    storage.js
    ui.js
  tests/
    api.test.mjs
    core.test.mjs
    fake-indexeddb.mjs
    storage.test.mjs
  dist/
    manifest.json
    extension.js
    extension.css
```

Relatório:

```text
NARRATIVE_DIRECTOR_STEP_3.md
```

## Funcionalidades concluídas

### Interface

- botão fixo **Narrative Director**;
- painel próprio com lista de histórias e editor;
- abas Story, Director, Tracker e Activation;
- layout desktop e mobile;
- estados de loading, vazio, erro, sucesso e operação ocupada;
- navegação por teclado, Escape para fechar e Ctrl/Cmd+S para salvar;
- avisos visíveis sobre conexão exclusiva, batching, debug e acesso administrativo.

A interface segue os tokens visuais do Marinara sem depender de código interno. O blush é reservado às ações/seleção, editores usam superfícies sólidas e controles permanecem touch-friendly.

### Histórias e IndexedDB

Cada história armazena:

- `id`, `schemaVersion`, nome e `agentKey` estável;
- personagem e chat selecionados manualmente;
- texto fonte opcional;
- adições propostas ao cartão;
- entradas propostas de lorebook;
- documento privado do Director;
- projeção mínima de progressão do tracker;
- configurações e IDs do Director/tracker;
- chat ativo;
- timestamps.

É possível criar, renomear, editar, salvar e excluir histórias. Exclusão é bloqueada enquanto a história estiver ativa, evitando deixar uma ativação sem referência local.

O banco IndexedDB usa namespace próprio:

```text
marinara-extension-narrative-director
```

### Recursos do Marinara

O painel carrega pelas APIs públicas:

- personagens;
- chats;
- conexões de texto;
- agentes;
- game state do chat selecionado.

A seleção de personagem, chat, conexão do Director e conexão do tracker é manual, conforme o escopo da etapa.

### Agentes customizados

Ativação cria ou atualiza dois agentes por história:

- Director: `phase: pre_generation`, `resultType: director_event`;
- tracker: `phase: post_processing`, `resultType: custom_tracker_update`.

Os types são estáveis e derivados do `agentKey` da história:

```text
narrative-director-director-<agentKey>
narrative-director-tracker-<agentKey>
```

O documento privado completo é colocado somente em:

```text
Director settings.narrative.privateDocument
```

O tracker recebe somente:

```text
Tracker settings.narrative.progressionProjection
```

`buildTrackerPayload()` serializa o payload e lança erro se encontrar o documento privado completo, impedindo envio acidental ao tracker.

### Ativação e desativação

- os valores gravados em `chat.metadata.activeAgentIds` são os `type` dos agentes;
- ativação preserva todos os types existentes e acrescenta somente Director/tracker desta história;
- desativação remove somente esses dois types;
- `enableAgents` é ligado na ativação e não é desligado automaticamente na desativação, pois outros agentes podem depender dele;
- somente uma história da extensão pode estar ativa no mesmo chat;
- falhas são mostradas no painel e não bloqueiam o chat.

A extensão exige conexões diferentes para Director e tracker na ativação. O README esclarece que a conexão do Director não deve ser compartilhada com nenhum outro agente pré-geração.

### Estado do tracker

A aba Activation consulta:

```text
GET /api/chats/:chatId/game-state
```

e mostra `playerStats.customTrackerFields`, incluindo a âncora de mensagem/swipe quando disponível.

### Importação e exportação

- exporta JSON versionado com todas as histórias;
- importa somente `kind: marinara.narrative-director-stories` e `schemaVersion: 1`;
- merge por ID na interface;
- dados importados passam por normalização de schema;
- o README avisa que o arquivo exportado contém dados privados.

## Build distribuível

O build está em:

```text
extensions/narrative-director/dist/
```

e contém exatamente:

- `manifest.json`;
- `extension.js`;
- `extension.css`.

O manifest usa `kind: marinara.extension`, aponta para os dois assets e inicia desabilitado para revisão explícita antes da primeira execução.

## Como compilar

```bash
cd /home/scion/Marinara-Engine/extensions/narrative-director
npm run build
```

Não há dependências para instalar.

## Como instalar exatamente

1. Compile com `npm run build`.
2. Abra o Marinara Engine.
3. Abra **Settings → Addons → Extension Library**.
4. Clique em **Import Extension Folder**.
5. Selecione a pasta:

   ```text
   /home/scion/Marinara-Engine/extensions/narrative-director/dist
   ```

6. Revise a entrada **Narrative Director**.
7. Habilite a extensão manualmente.
8. Clique no botão **Narrative Director**, próximo à borda inferior direita.

## Testes executados

### Testes automatizados

Comando:

```bash
cd extensions/narrative-director
npm test
```

Resultado:

```text
pass: 3 arquivos de teste
fail: 0
```

Cobertura funcional:

- criação e validação de história;
- edição e exclusão no IndexedDB;
- listagem, replace de importação e metadata no IndexedDB;
- payloads de Director e tracker;
- criação dos dois agentes pela API pública;
- prevenção de inclusão do documento privado no tracker;
- ativação e desativação;
- preservação de `activeAgentIds` externos;
- importação e exportação JSON versionadas.

### Build e sintaxe

Comandos:

```bash
npm run build
node --check dist/extension.js
cmp -s manifest.json dist/manifest.json
test -s dist/extension.css
test -s dist/extension.js
```

Resultados:

- quatro módulos concatenados em `dist/extension.js`;
- JavaScript distribuível sintaticamente válido;
- manifest copiado sem divergência;
- CSS e JS não vazios.

Uma tentativa acidental de `npm test` na raiz acionou a suíte completa do monorepo e falhou antes dos testes do servidor porque o sandbox negou o socket IPC `/tmp/tsx-1000/46.pipe` (`listen EPERM`). Essa tentativa não é validação da extensão e não indica falha funcional. A suíte correta, executada em `extensions/narrative-director`, passou integralmente depois disso.

### Instalação oficial isolada

Uma instância isolada do Marinara foi iniciada na porta `17861`, com storage próprio ignorado pelo Git. O build foi importado por `POST /api/extensions`, a mesma API da Extension Library.

Resultado:

```text
HTTP 200
runtime: client
enabled: true no ambiente de smoke
```

O perfil normal do usuário não foi acessado.

### Smoke visual desktop

Chromium headless, viewport `1280×800`:

```json
{
  "title": "Narrative Director",
  "empty": "Build a private story plan",
  "errors": [],
  "launcher": true,
  "panel": true
}
```

### Smoke visual mobile e persistência

Chromium headless, viewport `390×844`:

```json
{
  "row": "Mobile smoke story",
  "errors": [],
  "horizontalOverflow": false,
  "panel": true
}
```

O smoke abriu o painel, criou uma história, salvou no IndexedDB, encontrou a história na lista e confirmou ausência de overflow horizontal.

## Limitações conhecidas

- IndexedDB é local ao navegador e não sincroniza entre dispositivos/perfis.
- desativação preserva os agent configs para reativação futura;
- exclusão de uma história inativa não apaga automaticamente seus agent configs;
- o estado mostra todos os custom tracker fields do chat, inclusive os de outros trackers;
- o chat atual não pode ser detectado oficialmente, por isso a seleção é manual;
- conexão exclusiva reduz batching, mas a extensão não controla internamente o batcher;
- debug de agentes pode registrar o documento privado;
- administrador local e API/UI de agentes podem ler settings privados;
- `director_event` é texto livre e não oferece garantia semântica absoluta contra revelação pelo próprio modelo;
- regeneração manual segue o cache de injeções do pipeline existente;
- campos de cartão/lorebook são somente planejamento nesta etapa.

## Confirmação de escopo

Nenhum arquivo foi alterado em:

```text
packages/client
packages/server
packages/shared
```

Não foram adicionados hooks, patches de pipeline, server extension, Secret Plot, análise automática, criação de cartão/lorebook ou reescrita de histórico.

## Próximas etapas

Ainda faltam as etapas 4 a 7 descritas pelo usuário. Nenhuma delas foi iniciada. O trabalho parou ao concluir a Etapa 3.
