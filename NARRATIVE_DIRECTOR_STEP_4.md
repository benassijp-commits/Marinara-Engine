# Narrative Director — Etapa 4 de 7

## Status

**Etapa 4/7 implementada, aguardando validação.**

Esta etapa implementa a análise inicial, manual e assistida por IA de uma história. Nenhuma funcionalidade da Etapa 5 foi iniciada.

## Arquivos alterados

- `extensions/narrative-director/src/core.js`
- `extensions/narrative-director/src/api.js`
- `extensions/narrative-director/src/ui.js`
- `extensions/narrative-director/extension.css`
- `extensions/narrative-director/tests/core.test.mjs`
- `extensions/narrative-director/tests/api.test.mjs`
- `extensions/narrative-director/tests/storage.test.mjs`
- `extensions/narrative-director/README.md`
- artefatos reconstruídos em `extensions/narrative-director/dist/`
- este relatório, `NARRATIVE_DIRECTOR_STEP_4.md`

Nenhum arquivo de `packages/client`, `packages/server` ou `packages/shared` foi alterado.

## Funcionalidades entregues

- Campo existente para o texto original preservado durante sucesso, nova geração e falhas.
- Seleção independente da conexão usada para análise.
- Botão **Analyze story** como único gatilho para a chamada de IA; não existe análise ao abrir, editar, salvar ou ativar uma história.
- Uso da API pública `POST /api/agents/suite/rewrite`, com limite explícito de 50.000 caracteres para o texto analisado.
- Prompt de extração que trata o texto colado como dados e pede somente um objeto JSON com:
  - nome sugerido;
  - resumo;
  - informações relevantes do personagem;
  - adições propostas ao cartão;
  - entradas propostas de lorebook;
  - documento privado completo do Director;
  - projeção resumida do tracker.
- Parsing de JSON puro e de JSON dentro de bloco Markdown, inclusive quando há texto ao redor do bloco.
- Validação estrutural dos campos obrigatórios e mensagens compreensíveis para resposta vazia, JSON inválido, estrutura inválida ou falha da conexão.
- Resultado preenchido nos campos revisáveis existentes e salvo em IndexedDB após uma resposta válida.
- Todos os campos gerados continuam editáveis e podem ser gerados novamente por ação manual.
- Separação de dados: o documento completo vai somente para `privateDocument`; o tracker recebe somente `progressionProjection`.
- Proteção adicional contra uma projeção do tracker idêntica ao documento privado completo.
- Layout responsivo: o seletor e o botão de análise passam para uma coluna em telas estreitas.

Nada é aplicado automaticamente a cartão, lorebook ou agentes durante a análise. A ativação de agentes continua sendo uma ação separada e confirmada pelo usuário.

## Como testar manualmente

1. Em `extensions/narrative-director`, execute `npm run build`.
2. Importe ou atualize a extensão a partir de `extensions/narrative-director/dist` em **Settings → Addons → Extension Library**.
3. Abra **Narrative Director** e crie uma história.
4. Cole um texto fictício no campo de fonte.
5. Confirme, pelas ferramentas de rede do navegador se desejado, que nenhuma requisição de análise ocorre ao colar ou editar o texto.
6. Escolha uma conexão de análise e pressione **Analyze story**.
7. Confira se resumo, personagem, cartão, lorebook, documento privado e projeção do tracker foram preenchidos.
8. Edite cada proposta e salve; feche e reabra o painel para confirmar a persistência local.
9. Pressione **Analyze story** novamente para confirmar que a regeneração permanece manual.
10. Teste com uma conexão indisponível ou uma resposta que não seja JSON e confirme que aparece um erro e que o texto original continua no campo.
11. Compare os campos Director e tracker: o documento privado completo não deve ser copiado para a projeção resumida.
12. Repita em uma largura de tela móvel e confira que seletor e botão permanecem acessíveis.

## Testes executados

Executados em `extensions/narrative-director`:

```text
npm test
  3 arquivos de teste aprovados
  0 falhas

npm run build
  Built 4 modules into dist/extension.js

node --check dist/extension.js
  aprovado, sem erros de sintaxe
```

A cobertura adicionada verifica:

- inexistência de chamada antes da invocação explícita de análise;
- JSON válido;
- JSON em bloco Markdown;
- erro da conexão;
- resposta inválida;
- persistência e edição manual do resultado;
- preservação do texto original;
- separação entre documento privado e projeção do tracker.

## Limitações e pendências

- A qualidade factual e a classificação público/privado ainda dependem do modelo e da revisão humana. A validação desta etapa garante forma e algumas fronteiras óbvias, não correção semântica completa.
- A extensão rejeita duplicação integral e idêntica do documento privado no tracker, mas não tenta detectar toda paráfrase ou vazamento parcial produzido pelo modelo.
- Aplicação das propostas ao cartão e ao lorebook não foi conectada nesta etapa. Isso ampliaria o escopo de integração; os dados ficam salvos e revisáveis para a etapa seguinte.
- Não há análise de histórico de chat, atualização por mensagem, migração, versionamento de análises ou recuperação transacional.
- O limite da rota pública usada para análise é de 50.000 caracteres de texto selecionado.
- Dados locais continuam restritos ao IndexedDB do perfil do navegador.

## Confirmação de isolamento do núcleo

A implementação está contida em `extensions/narrative-director`, além deste relatório na raiz. Não foram criados patches, hooks ou alterações no pipeline do Marinara, e nenhum arquivo dos três pacotes centrais foi modificado.
