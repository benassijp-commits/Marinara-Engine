# Narrative Director extension, architecture v2

Browser extension for extracting a story into atomic facts, reviewing public/private disclosure, compiling safe character cards and lorebook entries, and synchronizing one guarded per-chat lorebook for two fixed custom-agent types.

The extension does not create, patch, or configure agents. It never modifies Marinara core files.

## Fixed agents

Import `presets/marinara-agents.json` through Marinara's **Agents** panel and choose connections there. The preset uses the official `marinara.agent-folder` version 1 import shape.

Director:

- type: `narrative-story-director`
- phase: `pre_generation`
- result: `director_event`
- output: one short editorial instruction, never narration or dialogue
- suggested temperature: `0.2`

Tracker:

- type: `narrative-story-tracker`
- phase: `post_processing`
- result: `custom_tracker_update`
- capability: `edit_trackers`
- output: exactly seven `nd_*` fields with JSON-string values
- suggested temperature: `0.1`

Both agents require a tool-capable connection and enable only `search_lorebook`. The extension may explicitly activate or deactivate these existing types in a selected chat. It preserves every unrelated `activeAgentIds` entry and never deletes the project lorebook on deactivation.

## One guarded lorebook for both agents

Each project/chat uses one agent-transport lorebook shared by both fixed agents. It is separate from the optional public lorebook produced by Apply, so public entries remain usable by normal lorebook and Knowledge Router behavior:

- `__ND_DIRECTOR_PROJECT_V2__`: complete compact private project, retrieved only by the Director;
- `__ND_TRACKER_PROJECT_V2__`: sanitized observable plan, retrieved only by the tracker.

The entries remain enabled because disabled entries are unavailable to `search_lorebook`, but their only activation key is the impossible regular expression `(?!)`. They are non-constant, excluded from vectorization, non-recursive and have no secondary keys, additional matching sources, activation conditions, schedule, sticky duration or cooldown. The normal keyword scanner therefore cannot activate them from roleplay text.

The transport lorebook is linked directly to the chat through its scope, but deliberately removed from `chat.metadata.activeLorebookIds`. Standard `search_lorebook` still discovers chat-linked entries, while Knowledge Router's default source selection uses active lorebook IDs and therefore does not catalog the transport book. Do not manually select the transport book as a Knowledge Router source.

This is an application-level guard, not an administrative secrecy boundary. A local administrator can read normal lorebook data, and agent diagnostics can display tool results containing private content. Keep agent debug disabled outside troubleshooting.

## Structured import

1. Create a project and choose **Character focus** or **World / ensemble**.
2. Paste up to 50,000 characters and choose a connection.
3. Press **Analyze story**. No request happens automatically.
4. Review compact narrative facts in **Public**, **Private**, and **Uncertain** groups.
5. Resolve every uncertain fact before Apply.
6. Review the deterministic card and lorebook preview.
7. Confirm before creating resources.

Analysis uses `POST /api/agents/suite/rewrite`. Every instruction is below 4,000 characters and every `selectedText` is validated at 50,000 characters. Sources up to 7,000 characters use one compact extraction. Larger sources are split chronologically at logical boundaries into blocks near 6,000 characters. Each call returns only a canonical fragment; the extension merges fragments deterministically without asking the model to regenerate the full project. Repeated entities are merged, references are remapped, character knowledge is unioned, and facts with the same subject, category, visibility and knowers are grouped.

Plain and fenced JSON are accepted. Structurally incomplete output is reported as truncated and never sent through whole-response repair. One repair attempt remains available only for a structurally complete object with a small syntax defect. Completed blocks and raw responses remain in session memory only. **Analyze story** retries the failed block, while closing or reloading clears the checkpoint. Partial analyses are never written to IndexedDB, exports or logs.

Creative enrichment is deliberately separate and disabled. Extraction works with a raw outline.

## Deterministic public compilation

The compiler uses only facts reviewed as public.

Character focus creates a native character card for the primary character. World / ensemble creates a narrator/world card. Selected secondary characters can become separate cards; unselected public characters, places, organizations, and rules can become lorebook entries.

Native character fields used by the proven Marinara schema include:

- `description`
- `personality`
- `scenario`
- `extensions.appearance`
- required empty/default V2 fields such as `first_mes`, `mes_example`, and `character_book`

The same subject is not automatically duplicated into both a separate card and lorebook. Private and unresolved facts are rejected from public compilation.

## Agent data boundary

The Director entry contains the complete private project, summary, characters, secrets, knowledge matrix, arcs, candidate beats, setup strategies, confirmed initial state, editorial instructions, and public resource IDs. The structured project is stored only once and serialized as compact JSON to avoid redundant tokens.

The tracker entry contains only project/schema IDs, secret IDs with layers, arc IDs with observable states, observable fact IDs, readiness signals, blockers, eligible beat IDs, confidence, and the seven `nd_*` field names. It excludes secret summaries, reveal conditions, private documents, private summaries, private goals, private setup strategies, and future private events.

IndexedDB stores local drafts and UI recovery. After explicit synchronization, the Director entry is the server-side project copy for the selected chat and can restore it in another browser using the same Marinara instance. Export JSON remains the recommended backup and must be treated as sensitive.

## Existing chats

Initialization reads the active message content returned by `GET /api/chats/:id/messages`, preserves chronological order, and chunks below the rewrite route limit without silently dropping content. Partial state stays only in session memory. Cancellation or failure does not replace the last confirmed state. Confirmation synchronizes the guarded entries and never edits agent configuration or old messages.

## Build and test

```bash
cd extensions/narrative-director
npm test
npm run build
node --check dist/extension.js
```

The distributable contains:

```text
dist/
  manifest.json
  extension.js
  extension.css
  presets/marinara-agents.json
```

## Manual verification

- Import the agent preset and choose two configured connections.
- Confirm both fixed agent statuses as created/inactive, then active in one chat.
- Analyze a mixed public/private outline and resolve uncertain facts.
- Create public resources and inspect native card fields and lorebook entries.
- Synchronize two different chats and confirm their lorebooks remain independent.
- Open a second browser profile, select the chat, and recover the project from the Director entry.
- Inspect the assembled main-model prompt and confirm neither technical entry was injected as normal lorebook context.
- Confirm the tracker emits the exact `fields` array and never Context Injection.
- Test the modal at desktop width and below 620px.
