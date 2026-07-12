# Narrative Director — Etapa 5 de 7

## Status

**Etapa 5/7 implementada, aguardando validação.**

Esta entrega implementa somente a aplicação explícita das propostas públicas em um novo personagem, um novo lorebook e o chat selecionado. A Etapa 6 não foi iniciada.

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
- este relatório, `NARRATIVE_DIRECTOR_STEP_5.md`

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi alterado.

## APIs públicas utilizadas

- `POST /api/characters`: cria um novo cartão de personagem.
- `POST /api/lorebooks`: cria um lorebook, com escopo para o chat e vínculo ao personagem novo quando disponível.
- `POST /api/lorebooks/:id/entries`: cria individualmente cada entrada selecionada.
- `GET /api/chats/:id`: lê participantes e metadata atuais antes de associar recursos.
- `PATCH /api/chats/:id`: acrescenta o personagem novo sem remover participantes existentes.
- `PATCH /api/chats/:id/metadata`: acrescenta o lorebook a `activeLorebookIds`, preserva os demais e o remove de `excludedLorebookIds` se necessário.
- `POST /api/agents` e `PATCH /api/agents/:id`: APIs já usadas para criar ou atualizar Director e tracker.
- `PATCH /api/chats/:id/metadata`: também permanece responsável pela ativação explícita dos tipos dos agentes.

## Recursos e fluxo entregues

Uma nova aba **Apply** permite:

1. escolher quais dos três blocos públicos entram na descrição do cartão;
2. editar o nome do novo personagem;
3. visualizar a descrição final do cartão antes da escrita;
4. escolher, editar e visualizar as entradas propostas para o lorebook;
5. editar o nome do lorebook;
6. confirmar explicitamente que o preview público foi revisado;
7. criar ou repetir somente operações pendentes;
8. copiar um relatório sanitizado das operações.

O documento privado do Director não participa da construção dos payloads públicos. Antes da escrita, a extensão rejeita qualquer payload que contenha o documento privado completo. O tracker continua recebendo somente `progressionProjection`.

## Persistência e recuperação parcial

Os seguintes dados passam a ser armazenados na história local:

- seções públicas selecionadas para o cartão;
- índices das entradas selecionadas;
- nomes revisados do personagem e lorebook;
- ID do personagem criado;
- ID do lorebook criado;
- IDs das entradas criadas, por índice da proposta;
- chat associado ao personagem;
- chat associado ao lorebook;
- IDs dos agentes, já mantidos pelas etapas anteriores;
- log sanitizado e limitado às 50 operações mais recentes.

Cada ID é salvo no IndexedDB imediatamente após a respectiva resposta de sucesso. Se o cartão for criado e o lorebook falhar, o ID do cartão permanece visível e salvo. Um novo clique pula o cartão e tenta somente o lorebook, suas entradas ainda pendentes e associações incompletas. Durante uma execução, os controles ficam desabilitados para impedir cliques concorrentes.

## Funcionamento da associação

- O personagem novo é acrescentado ao array `characterIds` do chat selecionado.
- O lorebook é criado com `chatId`, escopo específico para o chat e, quando o personagem já existe, `characterIds` contendo seu ID.
- O lorebook também é acrescentado a `metadata.activeLorebookIds`, que é a associação explícita usada pela interface nativa para fixar lorebooks em um chat.
- IDs existentes de personagens, lorebooks e agentes são preservados.
- A criação/atualização e ativação do Director e tracker continuam na aba **Activation** e só acontecem mediante ação separada do usuário.

## Diagnóstico mínimo

O log local registra somente:

- operação;
- horário;
- etapa;
- sucesso ou erro;
- IDs dos recursos envolvidos;
- mensagem de erro truncada e sanitizada.

Não são registrados documento privado, prompt, resposta da IA, texto de proposta ou segredos. O botão **Copy sanitized report** copia apenas esse subconjunto.

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

- construção do preview conforme seções e entradas selecionadas;
- ausência do documento privado nos recursos públicos;
- bloqueio sem confirmação explícita;
- criação de cartão, lorebook e entrada pelas rotas públicas;
- associação que preserva personagens e lorebooks existentes no chat;
- armazenamento dos IDs e progresso parcial no IndexedDB;
- cálculo idempotente que ignora recursos concluídos;
- repetição somente de entrada que falhou;
- sanitização do documento privado em erros e logs;
- parsing e persistência da Etapa 4, sem regressões;
- build e sintaxe do bundle distribuível.

## Como validar manualmente

1. Execute `npm run build` e atualize a extensão usando `extensions/narrative-director/dist`.
2. Abra uma história analisada na Etapa 4 e selecione um chat.
3. Abra **Apply**, altere o nome do personagem e selecione apenas parte dos blocos públicos.
4. Edite, selecione e desmarque entradas do lorebook; confirme que o preview acompanha as escolhas.
5. Sem marcar a confirmação, pressione o botão de criação e confirme que nenhuma escrita ocorre.
6. Marque a confirmação e crie os recursos.
7. Confira os IDs e sucessos no log, no cartão criado, no lorebook e nas configurações do chat.
8. Clique novamente e confirme que cartão, lorebook e entradas concluídas não são duplicados.
9. Para validar recuperação parcial, use uma falha temporária da API de lorebook após criar o cartão; restaure a API e repita. Somente a parte pendente deve ser executada.
10. Copie o relatório sanitizado e confirme que ele contém somente operação, horário, etapa, status, IDs e erro.
11. Ative os agentes separadamente em **Activation** e confirme que o Director contém o documento privado e o tracker apenas a projeção resumida.

## Limitações

- A extensão cria somente cartões novos. Não edita, acrescenta ou atualiza cartões antigos.
- A API pública de criação não oferece chave de idempotência. Se o servidor concluir uma criação mas a resposta com o ID se perder na rede, a extensão não consegue provar que o recurso existe; esse caso raro pode exigir verificação manual antes de repetir. Após o recebimento do ID, cliques repetidos são ignorados com segurança.
- Adicionar um personagem a um chat existente usa o comportamento público normal do Marinara e pode criar uma mensagem de sistema informando que o personagem entrou no chat.
- Alterações feitas no preview depois que um recurso já foi criado não atualizam o recurso existente. Esta etapa evita edição automática de cartões antigos; a edição posterior deve ser feita na interface nativa.
- Análise de histórico, estado inicial por chat existente e tracker inicial pertencem à Etapa 6 e não foram implementados.
- Não há Retrieval Knowledge, NPCs, imagens, migração ou sistema amplo de debugging.

## Confirmação de isolamento do núcleo

Toda a implementação funcional permanece em `extensions/narrative-director`, com este relatório na raiz. Não foram alterados arquivos do cliente, servidor ou pacote compartilhado do Marinara. Não foram adicionados hooks nem patches no pipeline principal.
