import test from "node:test";
import assert from "node:assert/strict";

await import("../src/core.js");
const core = globalThis.__NarrativeDirectorCore;

function validStory(overrides = {}) {
  return core.createStory({
    id: "story-1",
    agentKey: "story-1",
    name: "Test story",
    characterId: "character-1",
    chatId: "chat-1",
    privateDocument: "PRIVATE_SECRET_ALPHA",
    progressionProjection: "stage_one then stage_two",
    director: { connectionId: "connection-director" },
    tracker: { connectionId: "connection-tracker" },
    ...overrides,
  });
}

test("creates a complete story with stable timestamps and agent types", () => {
  const story = validStory();
  assert.equal(story.name, "Test story");
  assert.equal(story.createdAt, story.updatedAt);
  assert.deepEqual(core.storyTypes(story), {
    director: "narrative-director-director-story-1",
    tracker: "narrative-director-tracker-story-1",
  });
});

test("validates required activation fields", () => {
  assert.deepEqual(core.validateStory(validStory()), { valid: true, errors: [] });
  const invalid = core.validateStory(core.createStory({ name: "Incomplete" }));
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.includes("Choose a Director connection."));
  assert.ok(invalid.errors.includes("Private Director document is empty."));
});

test("builds Director with private document only in Director settings", () => {
  const story = validStory();
  const payload = core.buildDirectorPayload(story);
  assert.equal(payload.phase, "pre_generation");
  assert.equal(payload.resultType, "director_event");
  assert.equal(payload.settings.narrative.privateDocument, "PRIVATE_SECRET_ALPHA");
});

test("prevents accidental private document inclusion in tracker payload", () => {
  const story = validStory();
  const payload = core.buildTrackerPayload(story);
  assert.equal(payload.phase, "post_processing");
  assert.equal(payload.resultType, "custom_tracker_update");
  assert.equal(JSON.stringify(payload).includes(story.privateDocument), false);

  const contaminated = validStory({ progressionProjection: "PRIVATE_SECRET_ALPHA" });
  assert.throws(() => core.buildTrackerPayload(contaminated), /must never be included/);
});

test("activation preserves existing agent types and avoids duplicates", () => {
  const types = core.storyTypes(validStory());
  const result = core.activateTypes(["director", "other-extension-agent", types.director], types);
  assert.deepEqual(result, ["director", "other-extension-agent", types.director, types.tracker]);
});

test("deactivation removes only extension-owned types for this story", () => {
  const types = core.storyTypes(validStory());
  const result = core.deactivateTypes(["director", types.director, "other-extension-agent", types.tracker], types);
  assert.deepEqual(result, ["director", "other-extension-agent"]);
});

test("exports and imports a versioned JSON bundle", () => {
  const bundle = core.exportBundle([validStory()]);
  const imported = core.importBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(imported.length, 1);
  assert.equal(imported[0].privateDocument, "PRIVATE_SECRET_ALPHA");
  assert.throws(() => core.importBundle({ kind: "wrong", schemaVersion: 1, stories: [] }), /not a Narrative/);
});

const validAnalysis = {
  suggestedStoryName: "The Brass Key",
  storySummary: "A traveler discovers a key linked to a hidden inheritance.",
  characterInformation: "Mara is observant, guarded and newly arrived in the city.",
  cardAdditions: "Mara notices small physical details before social cues.",
  lorebookEntries: [
    { name: "Old Quarter", description: "Historic district", content: "The oldest district in the city.", keys: ["quarter"] },
  ],
  privateDirectorDocument: "The key belongs to Mara's missing sibling and opens a future sealed archive.",
  trackerProjection: "stage_arrival; reveal_key_seen when the brass key is visibly discovered",
};

test("parses a valid structured analysis", () => {
  assert.deepEqual(core.parseAnalysisResponse(JSON.stringify(validAnalysis)), validAnalysis);
});

test("extracts structured analysis from a Markdown JSON fence", () => {
  const parsed = core.parseAnalysisResponse(`Here is the result:\n\`\`\`json\n${JSON.stringify(validAnalysis)}\n\`\`\``);
  assert.equal(parsed.storySummary, validAnalysis.storySummary);
  assert.equal(parsed.privateDirectorDocument, validAnalysis.privateDirectorDocument);
});

test("reports invalid JSON and invalid response shapes", () => {
  assert.throws(() => core.parseAnalysisResponse("not json"), /did not contain a JSON object/);
  assert.throws(
    () => core.parseAnalysisResponse(JSON.stringify({ storySummary: "Only one field" })),
    /invalid structure/,
  );
});

test("applies analysis while keeping private Director and tracker projection separate", () => {
  const original = validStory({ sourceText: "ORIGINAL SOURCE" });
  const analyzed = core.applyAnalysis(original, validAnalysis, "2030-01-01T00:00:00.000Z");
  assert.equal(analyzed.sourceText, "ORIGINAL SOURCE");
  assert.equal(analyzed.storySummary, validAnalysis.storySummary);
  assert.equal(analyzed.characterInformation, validAnalysis.characterInformation);
  assert.equal(analyzed.privateDocument, validAnalysis.privateDirectorDocument);
  assert.equal(analyzed.progressionProjection, validAnalysis.trackerProjection);
  assert.notEqual(analyzed.privateDocument, analyzed.progressionProjection);
  assert.equal(JSON.parse(analyzed.lorebookEntries)[0].name, "Old Quarter");
});

test("builds a selected public preview without the private Director document", () => {
  const story = validStory({
    storySummary: "Public summary",
    characterInformation: "Public character details",
    cardAdditions: "Public permanent fact",
    lorebookEntries: JSON.stringify([
      { name: "Included", description: "One", content: "Public lore one", keys: ["one"] },
      { name: "Excluded", description: "Two", content: "Public lore two", keys: ["two"] },
    ]),
    applicationCharacterName: "Mara",
    applicationLorebookName: "Mara's World",
    applicationCardSections: ["characterInformation", "cardAdditions"],
    applicationLorebookSelection: [0],
  });
  const preview = core.buildPublicResourcePreview(story);
  assert.equal(preview.character.data.name, "Mara");
  assert.match(preview.character.data.description, /Public character details/);
  assert.doesNotMatch(preview.character.data.description, /Public summary/);
  assert.deepEqual(preview.lorebookEntries.map((entry) => entry.name), ["Included"]);
  assert.equal(JSON.stringify(preview).includes(story.privateDocument), false);
});

test("rejects private Director content in public resources and sanitizes diagnostics", () => {
  const contaminated = validStory({
    cardAdditions: "PRIVATE_SECRET_ALPHA",
    lorebookEntries: "[]",
    applicationCardSections: ["cardAdditions"],
    applicationLorebookSelection: [],
  });
  assert.throws(() => core.buildPublicResourcePreview(contaminated), /cannot be included/);
  const log = core.applicationLogEntry({
    operation: "create_character",
    status: "error",
    stage: "character",
    error: new Error("Provider echoed PRIVATE_SECRET_ALPHA"),
    privateDocument: "PRIVATE_SECRET_ALPHA",
    now: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(JSON.stringify(log).includes("PRIVATE_SECRET_ALPHA"), false);
  assert.match(log.error, /private content removed/);
});

test("repeated application skips completed resources and retries only failed entries", () => {
  const partial = validStory({
    createdCharacterId: "character-created",
    createdLorebookId: "lorebook-created",
    createdLorebookEntryIds: { 0: "entry-zero", 2: "entry-two" },
    characterAssociatedChatId: "chat-1",
    lorebookAssociatedChatId: "chat-1",
  });
  assert.deepEqual(core.pendingPublicOperations(partial, [0, 1, 2]), {
    character: false,
    lorebook: false,
    entryIndexes: [1],
    characterAssociation: false,
    lorebookAssociation: false,
  });
  const complete = core.createStory({ ...partial, createdLorebookEntryIds: { 0: "entry-zero", 1: "entry-one", 2: "entry-two" } });
  assert.deepEqual(core.pendingPublicOperations(complete, [0, 1, 2]).entryIndexes, []);
});

test("public writes require an explicit reviewed-preview confirmation", () => {
  assert.throws(() => core.requireApplicationConfirmation(false), /Confirm that you reviewed/);
  assert.equal(core.requireApplicationConfirmation(true), true);
});

const validInitialState = {
  happenedSummary: "Mara arrived and found the brass key.",
  currentPoint: "Mara is deciding whether to enter the archive.",
  occurredEvents: ["arrival", "key_found"],
  pendingEvents: ["archive_opens"],
  revealedSecrets: ["The key bears Mara's family crest."],
  blockedSecrets: [{ id: "sibling_archive", label: "Sibling archive secret remains locked" }],
  characterStates: [{ name: "Mara", state: "Alert, holding the key, trusts Ivo cautiously." }],
  trackerProgression: { currentStage: "archive_threshold", revealedEvents: ["key_found"] },
};

test("parses and validates a reviewable existing-chat state", () => {
  const parsed = core.parseInitializationResponse(`\`\`\`json\n${JSON.stringify(validInitialState)}\n\`\`\``);
  assert.deepEqual(parsed, validInitialState);
  assert.throws(
    () => core.parseInitializationResponse(JSON.stringify({ ...validInitialState, currentPoint: "" })),
    /invalid structure/,
  );
});

test("builds read-only active-swipe input without mutating past messages", () => {
  const messages = [
    { id: "message-1", role: "user", content: "Open the door", activeSwipeIndex: 0 },
    { id: "message-2", role: "assistant", content: "The active swipe response", activeSwipeIndex: 2, swipeCount: 3 },
  ];
  const before = structuredClone(messages);
  const prepared = core.buildInitializationInput(validStory(), messages);
  const decoded = JSON.parse(prepared.input);
  assert.equal(prepared.messageCount, 2);
  assert.equal(decoded.activeChatMessages[1].content, "The active swipe response");
  assert.equal(decoded.activeChatMessages[1].activeSwipeIndex, 2);
  assert.deepEqual(messages, before);
});

test("Director receives confirmed state while tracker receives only the filtered projection", () => {
  const story = validStory({ confirmedInitialState: validInitialState });
  const director = core.buildDirectorPayload(story);
  const tracker = core.buildTrackerPayload(story);
  assert.deepEqual(director.settings.narrative.currentState, validInitialState);
  assert.match(director.promptTemplate, /narrative\.currentState/);
  assert.equal(JSON.stringify(tracker).includes(story.privateDocument), false);
  assert.equal(JSON.stringify(tracker).includes("archive_opens"), false);
  assert.equal(JSON.stringify(tracker).includes("Sibling archive secret remains locked"), false);
  assert.deepEqual(tracker.settings.narrative.initialState.blockedSecretIds, ["sibling_archive"]);
  assert.match(tracker.promptTemplate, /narrative\.initialState/);
});

test("existing-chat diagnostics contain counts and update flags, never chat content", () => {
  const entry = core.applicationLogEntry({
    operation: "confirm_existing_chat_state",
    status: "success",
    stage: "agents_updated",
    chatId: "chat-1",
    messageCount: 42,
    directorUpdated: true,
    trackerUpdated: true,
  });
  assert.equal(entry.chatId, "chat-1");
  assert.equal(entry.messageCount, 42);
  assert.equal(entry.directorUpdated, true);
  assert.equal(entry.trackerUpdated, true);
  assert.equal(JSON.stringify(entry).includes("The active swipe response"), false);
});
