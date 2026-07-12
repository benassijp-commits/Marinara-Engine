# Narrative Director — Etapa 6 de 7

## Status

**Etapa 6/7 implementada, aguardando validação.**

Esta entrega implementa somente a inicialização manual de Director e tracker a partir de um chat existente. A Etapa 7 não foi iniciada.

## Arquivos alterados

- `extensions/narrative-director/src/core.js`
- `extensions/narrative-director/src/api.js`
- `extensions/narrative-director/src/ui.js`
- `extensions/narrative-director/src/extension.css`
- `extensions/narrative-director/tests/core.test.mjs`
- `extensions/narrative-director/tests/api.test.mjs`
- `extensions/narrative-director/tests/storage.test.mjs`
- `extensions/narrative-director/README.md`
- artefatos reconstruídos em `extensions/narrative-director/dist/`
- este relatório, `NARRATIVE_DIRECTOR_STEP_6.md`

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi alterado.

## APIs públicas utilizadas

- `GET /api/chats/:id/messages`: lê as mensagens atualmente ativas do chat selecionado.
- `POST /api/agents/suite/rewrite`: compara o histórico ativo com o documento privado e retorna uma proposta estruturada.
- `GET /api/agents`: procura Director e tracker existentes pelo `type` estável da história.
- `POST /api/agents`: cria um agente somente quando seu tipo ainda não existe.
- `PATCH /api/agents/:id`: atualiza agentes existentes, evitando duplicação.

Nenhuma rota de criação, edição, exclusão, regeneração ou seleção de swipe de mensagens é chamada. A confirmação também não altera `activeAgentIds` e não ativa os agentes.

## Fluxo entregue

A nova aba **Initialize** permite:

1. selecionar uma conexão dedicada à inicialização;
2. iniciar a leitura e análise somente pelo botão **Initialize from existing chat**;
3. revisar uma proposta ainda não persistida;
4. editar cada componente do estado;
5. cancelar e descartar a proposta sem salvar;
6. confirmar o estado e atualizar Director/tracker;
7. manter a ativação como ação separada na aba **Activation**.

Se a análise falhar, a proposta temporária é descartada, o estado confirmado anterior permanece intacto e nenhuma alteração é feita nas mensagens ou nos agentes.

## Estado estruturado

A proposta contém:

- resumo do que já aconteceu;
- ponto atual da história;
- eventos confirmados já ocorridos;
- eventos privados ainda pendentes;
- segredos claramente revelados;
- segredos bloqueados, representados por ID e rótulo não revelador;
- estado confirmado dos personagens;
- estágio atual e IDs de eventos revelados para o tracker.

O prompt instrui o modelo a não transformar suspeitas, crenças de personagens, foreshadowing ou hipóteses em fatos confirmados.

## Separação entre Director e tracker

Após confirmação:

- o Director recebe `settings.narrative.privateDocument` e `settings.narrative.currentState` completos;
- o tracker recebe a projeção configurada e um `initialState` filtrado;
- o estado filtrado do tracker contém somente resumo ocorrido, ponto atual, eventos ocorridos, segredos já revelados, estados dos personagens, progressão e IDs dos segredos bloqueados;
- eventos futuros pendentes e rótulos dos segredos bloqueados não são enviados ao tracker;
- o payload do tracker continua rejeitado se contiver o documento privado completo.

Os templates antigos que ainda não possuem as macros novas recebem automaticamente os blocos `{{narrative.currentState}}` ou `{{narrative.initialState}}` no payload do agente, sem exigir migração dos dados locais nesta etapa.

## Histórico e swipes

`GET /api/chats/:id/messages` retorna o campo `content` correspondente ao swipe ativo e informa `activeSwipeIndex`. A extensão usa apenas esse conteúdo e o índice já selecionado pelo Marinara. Ela não lista alternativas, não escolhe swipes e não implementa lógica própria para eles.

As mensagens são copiadas para o pedido de análise sem mutação. Nenhuma mensagem anterior é editada, apagada, recriada ou regenerada.

## Persistência e atomicidade local

- A proposta gerada fica somente em memória.
- Cancelar não grava o estado proposto no IndexedDB.
- A confirmação valida novamente todos os campos antes de atualizar os agentes.
- O novo estado só é persistido como `confirmedInitialState` depois que Director e tracker são atualizados com sucesso.
- Em falha de análise ou atualização, o último estado confirmado continua salvo.

Existe uma limitação externa: se a atualização do Director for aceita e a atualização do tracker falhar, o servidor já terá aplicado a primeira operação. O log registra separadamente quais agentes foram atualizados; o IndexedDB mantém o estado confirmado anterior e uma nova confirmação pode repetir o upsert sem duplicar agentes.

## Diagnóstico sanitizado

Para inicialização, o log acrescenta somente:

- ID do chat;
- quantidade de mensagens analisadas;
- sucesso ou erro;
- confirmação separada de atualização do Director e tracker;
- horário, operação, etapa e IDs dos agentes, quando disponíveis.

O log não armazena mensagens, documento privado, prompt ou resposta da IA. Erros persistidos de inicialização são deliberadamente genéricos para impedir que respostas externas ecoem conteúdo sensível. O erro detalhado ainda é mostrado na sessão atual ao usuário.

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

- nenhuma chamada antes da ação explícita;
- leitura pública das mensagens;
- uso do conteúdo e índice do swipe ativo;
- ausência de mutação nas mensagens fornecidas;
- parsing e validação do estado estruturado;
- proposta não persistida antes da confirmação;
- cancelamento sem estado salvo;
- falha inválida sem alterar a história anterior;
- estado completo no Director e projeção filtrada no tracker;
- ausência de conteúdo futuro bloqueado no tracker;
- atualização de agentes existentes via PATCH, sem POST duplicado;
- ausência de ativação automática;
- diagnóstico com contagem e flags, sem conteúdo de mensagens;
- regressões das Etapas 3–5;
- build e sintaxe do bundle.

## Como validar manualmente

1. Execute `npm run build` e atualize a extensão usando `extensions/narrative-director/dist`.
2. Escolha uma história com documento privado, um chat em andamento e uma conexão de inicialização.
3. Abra **Initialize** e confirme que nenhuma análise ocorreu até pressionar o botão.
4. Pressione **Initialize from existing chat** e revise os oito grupos de estado retornados.
5. Edite o estado, pressione **Cancel proposal**, feche e reabra o painel; o estado cancelado não deve aparecer como confirmado.
6. Gere outra proposta, revise e pressione **Confirm state and update agents**.
7. Confira no Agents UI que os mesmos tipos foram atualizados, não duplicados.
8. Confirme que os agentes não foram ativados automaticamente no chat.
9. Confira que o Director possui documento privado e estado confirmado, enquanto o tracker possui apenas o estado filtrado.
10. Confira o histórico do chat e seus swipes; nenhuma mensagem ou seleção deve ter mudado.
11. Force uma resposta inválida da conexão e confirme que o estado anterior permanece visível e o chat continua utilizável.
12. Copie o relatório sanitizado e confirme que ele contém apenas metadados operacionais.

## Limitações

- O documento privado completo mais o histórico ativo precisam caber no limite público de 50.000 caracteres da rota de rewrite. A extensão retorna erro em vez de truncar silenciosamente fatos antigos ou o plano privado.
- Não é criado um snapshot direto de game state. A progressão inicial filtrada fica na configuração do tracker e será usada no próximo processamento normal após uma resposta.
- A classificação de suspeitas e fatos depende do modelo e da revisão humana, embora o prompt e a estrutura exijam distinção explícita.
- Não há análise incremental, embeddings, Retrieval Knowledge, memória genérica, edição de recursos públicos, NPCs, imagens ou migração.
- A possível atualização externa parcial dos dois agentes é recuperável por novo upsert, mas não há transação multiagente na API pública.

## Confirmação de isolamento do núcleo

Toda a implementação funcional permanece em `extensions/narrative-director`, além deste relatório na raiz. Não foram alterados arquivos dos pacotes centrais, adicionados hooks ou modificados pipelines do Marinara.
