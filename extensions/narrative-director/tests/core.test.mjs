import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
await import("../src/core.js");
const core = globalThis.__NarrativeDirectorCore;

const story = {
  title: "Harbor Night",
  mainCharacterId: "courier",
  worldCard: { name: "Harbor Night", description: "A courier arrives at a public harbor.", personality: "Grounded.", scenario: "Evening at the quay." },
  characters: [
    { id: "courier", name: "Courier", aliases: ["Blue Coat"], isMain: true, public: { role: "Courier", description: "A trusted traveler.", appearance: "Blue coat.", personality: "Patient.", scenario: "Recently arrived." }, curatorNotes: "Carries the hidden refuge map." },
    { id: "warden", name: "Warden", aliases: [], isMain: false, public: { role: "Harbor official", description: "Manages public access.", appearance: "", personality: "Strict.", scenario: "On duty." }, curatorNotes: "Secretly protects the courier." },
  ],
  relationships: [{ id: "courier_warden", characterIds: ["courier", "warden"], publicSummary: "They have just met at the quay.", privateSummary: "The Warden recognizes the courier's family sign." }],
  worldEntries: [{ id: "quay", name: "East Quay", keys: ["quay", "harbor"], content: "The public quay closes at dusk." }],
  curatorGuide: "Keep the sealed refuge hidden until trust develops.",
  secrets: [{ id: "refuge", title: "Sealed refuge", truth: "The map leads to a refuge.", knownByCharacterIds: ["courier"], revealCondition: "The map is deliberately shown.", status: "locked" }],
  storylines: [{ id: "trust", title: "Growing trust", direction: "Trust may grow through shared choices.", status: "active" }],
};
const confirmedState = { summary: "The courier arrived.", currentSituation: "The Warden approaches.", revealedSecretIds: [], storylineStatuses: { trust: "active" }, characterStates: { courier: "At the quay", warden: "On duty" } };
function project(overrides = {}) { return core.createProject({ id: "project-a", name: "Harbor Night", chatId: "chat-a", story, confirmedState, primaryCharacterEntityId: "courier", ...overrides }); }

test("schema v4 has the canonical Curator story shape", () => {
  const parsed = core.normalizeStory(story, true);
  assert.deepEqual(Object.keys(parsed), ["title", "mainCharacterId", "worldCard", "characters", "relationships", "worldEntries", "curatorGuide", "secrets", "storylines"]);
  assert.deepEqual(Object.keys(parsed.characters[0]), ["id", "name", "aliases", "isMain", "public", "curatorNotes"]);
  assert.equal(core.SCHEMA_VERSION, 4);
});

test("invalid, duplicate and dangling IDs are rejected", () => {
  assert.throws(() => core.normalizeStory({ ...story, characters: [...story.characters, { ...story.characters[0] }] }, true), /unique valid id/i);
  assert.throws(() => core.normalizeStory({ ...story, mainCharacterId: "missing" }, true), /mainCharacterId/i);
  assert.throws(() => core.normalizeStory({ ...story, relationships: [{ ...story.relationships[0], characterIds: ["courier", "missing"] }] }, true), /known characters/i);
  assert.throws(() => core.normalizeStory({ ...story, secrets: [{ ...story.secrets[0], knownByCharacterIds: ["missing"] }] }, true), /unknown character/i);
});

test("v4 export and import preserve the canonical project", () => {
  const bundle = core.exportBundle([project()]);
  assert.equal(bundle.kind, "marinara.narrative-curator-projects");
  assert.equal(bundle.schemaVersion, 4);
  const restored = core.importBundle(JSON.parse(JSON.stringify(bundle)))[0];
  assert.deepEqual(restored.story, story);
  assert.deepEqual(restored.confirmedState, confirmedState);
});

test("the external v4 template imports through the existing bundle path", () => {
  const template = JSON.parse(readFileSync(new URL("../narrative-curator-v4-import-template.json", import.meta.url), "utf8"));
  const imported = core.importBundle(template);
  assert.equal(imported.length, 1);
  assert.equal(imported[0].schemaVersion, 4);
  assert.equal(imported[0].story.relationships.length, 1);
});

test("v2 and v3 bundles are rejected instead of migrated", () => {
  for (const schemaVersion of [2, 3]) assert.throws(() => core.importBundle({ kind: "marinara.narrative-director-projects", schemaVersion, projects: [] }), /only clean Narrative Curator v4/i);
  assert.throws(() => core.importBundle({ kind: core.BUNDLE_KIND, schemaVersion: 3, projects: [] }), /only clean Narrative Curator v4/i);
});

test("isolated v4 story application preserves operations and resets old state", () => {
  const before = project(); const replacement = { ...story, title: "Imported story", curatorGuide: "Replacement guide" }; const applied = core.applyStory(before, replacement);
  assert.equal(applied.id, before.id); assert.equal(applied.chatId, before.chatId); assert.deepEqual(applied.publicResourceIds, before.publicResourceIds); assert.equal(applied.story.title, "Imported story"); assert.equal(applied.confirmedState, null);
});

test("public compiler excludes all private Curator data", () => {
  const output = core.compilePublicResources(project({ projectType: "world_ensemble", separateCharacterEntityIds: ["warden"] }));
  const serialized = JSON.stringify(output);
  assert.match(serialized, /They have just met/);
  for (const privateText of ["hidden refuge map", "Secretly protects", "family sign", "sealed refuge", "map leads", "Trust may grow"]) assert.doesNotMatch(serialized, new RegExp(privateText, "i"));
});

test("one Curator document contains the structured private context", () => {
  const document = core.buildCuratorDocument(project());
  assert.deepEqual(Object.keys(document), ["title", "curatorGuide", "characters", "relationships", "secrets", "storylines", "editorialInstructions", "confirmedInitialState"]);
  assert.match(JSON.stringify(document), /hidden refuge map/i);
  const transport = core.buildLorebookTransport(project());
  assert.deepEqual(Object.keys(transport), ["curator"]);
  assert.equal(transport.curator.name, core.CURATOR_LOREBOOK_SENTINEL);
});

test("initialization keeps the newest messages and reports omissions", () => {
  const messages = [{ id: "old", role: "user", content: "A".repeat(30_000) }, { id: "new", role: "assistant", content: "B".repeat(30_000) }]; const prepared = core.buildInitializationInput(project(), messages, { chatSummary: "Summary" }); const parsed = JSON.parse(prepared.input);
  assert.equal(prepared.includedMessageCount, 1); assert.equal(prepared.omittedMessageCount, 1); assert.equal(parsed.recentMessages[0].id, "new"); assert.ok(prepared.input.length <= 50_000);
});

test("prompts encode the agreed Curator behavior", () => {
  assert.ok(core.ANALYSIS_PROMPT.length < 4_000); assert.ok(core.INITIALIZATION_PROMPT.length < 4_000); assert.match(core.ANALYSIS_PROMPT, /relationships/); assert.match(core.CURATOR_PROMPT, /ten most recent active messages/i); assert.match(core.CURATOR_PROMPT, /what remains hidden/i); assert.match(core.CURATOR_PROMPT, /character present.*knowing it/i); assert.match(core.CURATOR_PROMPT, /Return only the short instruction/i);
});

test("preset contains exactly one fixed v4 Curator", () => {
  const preset = JSON.parse(readFileSync(new URL("../presets/marinara-agents.json", import.meta.url), "utf8"));
  assert.equal(preset.agents.length, 1); const curator = preset.agents[0]; assert.equal(curator.type, core.CURATOR_TYPE); assert.equal(curator.promptTemplate, core.CURATOR_PROMPT.replace(/\s+/g, " ")); assert.equal(curator.phase, "pre_generation"); assert.equal(curator.resultType, "director_event"); assert.equal(curator.settings.contextSize, 10);
});

test("activation owns only the Curator type", () => {
  assert.deepEqual(core.updateFixedActivation(["other"], true), ["other", core.CURATOR_TYPE]);
  assert.deepEqual(core.updateFixedActivation(["other", core.CURATOR_TYPE], false), ["other"]);
});

test("runtime has no automatic migration or Tracker contract", () => {
  const source = ["core.js", "api.js", "ui.js"].map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")).join("\n");
  for (const removed of ["legacyStory", "legacyState", "TRACKER_FIELD_NAMES", "buildTrackerPlan", "trackerPayload", "__ND_TRACKER_PROJECT_V3__"]) assert.doesNotMatch(source, new RegExp(removed));
});
