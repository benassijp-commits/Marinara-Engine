import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
await import("../src/core.js");
const core = globalThis.__NarrativeDirectorCore;

const story = {
  title: "Harbor Night", mainCharacterId: "courier",
  worldCard: { name: "Harbor Night", description: "A courier arrives at a busy public harbor.", personality: "Atmospheric and grounded.", scenario: "Evening at the quay." },
  characters: [
    { id: "courier", name: "Courier", aliases: ["Blue Coat"], isMain: true, public: { role: "Courier", description: "A trusted traveler.", appearance: "Blue coat.", personality: "Patient.", scenario: "Recently arrived." }, directorNotes: "Carries the hidden refuge map." },
    { id: "warden", name: "Warden", aliases: [], isMain: false, public: { role: "Harbor official", description: "Manages public access.", appearance: "", personality: "Strict.", scenario: "On duty." }, directorNotes: "Secretly protects the courier." },
  ],
  worldEntries: [{ id: "quay", name: "East Quay", keys: ["quay", "harbor"], content: "The public quay closes at dusk." }],
  directorGuide: "The sealed refuge must remain hidden until trust develops.",
  secrets: [{ id: "refuge", title: "Sealed refuge", truth: "The map leads to a refuge.", knownByCharacterIds: ["courier"], revealCondition: "The map is deliberately shown.", status: "locked" }],
  storylines: [{ id: "trust", title: "Growing trust", direction: "Trust may grow gradually through shared choices.", status: "active" }],
};
const confirmedState = { summary: "The courier arrived.", currentSituation: "The Warden approaches.", revealedSecretIds: [], storylineStatuses: { trust: "active" }, characterStates: { courier: "At the quay", warden: "On duty" } };
function project(overrides = {}) { return core.createProject({ id: "project-a", name: "Harbor Night", chatId: "chat-a", story, confirmedState, primaryCharacterEntityId: "courier", ...overrides }); }

test("schema v3 has exactly the canonical story shape", () => {
  const parsed = core.normalizeStory(story, true); assert.deepEqual(Object.keys(parsed), ["title", "mainCharacterId", "worldCard", "characters", "worldEntries", "directorGuide", "secrets", "storylines"]); assert.deepEqual(Object.keys(parsed.characters[0]), ["id", "name", "aliases", "isMain", "public", "directorNotes"]); assert.deepEqual(Object.keys(parsed.secrets[0]), ["id", "title", "truth", "knownByCharacterIds", "revealCondition", "status"]); assert.equal(core.SCHEMA_VERSION, 3);
});

test("invalid, duplicate and dangling IDs are rejected", () => {
  assert.throws(() => core.normalizeStory({ ...story, characters: [...story.characters, { ...story.characters[0] }] }, true), /unique valid id/i);
  assert.throws(() => core.normalizeStory({ ...story, mainCharacterId: "missing" }, true), /mainCharacterId/i);
  assert.throws(() => core.normalizeStory({ ...story, secrets: [{ ...story.secrets[0], knownByCharacterIds: ["missing"] }] }, true), /unknown character/i);
  assert.throws(() => core.normalizeStory({ ...story, storylines: [{ ...story.storylines[0], status: "abandoned" }] }, true), /status is invalid/i);
  assert.throws(() => core.normalizeStory({ ...story, worldCard: { ...story.worldCard, scenario: 42 } }, true), /worldCard\.scenario must be a string/i);
  assert.throws(() => core.normalizeStory({ ...story, characters: [{ ...story.characters[0], isMain: "yes" }, story.characters[1]] }, true), /isMain must be a boolean/i);
});

test("v3 export and import preserve the canonical project", () => {
  const bundle = core.exportBundle([project()]); assert.equal(bundle.schemaVersion, 3); const restored = core.importBundle(JSON.parse(JSON.stringify(bundle)))[0]; assert.deepEqual(restored.story, story); assert.deepEqual(restored.confirmedState, confirmedState); assert.equal(restored.schemaVersion, 3);
});

test("isolated story application preserves project operations and resets old state", () => {
  const before = project(); const replacement = { ...story, title: "Imported story", directorGuide: "Replacement guide" }; const applied = core.applyStory(before, replacement); assert.equal(applied.id, before.id); assert.equal(applied.chatId, before.chatId); assert.equal(applied.sourceText, before.sourceText); assert.equal(applied.analysisConnectionId, before.analysisConnectionId); assert.deepEqual(applied.publicResourceIds, before.publicResourceIds); assert.equal(applied.story.title, "Imported story"); assert.equal(applied.confirmedState, null);
});

test("v2 project migration is deterministic, limited and marked for review", () => {
  const legacy = { id: "legacy", schemaVersion: 2, name: "Old", sourceText: "source", chatId: "chat-a", intermediate: { title: "Old Story", publicPremise: "Public opening", privateSummary: "Fallback", privateDocument: "Private guide", mainCharacterId: "hero", characters: [{ id: "hero", name: "Hero", role: "Lead", isMain: true, description: "Public hero", appearance: "Coat", personality: "Calm", scenario: "Opening", privateGoal: "Hidden goal" }], secrets: [{ id: "truth", title: "Truth", summary: "Hidden truth", knownByCharacterIds: ["hero"], revealCondition: "Open reveal", layer: "suspected" }], narrativeArcs: [{ id: "arc", title: "Arc", observedState: "Beginning", status: "active" }] }, confirmedInitialState: { happenedSummary: "Started", currentPoint: "Gate", revealedSecretIds: [], characterStates: [{ characterId: "hero", state: "Present" }] } };
  const a = core.createProject(legacy), b = core.createProject(legacy); assert.deepEqual(a.story, b.story); assert.equal(a.schemaVersion, 3); assert.equal(a.needsReview, true); assert.equal(a.story.worldCard.description, "Public opening"); assert.equal(a.story.characters[0].directorNotes, "Hidden goal"); assert.equal(a.story.directorGuide, "Private guide"); assert.equal(a.story.secrets[0].status, "hinted"); assert.equal(a.story.storylines[0].status, "active"); assert.deepEqual(a.story.worldEntries, []); assert.equal(a.confirmedState.summary, "Started");
});

test("world ensemble compiles only direct public fields", () => {
  const output = core.compilePublicResources(project({ projectType: "world_ensemble", separateCharacterEntityIds: ["warden"] })); assert.equal(output.cards[0].data.name, story.worldCard.name); assert.ok(output.cards.some((card) => card.data.name === "Warden")); assert.ok(output.lorebookEntries.some((entry) => entry.entityId === "courier")); assert.ok(output.lorebookEntries.some((entry) => entry.entityId === "quay")); const serialized = JSON.stringify(output); for (const privateText of ["hidden refuge map", "secretly protects", "sealed refuge", "map leads", "trust may grow"]) assert.doesNotMatch(serialized, new RegExp(privateText, "i"));
});

test("character focus compiles the primary character and public lorebook", () => {
  const output = core.compilePublicResources(project()); assert.equal(output.cards.length, 1); assert.equal(output.cards[0].entityId, "courier"); assert.match(output.cards[0].data.description, /trusted traveler/i); assert.ok(output.lorebookEntries.some((entry) => entry.entityId === "warden")); assert.ok(output.lorebookEntries.some((entry) => entry.entityId === "quay"));
});

test("Director document and Tracker plan have narrow private boundaries", () => {
  const director = core.buildDirectorDocument(project()); assert.deepEqual(Object.keys(director), ["title", "directorGuide", "characters", "secrets", "storylines", "editorialInstructions", "confirmedState"]); assert.match(JSON.stringify(director), /hidden refuge map/i); assert.equal(director.characters[0].public, undefined);
  const tracker = core.buildTrackerPlan(project()); const serialized = JSON.stringify(tracker); assert.deepEqual(Object.keys(tracker), ["secrets", "storylines", "characters", "state"]); assert.doesNotMatch(serialized, /map leads|hidden refuge map|secretly protects|trust may grow/i); assert.deepEqual(tracker.secrets[0], { id: "refuge", title: "Sealed refuge", revealCondition: "The map is deliberately shown." });
});

test("Tracker uses exactly five simplified fields", () => {
  assert.deepEqual(core.TRACKER_FIELD_NAMES, ["nd_summary", "nd_current_situation", "nd_revealed_secrets", "nd_storylines", "nd_character_states"]); const payload = core.trackerPayload(confirmedState); assert.deepEqual(payload.fields.map((row) => row.name), core.TRACKER_FIELD_NAMES); assert.ok(core.validateTrackerPayload(payload)); assert.ok(payload.fields.every((row) => { JSON.parse(row.value); return true; }));
});

test("initialization selects recent messages once and reports omissions", () => {
  const messages = [{ id: "old", role: "user", content: "A".repeat(30_000) }, { id: "new", role: "assistant", content: "B".repeat(30_000) }]; const prepared = core.buildInitializationInput(project(), messages, { chatSummary: "Summary" }); const parsed = JSON.parse(prepared.input); assert.equal(prepared.messageCount, 2); assert.equal(prepared.includedMessageCount, 1); assert.equal(prepared.omittedMessageCount, 1); assert.equal(parsed.recentMessages[0].id, "new"); assert.ok(prepared.input.length <= 50_000);
});

test("initialization rejects a private envelope that cannot fit before calling a model", () => {
  const oversized = project({ story: { ...story, directorGuide: "P".repeat(49_000) } }); assert.throws(() => core.buildInitializationInput(oversized, [{ id: "new", role: "user", content: "Hello" }]), /private project is too large/i);
});

test("analysis and initialization prompts are compact and fixed", () => {
  assert.ok(core.ANALYSIS_PROMPT.length < 4_000); assert.ok(core.INITIALIZATION_PROMPT.length < 4_000); assert.match(core.ANALYSIS_PROMPT, /worldCard/); assert.match(core.ANALYSIS_PROMPT, /one compact story JSON/i); assert.match(core.ANALYSIS_PROMPT, /predominant language/i); assert.match(core.ANALYSIS_PROMPT, /Never invent or determine \{\{user\}\}/i); assert.ok(core.DEFAULT_ANALYSIS_RULES.length < core.MAX_ANALYSIS_RULES_LENGTH);
});

test("updated agent preset matches fixed v3 prompts and five fields", () => {
  const preset = JSON.parse(readFileSync(new URL("../presets/marinara-agents.json", import.meta.url), "utf8")); const director = preset.agents.find((row) => row.type === core.DIRECTOR_TYPE); const tracker = preset.agents.find((row) => row.type === core.TRACKER_TYPE); assert.equal(director.promptTemplate, core.DIRECTOR_PROMPT.replace(/\s+/g, " ")); assert.equal(tracker.promptTemplate, core.TRACKER_PROMPT.replace(/\s+/g, " ")); assert.equal(director.phase, "pre_generation"); assert.equal(tracker.phase, "post_processing"); for (const name of core.TRACKER_FIELD_NAMES) assert.match(tracker.promptTemplate, new RegExp(name));
});

test("production runtime contains none of the removed architecture names", () => {
  const source = ["core.js", "api.js", "ui.js"].map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")).join("\n"); for (const removed of ["knowledgeMatrix", "candidateBeats", "readinessSignals", "impossibilityEvidence", "uncertainDecisions", "ANALYSIS_MAX_ATTEMPTS", "analysisCheckpoint", "subdivideAnalysisBlock", "mergeAnalysisPartials"]) assert.doesNotMatch(source, new RegExp(removed));
});

test("UI has five tabs, editable rules and no review surface", () => {
  const ui = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8"); for (const tab of ["source", "public", "private", "initialize", "agents"]) assert.match(ui, new RegExp(`\\[?\"${tab}\"`)); assert.doesNotMatch(ui, /data-panel=\"review\"/); assert.match(ui, /Regras de análise/); assert.match(ui, /save-rules/); assert.match(ui, /reset-rules/); assert.match(ui, /Open a project before importing an isolated story object/);
});

test("fixed agent activation preserves unrelated types", () => { assert.deepEqual(core.updateFixedActivation(["other"], true), ["other", core.DIRECTOR_TYPE, core.TRACKER_TYPE]); assert.deepEqual(core.updateFixedActivation(["other", core.DIRECTOR_TYPE, core.TRACKER_TYPE], false), ["other"]); });
