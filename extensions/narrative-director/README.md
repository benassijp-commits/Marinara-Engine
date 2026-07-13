# Narrative Director v3

Browser extension for turning a story plan into a small editable project with structurally separate public resources, a private Director guide, important secrets, broad storylines, and concise per-chat state.

The extension uses only Marinara's public extension and API surfaces. It does not modify Marinara core files, create agents, or call providers directly.

## Canonical project

Each project has one `story` object:

- `worldCard`: public world or scenario card;
- `characters`: one entity per person, with aliases, a public profile, and character-specific Director notes;
- `worldEntries`: public lorebook entries ready for use;
- `directorGuide`: one readable private guide;
- `secrets`: only important truths whose revelation needs tracking;
- `storylines`: broad adaptable directions.

Per-chat confirmed state contains only an accumulated summary, current situation, revealed secret IDs, storyline statuses, and short character states.

## Analyze a story

1. Create a project in **Source**.
2. Choose Character focus or World / ensemble, a chat, and an analysis connection.
3. Paste up to 50,000 characters.
4. Optionally edit **Regras de análise**, then press **Salvar**. The fixed JSON structure cannot be edited.
5. Press **Analyze story**.
6. Review and edit the result in **Public** and **Private**.

Analysis makes one `POST /api/agents/suite/rewrite` request. The complete source is sent as `selectedText`; saved user rules are sent separately in `contextSections`. There is no automatic repair, retry, chunking, or second model call. Invalid or truncated output leaves the previous project unchanged and remains visible under **Raw AI response** for the current session.

The default analysis rules are local settings in IndexedDB. Editing them does not require rebuilding the extension.

## Public resources

Public compilation reads only:

- `worldCard`;
- `characters[].public`;
- `characters[].aliases`;
- `worldEntries`.

Character focus creates the selected primary character card. World / ensemble creates the world card. Selected secondary characters become separate cards; other characters with public profiles become lorebook entries. World entries always remain public lorebook entries.

Private notes, the Director guide, secrets, and storylines are never read by the public compiler.

## External JSON import

**Import JSON** accepts exactly two shapes:

1. a complete `marinara.narrative-director-projects` bundle;
2. one isolated valid v3 `story` object.

An isolated story is applied to the currently open project while preserving its project ID, chat, connections, source text, and operational resource IDs. Review and save the draft afterward.

New exports use bundle schema version 3. Imported v2 bundles and local v2 projects receive a limited deterministic migration and are marked for review. Fragmented facts and obsolete tracking structures are discarded instead of being carried into v3.

## Fixed agents

Import `presets/marinara-agents.json` through Marinara's **Agents** panel, then configure a connection for each agent.

Director:

- type: `narrative-story-director`;
- phase: `pre_generation`;
- result: `director_event`;
- tool: `search_lorebook`;
- output: one short editorial instruction.

Tracker:

- type: `narrative-story-tracker`;
- phase: `post_processing`;
- result: `custom_tracker_update`;
- capability: `edit_trackers`;
- fields: `nd_summary`, `nd_current_situation`, `nd_revealed_secrets`, `nd_storylines`, `nd_character_states`.

The Director must not decide actions, dialogue, thoughts, feelings, decisions, or consent for `{{user}}`. The Tracker observes events and never directs the story.

## Guarded transport lorebook

Each chat uses one technical lorebook with two non-activating entries:

- `__ND_DIRECTOR_PROJECT_V3__`: private guide, character notes, secrets, storylines, editorial instructions, and confirmed state;
- `__ND_TRACKER_PROJECT_V3__`: secret IDs/titles/reveal conditions, storyline IDs/titles, character IDs/names, and current state.

Both use the impossible activation regex `(?!)`, are excluded from vectorization, and remain outside normal active lorebooks. Do not manually select the transport book as a Knowledge Router source.

This is an application-level privacy boundary, not protection from a local administrator or agent debug logs.

## Existing chats

Initialization makes one rewrite request. It includes the private project, a chat summary when available, and the newest active messages that fit under the request limit. Selected messages remain chronological. The interface reports when older messages were omitted. Confirmation is required before state is saved and the transport lorebook is synchronized.

## Build and validation

```bash
cd extensions/narrative-director
npm test
npm run build
npm run smoke
node --check dist/extension.js
```

The generated `dist/` directory is not committed.
