# Narrative Director extension, architecture v2

Browser extension for extracting a story into atomic facts, reviewing public/private disclosure, compiling safe character cards and lorebook entries, and synchronizing per-chat project memory for two fixed custom-agent types.

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

The extension may explicitly activate or deactivate these existing types in a selected chat. It preserves every unrelated `activeAgentIds` entry and never deletes memory on deactivation.

## Important upstream limitation

Marinara exposes public per-agent, per-chat memory routes and the extension uses them for synchronization, backup and recovery:

- `GET /api/agents/memory/:agentType/:chatId`
- `PATCH /api/agents/memory/:agentType/:chatId`
- `DELETE /api/agents/memory/:agentType/:chatId` is supported but is never called automatically

The current generic custom-agent pipeline does not load this persisted memory into `AgentContext.memory`. It initializes generic agent context with an empty memory object and only loads persistent memory for the native Director Secret Plot path. Custom prompt macros resolve agent settings and normal chat macros, not memory keys.

Consequently, v2 can safely synchronize and recover projects server-side, but the two fixed custom agents cannot consume those memories during normal roleplay without upstream generic memory injection support. The extension displays this limitation and does not claim otherwise or work around it by changing the core.

## Structured import

1. Create a project and choose **Character focus** or **World / ensemble**.
2. Paste up to 50,000 characters and choose a connection.
3. Press **Analyze story**. No request happens automatically.
4. Review atomic facts in **Public**, **Private**, and **Uncertain** groups.
5. Resolve every uncertain fact before Apply.
6. Review the deterministic card and lorebook preview.
7. Confirm before creating resources.

Analysis uses `POST /api/agents/suite/rewrite`. Every instruction is below 4,000 characters and every `selectedText` is validated at 50,000 characters. Plain and fenced JSON are accepted. Invalid JSON receives at most one repair attempt using the same connection. Raw responses remain in session memory only and are cleared when the panel closes.

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

## Memory boundary

Director memory contains the complete private project, summary, characters, secrets, knowledge matrix, arcs, candidate beats, setup strategies, confirmed initial state, editorial instructions, and public resource IDs.

Tracker memory contains only project/schema IDs, secret IDs with layers, arc IDs with observable states, observable fact IDs, readiness signals, blockers, eligible beat IDs, confidence, and the seven `nd_*` field names. It excludes secret summaries, reveal conditions, private documents, private summaries, private goals, private setup strategies, and future private events.

IndexedDB stores local drafts and UI recovery. After explicit synchronization, Director memory is the server-side project copy for the selected chat. Export JSON remains the recommended backup and must be treated as sensitive.

## Existing chats

Initialization reads the active message content returned by `GET /api/chats/:id/messages`, preserves chronological order, and chunks below the rewrite route limit without silently dropping content. Partial state stays in memory. Cancellation or failure does not replace the last confirmed state. Confirmation synchronizes memories and never edits agent configuration or old messages.

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
- Synchronize two different chats and confirm their memories remain independent.
- Open a second browser profile, select the chat, and recover the project from Director memory.
- Confirm the tracker emits the exact `fields` array and never Context Injection.
- Test the modal at desktop width and below 620px.
