# Narrative Director — correção ND-007

## Status

**ND-007 corrigido, aguardando validação.** Nenhuma funcionalidade além desta correção foi iniciada.

## Causa confirmada antes da edição

As medições iniciais foram executadas diretamente sobre os valores exportados por `core.js`:

| Instrução | Tamanho inicial | Limite público |
|---|---:|---:|
| `ANALYSIS_PROMPT` | 4.670 caracteres | 4.000 |
| `INITIALIZATION_PROMPT` | 1.426 caracteres | 4.000 |

O `ANALYSIS_PROMPT` excedia o contrato de `/api/agents/suite/rewrite` em 670 caracteres. Isso explica o retorno `Validation Error` antes de existir uma resposta do modelo ou conteúdo para `Raw AI response`.

A história testada, com cerca de 10 mil caracteres, estava abaixo do limite de 50.000 para `selectedText`; portanto, não era a causa.

## Instruções do chunking

Não existem instruções de modelo geradas dinamicamente no chunking. Foram encontradas estas chamadas:

- inicialização normal: `instruction: INITIALIZATION_PROMPT`, 1.426 caracteres;
- cada bloco cronológico: `instruction: INITIALIZATION_PROMPT`, os mesmos 1.426 caracteres;
- análise de história: `instruction: ANALYSIS_PROMPT`.

O texto dinâmico `Private story plan and active chat history block X of Y` pertence a `dataLabel`, não a `instruction`.

## Correção

`ANALYSIS_PROMPT` foi compactado de 4.670 para **3.297 caracteres**, abaixo da meta de segurança de 3.800.

Foram removidas explicações repetidas e descrições longas. Permaneceram explícitos:

- idioma predominante do texto fonte;
- retorno JSON e formato integral;
- separação público/privado;
- `publicPremise`, cartão e lorebook seguros;
- documento privado do Director;
- personagens privados e relações de conhecimento;
- cinco camadas de revelação;
- arcos adaptativos;
- beats, pré-requisitos, readiness, blockers e estratégias;
- proteção da agência de `{{user}}`;
- regra conservadora de `abandoned`;
- tracker restrito a sinais observáveis;
- `trackerProjection` obrigatoriamente string.

## Validação local

Todas as chamadas da extensão para `/agents/suite/rewrite` passam agora por uma única barreira local:

- `instruction.length` deve ser no máximo 4.000;
- `selectedText.length` deve ser no máximo 50.000.

Uma análise com instrução excessiva falha antes de qualquer request com:

```text
Analysis instruction exceeds the Marinara 4,000-character limit
```

Inicializações usam mensagens equivalentes identificando `Initialization`.

## Detalhes de validação da API

Quando a API retorna `field`, `param` ou `path`, inclusive dentro de `details`, a extensão acrescenta somente esse identificador sanitizado à mensagem. Exemplo:

```text
Validation Error: instruction
```

Mensagens descritivas dos detalhes não são copiadas. Assim, valores de `selectedText`, prompts ou conteúdo privado eventualmente ecoados pelo servidor não chegam à interface.

## Arquivos alterados nesta correção

- `extensions/narrative-director/src/core.js`
  - compactação de `ANALYSIS_PROMPT`.
- `extensions/narrative-director/src/api.js`
  - validação centralizada de limites antes do request;
  - identificação sanitizada do campo que falhou.
- `extensions/narrative-director/tests/core.test.mjs`
  - limites de todas as instruções e meta de 3.800 para análise.
- `extensions/narrative-director/tests/api.test.mjs`
  - análise curta chegando à API;
  - bloqueio local específico;
  - campo de validação sem conteúdo privado.
- `NARRATIVE_DIRECTOR_STEP_7_5.md`
  - este relatório.

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

Os testes anteriores das estruturas e fluxos 7.1–7.4 continuam aprovados.

## Isolamento do núcleo

Nenhum arquivo em `packages/client`, `packages/server` ou `packages/shared` foi modificado.
