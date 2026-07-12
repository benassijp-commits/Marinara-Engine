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

  assert.deepEqual(payload.settings.narrative.adaptiveTrackingPlan, {
    arcs: [], beats: [], secrets: [], outputFieldNames: [
      "nd_confirmed_facts", "nd_arc_states", "nd_readiness_evidence", "nd_blockers",
      "nd_eligible_beats", "nd_secret_layers", "nd_confidence",
    ],
  });
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
  publicPremise: "Mara has recently arrived in the old quarter and carries an unusual brass key.",
  storySummary: "A traveler discovers a key linked to a hidden inheritance.",
  characterInformation: "Mara is observant, guarded and newly arrived in the city.",
  cardAdditions: "Mara notices small physical details before social cues.",
  lorebookEntries: [
    { name: "Old Quarter", description: "Historic district", content: "The oldest district in the city.", keys: ["quarter"] },
  ],
  privateDirectorDocument: "The key belongs to Mara's missing sibling and opens a future sealed archive.",
  privateCharacters: [
    { id: "mara", name: "Mara", role: "Missing heir", privateGoal: "Find her sibling" },
    { id: "ivo", name: "Ivo", role: "Archive keeper", privateGoal: "Protect Mara" },
  ],
  secrets: [{
    id: "key_origin", title: "Origin of the key", ownerCharacterId: "mara",
    knownByCharacterIds: ["mara", "ivo"], status: "locked", summary: "The key belongs to Mara's sibling.",
    revealCondition: "The sealed archive opens.",
  }],
  narrativeArcs: [{
    id: "archive_arc", title: "The sealed archive", status: "active",
    observedState: "Mara has reached the old quarter.", momentum: "medium",
    impossibilityEvidence: "", impossibilityFact: "", confidence: "",
  }],
  candidateBeats: [{
    id: "archive_threshold", title: "An invitation to the archive", relatedArcIds: ["archive_arc"],
    status: "eligible", hardPrerequisites: ["Mara has the brass key"],
    readinessSignals: ["Mara asks about the archive"], blockers: ["Mara explicitly leaves the district"],
    setupStrategies: ["Ivo can leave a visible archive notice"], relatedSecretIds: ["key_origin"],
  }],
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
    /invalid structure|private narrative structure is invalid/,
  );
});

test("analysis prompt requires the source language", () => {
  assert.match(core.ANALYSIS_PROMPT, /predominant language of the supplied source text/i);
});

test("all rewrite instructions stay within the Marinara limit", () => {
  assert.ok(core.ANALYSIS_PROMPT.length <= 4_000, `analysis prompt is ${core.ANALYSIS_PROMPT.length} characters`);
  assert.ok(core.ANALYSIS_PROMPT.length <= 3_800, `analysis prompt exceeds the 3,800-character safety target`);
  assert.ok(core.INITIALIZATION_PROMPT.length <= 4_000, `initialization prompt is ${core.INITIALIZATION_PROMPT.length} characters`);
});

test("analysis prompt defines public as initial knowledge and permits empty public output", () => {
  assert.match(core.ANALYSIS_PROMPT, /PUBLIC means only information \{\{user\}\} and characters present can know at the beginning/i);
  assert.match(core.ANALYSIS_PROMPT, /Worldbuilding is NOT automatically public/i);
  assert.match(core.ANALYSIS_PROMPT, /empty publicPremise\/card fields or an empty lorebookEntries array/i);
});

test("analysis contract ends with adaptive structures and contains no legacy fields", () => {
  for (const field of ["narrativeStages", "currentStageId", "trackerStages", "trackedSecrets", "trackerProjection"]) {
    assert.doesNotMatch(core.ANALYSIS_PROMPT, new RegExp(field));
  }
  const shapeEnd = core.ANALYSIS_PROMPT.indexOf("PUBLIC means");
  const shape = core.ANALYSIS_PROMPT.slice(0, shapeEnd);
  assert.ok(shape.lastIndexOf('"candidateBeats"') > shape.lastIndexOf('"narrativeArcs"'));
  assert.doesNotMatch(shape.slice(shape.lastIndexOf('"candidateBeats"')), /tracker|stage/i);
});

test("discarded legacy input fields are neither stored nor exported", () => {
  const story = core.createStory({
    ...validStory(), progressionProjection: "old", narrativeStages: [{ id: "old" }], currentStageId: "old",
    trackerStages: [{ id: "old" }], trackedSecrets: [{ id: "old" }],
  });
  const serialized = JSON.stringify(core.exportBundle([story]));
  for (const field of ["progressionProjection", "narrativeStages", "currentStageId", "trackerStages", "trackedSecrets"]) {
    assert.equal(Object.hasOwn(story, field), false);
    assert.equal(serialized.includes(`"${field}"`), false);
  }
});

test("validates private narrative relationships and stable IDs", () => {
  const parsed = core.parseAnalysisResponse(JSON.stringify(validAnalysis));
  assert.equal(parsed.secrets[0].ownerCharacterId, "mara");
  assert.deepEqual(parsed.secrets[0].knownByCharacterIds, ["mara", "ivo"]);
  assert.equal(parsed.secrets[0].status, "locked");
  assert.equal(core.parseAnalysisResponse(JSON.stringify(parsed)).secrets[0].id, "key_origin");
  for (const status of ["locked", "foreshadowed", "suspected", "partially_revealed", "confirmed"]) {
    assert.equal(core.parseAnalysisResponse(JSON.stringify({ ...validAnalysis, secrets: [{ ...validAnalysis.secrets[0], status }] })).secrets[0].status, status);
  }
});

test("rejects secret content copied into public card or lorebook fields", () => {
  assert.throws(
    () => core.parseAnalysisResponse(JSON.stringify({ ...validAnalysis, cardAdditions: validAnalysis.secrets[0].summary })),
    /unrevealed private information/,
  );
  assert.throws(
    () => core.parseAnalysisResponse(JSON.stringify({
      ...validAnalysis,
      lorebookEntries: [{ name: "Leak", description: "", content: validAnalysis.secrets[0].revealCondition, keys: [] }],
    })),
    /unrevealed private information/,
  );
});

test("allows empty public premise, card fields and lorebook entries", () => {
  const parsed = core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis, publicPremise: "", characterInformation: "", cardAdditions: "", lorebookEntries: [],
  }));
  assert.equal(parsed.publicPremise, "");
  assert.deepEqual(parsed.lorebookEntries, []);
});

test("applies analysis without creating redundant tracker structures", () => {
  const original = validStory({ sourceText: "ORIGINAL SOURCE" });
  const analyzed = core.applyAnalysis(original, validAnalysis, "2030-01-01T00:00:00.000Z");
  assert.equal(analyzed.sourceText, "ORIGINAL SOURCE");
  assert.equal(analyzed.storySummary, validAnalysis.storySummary);
  assert.equal(analyzed.characterInformation, validAnalysis.characterInformation);
  assert.equal(analyzed.privateDocument, validAnalysis.privateDirectorDocument);
  for (const key of ["progressionProjection", "narrativeStages", "currentStageId", "trackerStages", "trackedSecrets"]) {
    assert.equal(Object.hasOwn(analyzed, key), false);
  }
  assert.equal(JSON.parse(analyzed.lorebookEntries)[0].name, "Old Quarter");
});

test("builds a selected public preview without the private Director document", () => {
  const story = validStory({
    publicPremise: "Public premise",
    storySummary: "COMPLETE PRIVATE SUMMARY",
    characterInformation: "Public character details",
    cardAdditions: "Public permanent fact",
    lorebookEntries: JSON.stringify([
      { name: "Included", description: "One", content: "Public lore one", keys: ["one"] },
      { name: "Excluded", description: "Two", content: "Public lore two", keys: ["two"] },
    ]),
    applicationCharacterName: "Mara",
    applicationLorebookName: "Mara's World",
    applicationCardSections: ["publicPremise", "characterInformation", "cardAdditions", "storySummary"],
    applicationLorebookSelection: [0],
  });
  const preview = core.buildPublicResourcePreview(story);
  assert.equal(preview.character.data.name, "Mara");
  assert.match(preview.character.data.description, /Public character details/);
  assert.match(preview.character.data.description, /Public premise/);
  assert.doesNotMatch(preview.character.data.description, /COMPLETE PRIVATE SUMMARY/);
  assert.equal(preview.lorebook.description, "Public premise");
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

test("Director receives complete private structure while tracker receives only IDs and states", () => {
  const story = validStory({ ...validAnalysis, confirmedInitialState: validInitialState });
  const director = core.buildDirectorPayload(story);
  const tracker = core.buildTrackerPayload(story);
  assert.deepEqual(director.settings.narrative.currentState, validInitialState);
  assert.equal(director.settings.narrative.completeStorySummary, validAnalysis.storySummary);
  assert.deepEqual(director.settings.narrative.privateStructure.secrets, validAnalysis.secrets);
  assert.match(director.promptTemplate, /narrative\.currentState/);
  assert.match(director.promptTemplate, /narrative\.privateStructure/);
  assert.match(director.promptTemplate, /narrative\.completeStorySummary/);
  assert.equal(JSON.stringify(tracker).includes(story.privateDocument), false);
  assert.equal(JSON.stringify(tracker).includes(validAnalysis.secrets[0].summary), false);
  assert.equal(JSON.stringify(tracker).includes(validAnalysis.secrets[0].revealCondition), false);
  assert.equal(JSON.stringify(tracker).includes(validAnalysis.privateCharacters[0].privateGoal), false);
  assert.equal(JSON.stringify(tracker).includes(validAnalysis.storySummary), false);
  assert.equal(tracker.settings.narrative.adaptiveTrackingPlan.arcs[0].id, "archive_arc");
  assert.equal(tracker.settings.narrative.adaptiveTrackingPlan.beats[0].id, "archive_threshold");
  assert.deepEqual(tracker.settings.narrative.adaptiveTrackingPlan.secrets, [{ id: "key_origin", status: "locked" }]);
  assert.equal(JSON.stringify(tracker.settings.narrative.adaptiveTrackingPlan).includes("Ivo can leave"), false);
  assert.match(tracker.promptTemplate, /narrative\.adaptiveTrackingPlan/);
  const serializedPayloads = JSON.stringify({ director, tracker });
  for (const field of ["progressionProjection", "narrativeStages", "currentStageId", "trackerStages", "trackedSecrets"]) {
    assert.equal(serializedPayloads.includes(field), false);
  }
  const contaminated = core.createStory({
    ...story,
    tracker: { ...story.tracker, promptTemplate: `Track this: ${validAnalysis.secrets[0].summary}` },
  });
  assert.throws(() => core.buildTrackerPayload(contaminated), /Private narrative details/);
});

test("exports structured narrative data but never session-only raw responses", () => {
  const story = validStory(validAnalysis);
  const exported = core.exportBundle([story]);
  assert.equal(exported.stories[0].secrets[0].id, "key_origin");
  assert.equal(JSON.stringify(exported).includes("rawAnalysisResponse"), false);
  assert.equal(JSON.stringify(exported).includes("rewrittenText"), false);
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

test("validates adaptive arc, beat and secret references", () => {
  const parsed = core.parseAnalysisResponse(JSON.stringify(validAnalysis));
  assert.equal(parsed.narrativeArcs[0].momentum, "medium");
  assert.deepEqual(parsed.candidateBeats[0].relatedArcIds, ["archive_arc"]);
  assert.deepEqual(parsed.candidateBeats[0].relatedSecretIds, ["key_origin"]);
  assert.throws(() => core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis,
    candidateBeats: [{ ...validAnalysis.candidateBeats[0], relatedArcIds: ["missing_arc"] }],
  })), /unknown arc/);
  assert.throws(() => core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis,
    narrativeArcs: [...validAnalysis.narrativeArcs, { ...validAnalysis.narrativeArcs[0] }],
  })), /Duplicate narrative arc id/);
});

test("Director protects player agency and receives complete adaptive planning", () => {
  const payload = core.buildDirectorPayload(validStory(validAnalysis));
  assert.match(payload.promptTemplate, /Never control, prescribe or assume \{\{user\}\} actions/i);
  assert.match(payload.promptTemplate, /ignore, refuse, delay or diverge/i);
  assert.match(payload.promptTemplate, /current_game_state/i);
  assert.deepEqual(payload.settings.narrative.adaptivePlan.candidateBeats, validAnalysis.candidateBeats);
  assert.deepEqual(payload.settings.narrative.privateStructure.narrativeArcs, validAnalysis.narrativeArcs);
});

test("tracker records observations only and bridge state is readable next turn", () => {
  const payload = core.buildTrackerPayload(validStory(validAnalysis));
  assert.match(payload.promptTemplate, /insufficient evidence, preserve the previous value/i);
  assert.match(payload.promptTemplate, /Eligibility never means execution/i);
  assert.doesNotMatch(JSON.stringify(payload), /Ivo can leave a visible archive notice/);
  const state = core.extractAdaptiveTrackerState({ playerStats: { customTrackerFields: [
    { name: "nd_confirmed_facts", value: '["Mara refused the invitation"]' },
    { name: "nd_eligible_beats", value: "[]" },
    { name: "nd_confidence", value: "high" },
  ] } });
  assert.deepEqual(state.nd_confirmed_facts, ["Mara refused the invitation"]);
  assert.deepEqual(state.nd_eligible_beats, []);
  assert.equal(state.nd_confidence, "high");
});

test("splits long chats chronologically without omitting active message content", () => {
  const messages = [
    { id: "m1", role: "user", content: "A".repeat(40_000), activeSwipeIndex: 0 },
    { id: "m2", role: "assistant", content: "B".repeat(24_000), activeSwipeIndex: 2 },
    { id: "m3", role: "user", content: "C".repeat(24_000), activeSwipeIndex: 0 },
  ];
  const prepared = core.buildInitializationChunks(validStory(), messages, 30_000);
  assert.ok(prepared.chunks.length > 1);
  const flattened = prepared.chunks.flatMap((chunk) => chunk.messages);
  assert.deepEqual(flattened.map((item) => item.sourceIndex), [...flattened.map((item) => item.sourceIndex)].sort((a, b) => a - b));
  for (const [index, message] of messages.entries()) {
    assert.equal(flattened.filter((item) => item.sourceIndex === index).map((item) => item.content).join(""), message.content);
  }
  assert.ok(prepared.chunks.some((chunk) => chunk.splitMessageParts.length > 0));
});

test("passes partial state into the next initialization block", () => {
  const chunks = core.buildInitializationChunks(validStory(), [
    { id: "m1", role: "user", content: "A".repeat(30_000) },
    { id: "m2", role: "assistant", content: "B".repeat(30_000) },
  ], 35_000).chunks;
  const partial = { happenedSummary: "First block confirmed" };
  const input = JSON.parse(core.buildInitializationChunkInput(validStory(), chunks[1], partial));
  assert.deepEqual(input.previousPartialState, partial);
});

test("enforces conservative abandoned arcs while allowing pause and recovery", () => {
  const baseArc = validAnalysis.narrativeArcs[0];
  assert.doesNotThrow(() => core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis, narrativeArcs: [{ ...baseArc, status: "paused", momentum: "low" }],
  })));
  assert.doesNotThrow(() => core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis, narrativeArcs: [{ ...baseArc, status: "active", momentum: "medium" }],
  })));
  assert.throws(() => core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis, narrativeArcs: [{ ...baseArc, status: "abandoned" }],
  })), /impossibilityEvidence/);
  assert.doesNotThrow(() => core.parseAnalysisResponse(JSON.stringify({
    ...validAnalysis,
    narrativeArcs: [{ ...baseArc, status: "abandoned", impossibilityEvidence: "The indispensable keeper died on screen", impossibilityFact: "The keeper is definitively dead and has no coherent replacement", confidence: "high" }],
  })));
  assert.match(core.DEFAULT_TRACKER_PROMPT, /Refusal, delay, low readiness/i);
});
