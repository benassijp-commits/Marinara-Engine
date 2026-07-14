# Narrative Curator v4

Browser extension for importing or extracting one structured story project, creating its public character/lorebook resources, and synchronizing one private Curator lorebook entry for one fixed pre-generation agent.

V4 is a clean format. It does not read, convert, merge, or migrate V2/V3 projects, tracker fields, Director entries, or Tracker entries. Its IndexedDB database and bundle kind are separate, so old local data remains untouched.

## Canonical story

Each project contains one `story` object with:

- `worldCard`: public world or scenario card;
- `characters`: public profiles plus private `curatorNotes`;
- `relationships`: character IDs with separate public and private summaries;
- `worldEntries`: public lorebook entries;
- `curatorGuide`: the private overall guide;
- `secrets`: important truths, knowledge holders, reveal conditions and status;
- `storylines`: broad adaptable directions.

`confirmedState` is optional. It is useful only when attaching the project to a story already in progress. New stories should use `null`.

## Existing Import JSON flow

The existing **Import JSON** button accepts:

1. a complete `marinara.narrative-curator-projects` bundle with `schemaVersion: 4`;
2. one isolated valid V4 `story` object, applied to the currently open project.

The bundle form is the most convenient external-AI format because it creates the local project directly. See `narrative-curator-v4-import-template.json` in this directory.

V2 and V3 bundles are rejected explicitly. There is no automatic migration.

After importing a bundle:

1. open the imported project;
2. select its Marinara chat;
3. optionally create the reviewed public character and lorebook resources;
4. import `presets/marinara-agents.json` once through Marinara's Agents panel;
5. configure a connection for `narrative-story-curator`;
6. press **Synchronize Curator lorebook**;
7. activate the Curator for the chat.

Before activating V4, deactivate the old V3 `narrative-story-director` and `narrative-story-tracker` agents for that chat.

## One fixed Curator

- type: `narrative-story-curator`;
- phase: `pre_generation`;
- technical Marinara result type: `director_event` (used only to inject its short instruction into the narrator);
- tool: `search_lorebook`;
- context: chat summary plus the ten most recent active messages;
- output: one short narrator instruction;
- no Tracker and no `custom_tracker_update` fields.

The private transport uses one non-activating entry named `__ND_CURATOR_PROJECT_V4__`. It is excluded from vectorization and must not be selected manually as a Knowledge Router source.

## Existing-chat initialization

Initialization remains optional. It makes one rewrite request with the private project, a chat summary when available, and the newest active messages that fit. The result is reviewable before being saved as `confirmedState` and synchronized into the private Curator entry.

## Build and validation

```bash
cd extensions/narrative-director
npm test
npm run build
npm run smoke
node --check dist/extension.js
```

The generated `dist/` directory is not committed.
