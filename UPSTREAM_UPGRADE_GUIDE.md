# Guia de upgrade com upstream — Marinara Engine

Documento produzido por inspeção estática do repositório em 22 de julho de 2026, sem alterar nada no working tree. Ver também [`CHARACTER_TRACKER_AVATAR_MUDANCAS_E_PENDENCIAS.md`](../CHARACTER_TRACKER_AVATAR_MUDANCAS_E_PENDENCIAS.md) para o histórico funcional das mudanças de avatar/tracker descritas aqui.

## 1. Estado atual da árvore

- branch atual: `narrative-director-full-review`;
- `origin` = `benassijp-commits/Marinara-Engine` (seu fork);
- `upstream` = `Pasta-Devs/Marinara-Engine` (projeto oficial);
- merge-base com `upstream/main`: `77f9f2a6`, que é **exatamente** o HEAD atual de `upstream/main`. Ou seja, hoje **você está 0 commits atrás do upstream** — a última sincronização (`afe0bec3`, "Merge remote-tracking branch 'upstream/main'") trouxe tudo que existia até `#3667`;
- acima desse merge-base, sua branch tem **16 commits próprios**, todos relacionados à extensão Curator e ao Character Tracker/avatares;
- a extensão inteira (`extensions/narrative-director`) **não existe no upstream**. É uma pasta 100% nova, sem overlap — commitada, sem diferenças pendentes no working tree.

**Achado importante:** seu working tree tem alterações **não commitadas** agora mesmo:

```
modificados (17 arquivos, já existentes no upstream):
  packages/client/src/features/tracker-panel/components/TrackerDataSidebar.tsx
  packages/client/src/features/tracker-panel/components/TrackerSectionList.tsx
  packages/client/src/features/tracker-panel/components/TrackerSidebarHeader.tsx
  packages/client/src/features/tracker-panel/components/character-card/AvatarRemoveButton.tsx
  packages/client/src/features/tracker-panel/hooks/use-tracker-mutations.ts
  packages/client/src/hooks/use-game-state-patcher.ts
  packages/server/src/routes/avatars.routes.ts
  packages/server/src/routes/chats.routes.ts
  packages/server/src/routes/generate.routes.ts
  packages/server/src/routes/generate/generate-route-utils.ts
  packages/server/src/services/game/npc-avatar-utils.ts
  packages/server/src/services/image/character-tracker-avatar-prompt.ts
  packages/server/src/services/storage/agents.storage.ts
  packages/server/src/services/storage/game-state.storage.ts
  packages/shared/src/index.ts
  packages/shared/src/types/game-state.ts
  scripts/regressions/prompt.regression.ts

novos (6 itens, sem equivalente no upstream):
  docs/DATA_BASE_AVATARS/
  packages/client/public/avatar-body-settings.html
  packages/client/public/avatar-body-settings.js
  packages/client/src/features/tracker-panel/components/character-card/AvatarBodyControlModal.tsx
  packages/server/src/services/image/avatar-body-control.ts
  packages/shared/src/utils/avatar-body-controls.ts
```

Isso é exatamente o trabalho de grade corporal/avatar descrito no outro documento. Ele **não está protegido por nenhum commit**. Qualquer `git checkout`, `git reset`, troca de branch descuidada ou até um `git pull` mal executado pode apagá-lo. Isso é independente de upgrade — é um risco imediato.

> **Recomendação antes de qualquer outra coisa:** commitar este trabalho (ou pelo menos um `git stash push -u` nomeado) antes de seguir. Não fiz isso automaticamente porque criar commits é uma ação que só devo tomar quando você pedir explicitamente — mas é o primeiro passo prático de "preparar para não perder trabalho".

## 2. Mapa de risco para futuros `pull`/merge do upstream

Risco de conflito não é sobre hoje (você está em dia), é sobre a **próxima vez** que trouxer `upstream/main`. Ele é proporcional a quanto o upstream historicamente mexe em cada arquivo que você também mudou. Medi commits do upstream nos últimos 60 dias por arquivo:

| Arquivo | Commits upstream (60d) | Risco |
|---|---:|---|
| `packages/server/src/routes/generate.routes.ts` | 241 | 🔴 Muito alto |
| `packages/server/src/routes/chats.routes.ts` | 87 | 🔴 Alto |
| `scripts/regressions/prompt.regression.ts` | 77 | 🔴 Alto |
| `packages/server/src/routes/generate/generate-route-utils.ts` | 49 | 🟠 Alto |
| `packages/shared/src/index.ts` | 45 | 🟠 Médio-alto (arquivo de barril; conflitos costumam ser triviais — linhas de export adjacentes) |
| `packages/server/src/services/storage/game-state.storage.ts` | 14 | 🟡 Médio |
| `packages/client/.../TrackerDataSidebar.tsx` | 12 | 🟡 Médio |
| `packages/server/src/services/storage/agents.storage.ts` | 10 | 🟡 Médio |
| `use-game-state-patcher.ts` | 6 | 🟢 Baixo |
| `use-tracker-mutations.ts` | 6 | 🟢 Baixo |
| `TrackerSectionList.tsx` | 6 | 🟢 Baixo |
| `packages/shared/src/types/game-state.ts` | 5 | 🟢 Baixo |
| `TrackerSidebarHeader.tsx` | 4 | 🟢 Baixo |
| `character-tracker-avatar-prompt.ts` | 0 | 🟢 Mínimo (mas seu diff aqui é grande: +189/-linhas) |
| `npc-avatar-utils.ts` | 0 | 🟢 Mínimo |
| `avatars.routes.ts` | 0 | 🟢 Mínimo hoje, mas **maior diff de todos** (+546 linhas) — se o upstream começar a mexer nesse arquivo, o conflito será o mais trabalhoso de resolver por volume, não por frequência |
| `AvatarRemoveButton.tsx` | 0 | 🟢 Mínimo |

Os 6 arquivos novos (untracked) e a extensão `narrative-director` têm **risco zero de conflito de merge** — não existem no upstream, então um merge nunca vai tocar neles a menos que o upstream crie, por coincidência, um arquivo com o mesmo caminho.

**Pontos de maior atenção real:** `generate.routes.ts` e `chats.routes.ts` mudam constantemente no upstream (são o coração do pipeline de geração/chat) e você tem diffs não triviais neles (+120 e +63 linhas). São os dois arquivos onde um merge futuro tem mais chance de exigir resolução manual cuidadosa, não só mecânica.

## 3. Por que isso não é urgente hoje

`upstream/main` segue a política descrita em `CONTRIBUTING.md`: desenvolvimento ativo acontece em `staging`, e `main` recebe releases consolidadas. Como você já está sincronizado com `main` (v2.3.1 nos dois lados), não há nada pendente para trazer agora. Este documento existe para quando isso deixar de ser verdade.

## 4. Procedimento recomendado para o próximo upgrade

### 4.1 Antes de tocar em qualquer coisa

```bash
cd /home/scion/Marinara-Engine
git status                      # confirmar que não há trabalho solto (ver seção 1)
git add -A && git commit -m "..."   # ou stash, mas commit é mais seguro para um diff deste tamanho
git tag backup/pre-update-vX.Y.Z-$(date +%Y%m%d)   # snapshot recuperável, mesma convenção da branch backup/pre-update-v2.1.1-20260716 já existente
```

### 4.2 Trazer o upstream

Prefira **merge**, não rebase. Motivo: você tem 16 commits próprios já publicados em `origin/narrative-director-full-review` (570 commits à frente do que está lá agora, incluindo os antigos); um rebase reescreveria histórico já compartilhado e é desnecessariamente arriscado para um volume de mudança deste tamanho. O último upgrade que você já fez (`afe0bec3`) também foi um merge — mantenha o padrão.

```bash
git fetch upstream
git merge upstream/main
```

### 4.3 Se houver conflito

Resolva primeiro os arquivos de risco 🔴/🟠 da tabela acima com calma — eles concentram a maior parte da chance de conflito real de lógica, não só de formatação. Para os 🟢, normalmente basta `git mergetool` ou aceitar automaticamente o merge se não houver marcadores de conflito.

Depois de resolver:

```bash
pnpm install          # em caso de mudança em dependências
pnpm check             # baseline de validação do projeto (TypeScript + ESLint)
pnpm db:push           # se algo em game-state.storage.ts/agents.storage.ts mudou o schema
```

### 4.4 Validação funcional dirigida

Roteiro mínimo tocando exatamente as áreas customizadas, já que `pnpm check` não pega regressão de comportamento:

1. gerar um avatar de NPC pelo Character Tracker (fluxo automático e manual) e conferir a grade corporal (`avatar-body-controls.ts`, `avatar-body-control.ts`);
2. abrir `avatar-body-settings.html`/`.js` e confirmar que o modal (`AvatarBodyControlModal.tsx`) ainda renderiza;
3. remover um avatar de tracker (`AvatarRemoveButton.tsx`, rota em `avatars.routes.ts`) e confirmar que a limpeza funciona;
4. rodar uma geração normal de chat/mensagem para garantir que `generate.routes.ts`/`chats.routes.ts` não regrediram nada fora do seu escopo;
5. rodar `pnpm run` do que existir em `scripts/regressions/prompt.regression.ts` se ele tiver um comando de execução próprio, já que esse arquivo é o segundo mais mexido pelo upstream (77 commits/60d) e o seu diff nele é o maior de todos em linhas (+742).

### 4.5 Depois de validar

```bash
git branch backup/pre-update-vX.Y.Z-$(date +%Y%m%d)  # se preferir branch a tag
git push origin narrative-director-full-review
```

## 5. Redução estrutural de risco (opcional, não feito nesta rodada)

Não alterei código nesta análise — isto é uma recomendação para decisão futura seguinte, não uma ação já tomada.

- `avatars.routes.ts` concentra +546 linhas de lógica nova dentro de um arquivo de rotas do upstream que hoje tem baixo churn mas é estruturalmente compartilhado. Extrair a lógica de body-control/avatar para um módulo próprio (ex.: `packages/server/src/services/image/avatar-body-control.ts`, que já existe) e deixar em `avatars.routes.ts` apenas o registro de rota reduziria a superfície de conflito para poucas linhas, mesmo que o upstream comece a mexer nesse arquivo.
- O mesmo vale, em menor grau, para `generate.routes.ts` e `chats.routes.ts`: quanto mais a customização for uma chamada a uma função importada de um arquivo próprio, e menos for lógica inline misturada com o código original, mais barato fica resolver conflitos linha a linha.
- Manter este documento atualizado toda vez que a superfície de arquivos modificados mudar (novo arquivo tocado, arquivo customizado deixa de ser tocado) é mais barato do que redescobrir isso na hora do próximo merge.

## 6. Resumo executivo

Você não está atrasado em relação ao upstream agora. O risco real é: (a) trabalho não commitado que pode ser perdido por acidente, independente de upgrade — resolver isso primeiro; e (b) dois arquivos (`generate.routes.ts`, `chats.routes.ts`) que concentram a maior parte do churn upstream e da complexidade da sua customização, que merecem atenção manual dedicada no próximo merge, não um `git merge -X ours`/`theirs` automático.
