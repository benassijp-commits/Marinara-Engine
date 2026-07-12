# Narrative Director extension

Browser-only Marinara Engine extension for managing private narrative plans with custom pre-generation Director and post-processing tracker agents.

It can analyze a pasted story, strictly separate initial public knowledge from private truth, edit adaptive private structures, create reviewed public resources, and initialize Director/tracker state from an existing chat through explicit, separate actions. It never edits past messages or existing cards.

## Build

Requirements: Node.js 24+ and npm. No package installation is required.

```bash
cd extensions/narrative-director
npm run build
```

The distributable folder is `dist/`:

```text
dist/
  manifest.json
  extension.js
  extension.css
```

## Install

1. Build the extension.
2. Open Marinara Engine.
3. Go to **Settings → Addons → Extension Library**.
4. Choose **Import Extension Folder**.
5. Select the `extensions/narrative-director/dist` folder. Your browser may show the files rather than the folder itself; select the folder using the directory picker.
6. Review the imported extension and enable **Narrative Director**.
7. A **Narrative Director** button appears near the lower-right edge of the app.

The manifest defaults to disabled so the user explicitly reviews and enables its JavaScript.

## Use

1. Open **Narrative Director**.
2. Create a story and paste the original text in the Story tab.
3. Select an analysis connection and press **Analyze story**. No request is made until this button is pressed.
4. Review and edit the public premise, private complete summary, initially safe character/card fields, lorebook entries, private Director document, characters, secrets, adaptive arcs and candidate beats.
5. Select a chat, open **Apply**, choose the public card sections and lorebook entries, and review the previews.
6. Check the confirmation box and press **Create or retry public resources**. Successful resource IDs are saved immediately; retry skips completed work.
7. Select a connection used only by the Director. Select a different connection for the tracker.
8. Save the story locally.
9. Open **Activation** and choose **Create agents and activate**.

For a story already in progress:

1. Select the story, existing chat and an initialization connection.
2. Open **Initialize** and press **Initialize from existing chat**. No history is read before this action.
3. Review the unsaved proposal: confirmed history, current point, occurred/pending events, revealed/blocked secrets and character states.
4. Choose **Cancel proposal** to discard it without saving, or **Confirm state and update agents** to persist it and upsert the existing agent types.

Confirmation does not activate agents and does not patch chat metadata. Activation remains a separate action in the Activation tab.

Analysis uses Marinara's public `POST /api/agents/suite/rewrite` route. The model is instructed to return JSON in the source text's predominant language; plain JSON and JSON inside a Markdown code fence are accepted. The contract ends with `narrativeArcs` and `candidateBeats`; observable tracker configuration is derived locally from secrets, arcs and beats. A valid result is saved to IndexedDB and remains editable. Connection and parsing failures leave the original pasted text and current draft intact. Re-analysis is always manual.

Public means only knowledge available to the user and present characters at the initial story point. The complete summary is Director-only and is never used for card or lorebook construction. Empty public card fields and an empty lorebook are valid when the source provides no safe initial knowledge.

The latest raw analysis response is available in the collapsible **Raw AI response** section after success or parsing failure. It can contain the entire story and private data, exists only in memory, and is cleared when the panel closes or the extension reloads. It is never persisted, exported or added to diagnostics.

Public application uses the character, lorebook, lorebook-entry, chat and chat-metadata APIs. The new character is added to the selected chat without removing existing participants. The new lorebook is scoped to and pinned in that chat. Creating or updating Director and tracker agents remains a separate explicit action.

Existing-chat initialization reads `GET /api/chats/:id/messages`. Marinara returns the content of the active swipe in each message, so the extension does not fetch, select or manage alternate swipes. The private plan and active history are sent only to the selected initialization connection through `POST /api/agents/suite/rewrite`.

Activation creates or updates two custom agents and adds their `type` values to `chat.metadata.activeAgentIds`. Existing agent types are preserved. Deactivation removes only the two types owned by that story.

Only one Narrative Director story may be active in a chat at a time in this MVP.

## Private-data boundary

- The complete private document is stored only in `settings.narrative.privateDocument` of the Director agent.
- Structured private characters, secrets, reveal conditions, adaptive arcs and candidate beats are stored only in the Director configuration.
- Tracker settings are derived from secret IDs/statuses, observable arc state, beat prerequisites, readiness signals and blockers. Private setup strategies are excluded.
- The build rejects a tracker payload if it contains the complete private document.
- The build also rejects blocked-secret summaries/conditions, private character goals and beat setup strategies in tracker configuration.
- Private settings are protected from the main narrator prompt, but remain readable by the local Marinara administrator and Agents UI/API.
- Agent debug logs can expose the private Director prompt. Keep agent debug disabled when using secrets.
- Pre-generation agents sharing a connection/model can be batched. Give the Director an exclusive connection that no other pre-generation agent uses.

Do not put secrets in proposed card additions, proposed lorebook entries, chat metadata or tracker fields.

## Import and export

**Export JSON** downloads all locally saved extension stories, including private documents. Treat the file as sensitive.

**Import JSON** merges stories by ID. Imports accept only the versioned `marinara.narrative-director-stories` format produced by this extension.

## Test

```bash
cd extensions/narrative-director
npm test
npm run build
node --check dist/extension.js
```

The tests cover:

- IndexedDB create, read, edit, replace and delete;
- story construction and validation;
- Director/tracker payloads;
- prevention of complete private-document duplication into tracker settings;
- activation and deactivation;
- preservation of existing `activeAgentIds`;
- versioned JSON import/export.
- explicit-only AI analysis calls;
- plain and Markdown-fenced JSON parsing;
- connection and invalid-response errors;
- persistence and manual editing of analyzed proposals;
- derivation of observable tracker input without redundant legacy structures.
- public-resource previews and explicit confirmation;
- character, lorebook and entry creation payloads;
- persistence of returned resource IDs;
- duplicate-click prevention and failed-part retry planning;
- sanitized diagnostics without private documents.
- manual, read-only existing-chat initialization;
- structured state review and cancellation before persistence;
- filtered adaptive tracker state and complete confirmed Director state;
- agent upsert without duplication or automatic activation;
- message-count and agent-update diagnostics without message content.

## Known limitations

- Storage is browser-local IndexedDB and does not sync between devices or browser profiles.
- Deactivation leaves the extension-managed agent configs installed for later reactivation. It does not delete agents.
- Deleting a local story is blocked while it is active, but its inactive agent configs may remain in Marinara.
- Current tracker state displays every `playerStats.customTrackerFields` entry in the selected chat, including fields from other trackers.
- The extension cannot reliably detect the currently open chat through the official extension API, so selection is manual.
- `director_event` is text output; the extension cannot semantically guarantee that a model-generated instruction never reveals a secret.
- Manual regeneration reuses cached pre-generation injections according to Marinara's existing pipeline behavior.
- The analysis route accepts source text up to 50,000 characters and its instruction up to Marinara's 4,000-character route limit.
- Generated content still requires human review; structural validation cannot establish factual quality or reliably detect every possible secret leaked by a model into a non-private proposal.
- The extension creates new cards only. It never edits or appends to an existing character card.
- A lost network response after the server has committed a create request cannot be made perfectly idempotent because the public create APIs do not expose idempotency keys. Once an ID is received, all repeated clicks are safely skipped.
- Adding a character to an existing chat uses Marinara's normal chat update behavior, which may add a visible system message that the character joined.
- Existing-chat initialization divides long active histories into chronological blocks below the public rewrite route's 50,000-character limit. A private plan that alone exceeds the available envelope is rejected without truncation.
- Initialization uses the message `content` currently returned by Marinara and records `activeSwipeIndex` for analysis context. It never calls swipe mutation APIs.
- Confirming state updates agent configurations but does not write a game-state snapshot. The tracker uses the confirmed initial state on its next normal post-processing run.
