# Prova técnica da Opção A — Narrative Director

## Resultado

A Opção A funciona usando somente APIs públicas e agentes customizados existentes. A prova confirmou o fluxo completo:

1. um agente customizado `pre_generation` recebeu um documento privado em `settings.narrative.privateDocument`;
2. retornou um `director_event` curto;
3. o prompt do narrador recebeu somente essa instrução, sem o documento nem seu marcador privado;
4. um agente customizado `post_processing` recebeu `<assistant_response>`;
5. retornou `custom_tracker_update` com `current_stage` e `revealed_events`;
6. o estado foi salvo no chat, `messageId` e `swipeIndex` corretos;
7. uma regeneração manual reutilizou a instrução em cache e executou novamente o tracker no novo swipe.

Não houve alteração em `packages/client`, `packages/server` ou `packages/shared`. Não foram usados cartão, lorebook ou Secret Plot nativo.

## Ambiente isolado

A prova foi executada contra o build existente `2.1.1+f257b4b5982d`, em uma instância isolada:

- Marinara: `http://127.0.0.1:17860`;
- storage: `narrative-director-spike/data`;
- provider OpenAI-compatible determinístico: `narrative-director-spike/mock-openai.mjs`;
- log bruto de requests do provider: `narrative-director-spike/evidence/provider-requests.jsonl`;
- personagem, chat, conexões e história eram fixtures sem dados reais.

O mock registrou as mensagens exatas recebidas e respondeu de modo determinístico. O marcador privado foi:

```text
SPIKE_PRIVATE_ORCHID_731
```

Os processos locais foram encerrados ao final. O diretório `data/` está ignorado pelo `.gitignore` do spike.

## Configuração do Director

Configuração criada por `POST /api/agents`:

```json
{
  "type": "spike-filtered-director",
  "name": "Spike Filtered Director",
  "phase": "pre_generation",
  "connectionId": "<dedicated-agent-connection>",
  "resultType": "director_event",
  "promptTemplate": "Use the private document only to plan the immediate scene. Return only one brief filtered instruction. Private document: <private_document>{{narrative.privateDocument}}</private_document>",
  "settings": {
    "narrative": {
      "privateDocument": "SPIKE_PRIVATE_ORCHID_731: At the appropriate time, a brass key may appear. The origin must remain secret."
    },
    "contextSize": 5,
    "temperature": 0,
    "maxTokens": 128
  }
}
```

Resposta observada:

```text
Faça surgir uma chave de latão discreta, sem explicar sua origem.
```

O SSE confirmou:

```json
{
  "agentType": "spike-filtered-director",
  "resultType": "director_event",
  "data": {
    "text": "Faça surgir uma chave de latão discreta, sem explicar sua origem."
  },
  "success": true
}
```

## Prova da fronteira privada

Na execução limpa com conexões separadas, os requests 16–18 do log do provider formaram a sequência:

| Request | Destino lógico | Marcador privado | Instrução filtrada | `<assistant_response>` |
|---:|---|:---:|:---:|:---:|
| 16 | Director | sim | não | não |
| 17 | narrador principal | não | sim | não |
| 18 | tracker | não | não | sim |

O request 16 continha o documento expandido dentro de `<private_document>`. O request 17 não continha `SPIKE_PRIVATE_ORCHID_731`, “origin must remain secret” nem o bloco privado. Continha somente:

```xml
<spike_filtered_director>
Faça surgir uma chave de latão discreta, sem explicar sua origem.
</spike_filtered_director>
```

O `message_saved.extra.contextInjections` também continha somente a instrução filtrada. O prompt cacheado do narrador preservou a mesma separação.

Conclusão limitada: a prova confirma ausência literal do documento privado no request do narrador. Ela não prova que um modelo real nunca possa reproduzir semanticamente um segredo a partir de uma instrução mal filtrada; essa segurança depende do prompt, modelo, validação e revisão do formato de saída.

## Configuração e prova do tracker

Configuração criada por `POST /api/agents`:

```json
{
  "type": "spike-narrative-tracker",
  "name": "Spike Narrative Tracker",
  "phase": "post_processing",
  "connectionId": "<dedicated-agent-connection>",
  "resultType": "custom_tracker_update",
  "promptTemplate": "Read <assistant_response>. Return only {\"fields\":[{\"name\":\"current_stage\",\"value\":\"short stage\"},{\"name\":\"revealed_events\",\"value\":\"events\"}]}",
  "settings": {
    "contextSize": 5,
    "temperature": 0,
    "maxTokens": 256
  }
}
```

O request do tracker continha:

- o prompt do tracker;
- `<current_game_state>`;
- histórico recente;
- `<assistant_response>` com a resposta final do narrador;
- capability inferida `edit_trackers`.

Resultado:

```json
{
  "fields": [
    { "name": "current_stage", "value": "key_discovered" },
    { "name": "revealed_events", "value": "brass_key_appeared" }
  ]
}
```

`GET /api/chats/:chatId/game-state` confirmou os campos em `playerStats.customTrackerFields` no chat de teste. Na primeira execução válida, o snapshot foi salvo com:

```text
chatId     = DMeg-w7K1oIj-Irk47B9c
messageId  = CIUzNjiqvRv0bjfOTok_O
swipeIndex = 0
```

## Conexão dedicada

O teste final usou dois registros de conexão diferentes, embora ambos apontassem ao mesmo mock para permitir inspeção:

- chat/narrador: `Spike Main Narrator Mock`;
- Director/tracker: `Spike Dedicated Mock`.

O resolver executou o Director pela conexão configurada no agente e o narrador pela conexão configurada no chat/request. A sequência de requests 16–18 confirmou prompts separados.

Uma conexão dedicada não desabilita batching entre agentes que compartilham essa conexão. Para isolamento operacional sem núcleo, a conexão do Director não deve ser compartilhada com outros agentes `pre_generation` que usem o mesmo modelo. Director e tracker podem compartilhar a conexão porque rodam em fases diferentes e, portanto, não entram no mesmo batch entre si.

## Teste de batching

Foi criado temporariamente um segundo agente `pre_generation`, `spike-batch-probe`, com a mesma conexão e modelo do Director. O request 5 do log continha as duas tarefas no mesmo system prompt:

```text
<agent_task id="spike-batch-probe" ...>
<agent_task id="spike-filtered-director" ...>
```

O mesmo request também continha `SPIKE_PRIVATE_ORCHID_731`. A resposta conjunta foi:

```json
{
  "spike-batch-probe": "BATCH_PROBE_OK",
  "spike-filtered-director": "Faça surgir uma chave de latão discreta, sem explicar sua origem."
}
```

Conclusão: há batching quando dois agentes da mesma fase compartilham provider/model. A Opção A impede envio ao narrador principal, mas não isola o documento dos outros agentes do mesmo batch. Sem mudanças no núcleo, a mitigação suportada é dedicar uma conexão/modelo exclusivamente ao Director ou garantir que nenhum outro pré-agente use a mesma combinação.

## Regeneração manual

A regeneração foi acionada por `POST /api/generate` com `regenerateMessageId` do último assistant.

Comportamento observado:

- o Director e o batch probe não foram chamados novamente;
- o SSE retornou as injeções com `cached: true` e `tokensUsed: 0`;
- a mesma instrução filtrada foi inserida no prompt do narrador;
- o tracker pós-processamento foi chamado novamente com a nova resposta;
- foi criado o swipe 1 no mesmo `messageId`;
- o game state mais recente ficou ancorado em `swipeIndex: 1` com os dois campos.

Isso significa que, na implementação final da Opção A, regeneração manual reutiliza a direção original por padrão. Alterar o documento privado ou prompt do Director antes de regenerar não recalcula automaticamente aquela injeção cacheada.

## Ativação: ID versus type

A primeira tentativa colocou os IDs dos registros customizados em `chat.metadata.activeAgentIds`, seguindo a nomenclatura do campo e o comportamento aparente da UI. O servidor registrou:

```text
Resolved 0 agents ... activeIds=[<config-id>,<config-id>]
```

O resolver compara `activeAgentIds` com `cfg.type`. Ao gravar:

```json
{
  "activeAgentIds": [
    "spike-filtered-director",
    "spike-narrative-tracker"
  ]
}
```

os dois agentes foram resolvidos corretamente.

Esse é um risco real para a extensão: ela deve persistir os `type` customizados em `activeAgentIds`, apesar do nome do campo e de partes da UI tratarem agentes customizados por `agent.id`. A prova não alterou o núcleo para corrigir o descompasso.

## Rodadas inválidas do fixture

Os requests 10–15 incluem duas rodadas que não contam como prova de saída. O primeiro mock classificava requests apenas pela presença de palavras e confundiu estado/histórico do tracker com a tarefa ativa. A classificação foi corrigida para usar o marcador privado e a estrutura `<agents>`. As mensagens defeituosas foram removidas do chat descartável antes da rodada limpa.

Essas rodadas não invalidam a inspeção dos prompts, mas foram excluídas das conclusões funcionais. A evidência final é a sequência 16–18.

## Limitações sem mudanças no núcleo

- `settings` são privados em relação ao prompt do narrador, mas continuam legíveis pelas APIs/UI de agentes e pelo administrador.
- Com `LOG_LEVEL=debug`/debug de agentes, o prompt completo do Director, incluindo o documento, é registrado. Produção com segredos não deve habilitar esse debug.
- Não há validação semântica de que a instrução curta não revela um segredo. `director_event` customizado é texto livre.
- Injeções são persistidas em `message.extra.contextInjections` e no prompt cacheado. Isso é desejado para regeneração, mas significa que a instrução filtrada não é privada.
- Custom Tracker salva strings visíveis no tracker do chat; não é storage secreto.
- Agentes customizados da mesma fase/provider/model podem ser batched.
- `activeAgentIds` precisou receber `type`, não o ID do registro.
- A memória arbitrária de agente não foi usada; o documento foi expandido de `settings.narrative.privateDocument`.

## Limpeza

Ao final de cada rodada, a metadata do chat foi atualizada para:

```json
{
  "enableAgents": false,
  "activeAgentIds": []
}
```

Todos os agentes temporários foram removidos por `DELETE /api/agents/:id`. A consulta final `GET /api/agents` retornou `[]`. Os processos Marinara e mock foram encerrados. A limpeza ocorreu somente na instância isolada; o perfil normal do usuário nunca foi aberto.

## Veredito

É possível construir a arquitetura básica da Opção A sem modificar o núcleo:

- extensão oficial de UI para gerenciar histórias e agentes;
- documento privado em settings do Director;
- Director customizado `pre_generation`/`director_event`;
- tracker customizado `post_processing`/`custom_tracker_update`;
- estado independente por chat em Custom Tracker;
- cartão/lorebook futuramente pelas APIs existentes;
- pipeline nativo preservado.

Para respeitar a regra prática “o documento nunca chega ao narrador”, a extensão deve usar tipos customizados em `activeAgentIds`, conexão exclusiva do Director, prompt de saída estrito, debug desligado e inspeções/regressões que busquem marcadores privados no prompt principal. Nenhum patch core é necessário para esse escopo, aceitando as limitações acima.
