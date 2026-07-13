import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
await import("../src/core.js");
const core = globalThis.__NarrativeDirectorCore;

const analysis = {
  projectType: "character_focus", title: "Harbor Watch", publicPremise: "A courier reaches a public harbor.", privateSummary: "The courier carries a hidden map.", privateDocument: "The map leads to a sealed refuge.", mainCharacterId: "courier",
  characters: [
    { id: "courier", name: "Courier", role: "lead", isMain: true, description: "A known courier.", appearance: "Wears a blue coat.", personality: "Careful and courteous.", scenario: "Arrives at the harbor.", privateGoal: "Reach the sealed refuge unseen." },
    { id: "warden", name: "Warden", role: "secondary", isMain: false, description: "Harbor official.", appearance: "", personality: "Strict but fair.", scenario: "" },
  ],
  places: [{ id: "harbor", name: "Harbor" }], organizations: [{ id: "watch", name: "Harbor Watch" }], worldRules: [{ id: "tide_rule", name: "Tide rule" }],
  facts: [
    { id: "blue_coat", subjectId: "courier", category: "appearance", text: "The courier wears a blue coat.", visibility: "public", knownByCharacterIds: ["courier", "warden"], evidence: "Visible in opening." },
    { id: "hidden_map", subjectId: "courier", category: "context", text: "The coat conceals the refuge map.", visibility: "private", knownByCharacterIds: ["courier"], evidence: "Private outline." },
    { id: "bell_meaning", subjectId: "harbor", category: "place", text: "The evening bell closes the quay.", visibility: "uncertain", knownByCharacterIds: ["warden"], evidence: "Disclosure unclear." },
    { id: "watch_role", subjectId: "watch", category: "organization", text: "The Watch manages harbor access.", visibility: "public", knownByCharacterIds: [], evidence: "Common knowledge." },
    { id: "tides", subjectId: "tide_rule", category: "rule", text: "Low tide exposes the east path.", visibility: "public", knownByCharacterIds: [], evidence: "Common rule." },
  ],
  secrets: [{ id: "map_destination", title: "Map destination", ownerCharacterId: "courier", knownByCharacterIds: ["courier"], layer: "locked", summary: "It marks the sealed refuge.", revealCondition: "The map is openly read." }],
  knowledgeMatrix: [{ characterId: "courier", knownFactIds: ["hidden_map"], knownSecretIds: ["map_destination"] }],
  narrativeArcs: [{ id: "refuge_arc", title: "Reach the refuge", status: "active", observedState: "Courier reached harbor", momentum: "low", impossibilityEvidence: "", impossibilityFact: "", confidence: "" }],
  candidateBeats: [{ id: "inspect_map", title: "Map clue", relatedArcIds: ["refuge_arc"], status: "unavailable", hardPrerequisites: ["privacy"], readinessSignals: ["Courier opens the map"], blockers: ["Warden is watching"], setupStrategies: ["Move the Warden through an external duty"], relatedSecretIds: ["map_destination"] }],
};

function project(overrides = {}) { return core.createProject({ name: "Harbor Watch", chatId: "chat-a", intermediate: analysis, uncertainDecisions: { bell_meaning: "private" }, ...overrides }); }

test("two fixed agent types never vary by project", () => {
  assert.deepEqual(core.agentTypes(project()), { director: "narrative-story-director", tracker: "narrative-story-tracker" });
  assert.deepEqual(core.agentTypes(core.createProject({ id: "other" })), core.agentTypes(project()));
});

test("official import preset configures Director and Tracker without Context Injection", () => {
  const preset = JSON.parse(readFileSync(new URL("../presets/marinara-agents.json", import.meta.url), "utf8"));
  assert.equal(preset.kind, "marinara.agent-folder"); assert.equal(preset.version, 1); assert.equal(preset.agents.length, 2);
  const director = preset.agents.find((row) => row.type === core.DIRECTOR_TYPE); const tracker = preset.agents.find((row) => row.type === core.TRACKER_TYPE);
  assert.equal(director.phase, "pre_generation"); assert.equal(director.resultType, "director_event");
  assert.equal(tracker.phase, "post_processing"); assert.equal(tracker.resultType, "custom_tracker_update"); assert.equal(tracker.settings.customCapabilities.edit_trackers, true);
  assert.deepEqual(director.settings.enabledTools, ["search_lorebook"]); assert.deepEqual(tracker.settings.enabledTools, ["search_lorebook"]);
  assert.equal(director.promptTemplate, core.DIRECTOR_PROMPT.replace(/\s+/g, " ")); assert.equal(tracker.promptTemplate, core.TRACKER_PROMPT.replace(/\s+/g, " "));
  assert.doesNotMatch(JSON.stringify(preset), /context_injection/i);
});

test("all production rewrite instructions are within 4,000 characters and universal", () => {
  for (const prompt of [core.analysisInstruction("character_focus"), core.analysisInstruction("world_ensemble"), core.analysisPartInstruction("character_focus", 1, 99), core.INITIALIZATION_PROMPT, core.REPAIR_PROMPT, core.DIRECTOR_PROMPT, core.TRACKER_PROMPT]) assert.ok(prompt.length <= 4_000, `${prompt.length}`);
  const prompts = [core.ANALYSIS_PROMPT, core.INITIALIZATION_PROMPT, core.DIRECTOR_PROMPT, core.TRACKER_PROMPT].join("\n");
  for (const fixture of ["Harbor Watch", "Courier", "blue coat", "refuge", "Warden"]) assert.doesNotMatch(prompts, new RegExp(fixture, "i"));
});

test("editable classification policy preserves the fixed JSON contract", () => {
  const custom = "PUBLIC = opening knowledge only. PRIVATE = every hidden relationship. UNCERTAIN = unconfirmed interpretation."; const full = core.analysisInstruction("character_focus", custom); const part = core.analysisPartInstruction("character_focus", 1, 2, custom);
  assert.match(core.DEFAULT_CLASSIFICATION_INSTRUCTIONS, /PUBLIC = known at the beginning/i); assert.match(core.DEFAULT_CLASSIFICATION_INSTRUCTIONS, /PRIVATE = secret/i); assert.match(core.DEFAULT_CLASSIFICATION_INSTRUCTIONS, /UNCERTAIN = interpretation/i); assert.match(core.DEFAULT_CLASSIFICATION_INSTRUCTIONS, /Source presence is not in-story publicity/i);
  for (const prompt of [full, part]) { assert.match(prompt, new RegExp(custom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); assert.match(prompt, /fixed JSON shape/i); assert.ok(prompt.length <= 4_000); }
  assert.equal(core.classificationInstructions(""), core.DEFAULT_CLASSIFICATION_INSTRUCTIONS); assert.equal(core.classificationInstructions("X".repeat(900)).length, core.MAX_CLASSIFICATION_INSTRUCTIONS_LENGTH);
});

test("analysis prompt groups narratively related facts instead of mapping every sentence", () => {
  assert.match(core.ANALYSIS_PROMPT, /not one object per sentence/i); assert.match(core.ANALYSIS_PROMPT, /subject, category, visibility and knownByCharacterIds/i); assert.doesNotMatch(core.ANALYSIS_PROMPT, /Classify every fact separately/i);
});

test("JSON classification distinguishes valid, repairable, truncated, empty and incompatible output", () => {
  assert.equal(core.classifyJsonResponse(JSON.stringify(analysis)).kind, "valid");
  assert.equal(core.classifyJsonResponse(`${JSON.stringify(analysis).slice(0, -1)},}`).kind, "repairable");
  assert.equal(core.classifyJsonResponse('{"facts":[{"id":"f41"').kind, "truncated");
  assert.equal(core.classifyJsonResponse(JSON.stringify(analysis), "length").kind, "truncated");
  assert.equal(core.classifyJsonResponse("  ").kind, "empty"); assert.equal(core.classifyJsonResponse("plain prose").kind, "incompatible");
});

test("logical source blocks preserve every character and stay chronological", () => {
  const source = `# Opening\n${"A".repeat(6_500)}\n\n# Future\n${"B".repeat(6_500)}`; const blocks = core.splitAnalysisSource(source); assert.ok(blocks.length > 1); assert.equal(blocks.map((row) => row.text).join(""), source);
  blocks.forEach((block, index) => { assert.equal(block.index, index); assert.match(block.context, /# Opening/); if (index) assert.equal(block.start, blocks[index - 1].end); }); assert.match(`${blocks.at(-1).context}\n${blocks.at(-1).text}`, /# Future/);
});

test("truncated source block is divided into smaller chronological logical children", () => {
  const source = `# Opening\n${"First sentence. ".repeat(220)}\n\n# Turn\n${"Second sentence. ".repeat(220)}`; const parent = { index: 0, start: 0, end: source.length, text: source, path: "1", depth: 0 };
  const children = core.subdivideAnalysisBlock(parent, source); assert.equal(children.length, 2); assert.deepEqual(children.map((row) => row.path), ["1.1", "1.2"]); assert.equal(children.map((row) => row.text).join(""), source);
  assert.ok(children.every((row) => row.text.length < source.length && row.depth === 1)); assert.equal(children[0].start, 0); assert.equal(children[0].end, children[1].start); assert.equal(children[1].end, source.length);
});

test("deterministic progressive merge preserves visibility, knowledge and valid references", () => {
  const first = structuredClone(analysis); first.facts = analysis.facts.slice(0, 2); first.secrets = analysis.secrets; first.narrativeArcs = analysis.narrativeArcs; first.candidateBeats = [];
  const second = structuredClone(analysis); second.characters[0].id = "courier_again"; second.mainCharacterId = "courier_again"; second.facts = [
    { id: "coat_more", subjectId: "courier_again", category: "appearance", text: "The coat has brass buttons.", visibility: "public", knownByCharacterIds: ["courier_again", "warden"], evidence: "Visible in opening." },
    analysis.facts[2],
  ]; second.secrets = [{ ...analysis.secrets[0], id: "destination_again", ownerCharacterId: "courier_again", knownByCharacterIds: ["courier_again", "warden"] }]; second.knowledgeMatrix = [{ characterId: "warden", knownFactIds: [], knownSecretIds: ["destination_again"] }];
  const mergedA = core.mergeAnalysisPartials([first, second], "character_focus"); const mergedB = core.mergeAnalysisPartials([first, second], "character_focus"); assert.deepEqual(mergedA, mergedB);
  assert.equal(mergedA.characters.filter((row) => row.name === "Courier").length, 1); assert.deepEqual(new Set(mergedA.facts.map((row) => row.visibility)), new Set(["public", "private", "uncertain"]));
  const coat = mergedA.facts.find((row) => /brass buttons/.test(row.text)); assert.match(coat.text, /blue coat/i); assert.ok(mergedA.characters.some((row) => row.id === coat.subjectId));
  const secret = mergedA.secrets[0]; assert.equal(secret.knownByCharacterIds.length, 2); assert.ok(mergedA.knowledgeMatrix.find((row) => row.characterId === secret.knownByCharacterIds.find((id) => mergedA.characters.find((character) => character.id === id)?.name === "Warden"))?.knownSecretIds.includes(secret.id));
  for (const beat of mergedA.candidateBeats) { assert.ok(beat.relatedArcIds.every((id) => mergedA.narrativeArcs.some((arc) => arc.id === id))); assert.ok(beat.relatedSecretIds.every((id) => mergedA.secrets.some((row) => row.id === id))); }
});

test("classification conflicts and private character or world details never reach public resources", () => {
  const base = { projectType: "character_focus", title: "Contradiction fixture", publicPremise: "Three colleagues begin an ordinary school day.", privateSummary: "Private fixture summary.", privateDocument: "Private fixture document.", mainCharacterId: "damian",
    characters: [
      { id: "damian", name: "Damian", role: "guardian", isMain: true, description: "Damian is caring. Damian secretly adopted the protagonist.", appearance: "", personality: "", scenario: "", privateGoal: "Hide the adoption." },
      { id: "amon", name: "Amon", role: "adviser", isMain: false, description: "Amon is a quiet adviser. Amon secretly commands the hidden order.", appearance: "", personality: "", scenario: "", privateGoal: "Protect the hidden order." },
      { id: "robert", name: "Robert", role: "teacher", isMain: false, description: "Robert is a professor. Robert will transform into a beast.", appearance: "", personality: "", scenario: "", privateGoal: "Conceal his future transformation." },
    ], places: [], organizations: [], worldRules: [{ id: "blood_rule", name: "The hidden blood law binds every heir" }], knowledgeMatrix: [],
    facts: [
      { id: "damian_private", subjectId: "damian", category: "relationship", text: "Damian secretly adopted the protagonist.", visibility: "private", knownByCharacterIds: ["damian"], evidence: "Private section" },
      { id: "amon_private", subjectId: "amon", category: "description", text: "Amon secretly commands the hidden order.", visibility: "private", knownByCharacterIds: ["amon"], evidence: "Secret" },
      { id: "robert_public", subjectId: "robert", category: "description", text: "Robert is a professor.", visibility: "public", knownByCharacterIds: [], evidence: "Opening" },
      { id: "robert_private", subjectId: "robert", category: "context", text: "Robert will transform into a beast.", visibility: "private", knownByCharacterIds: ["robert"], evidence: "Future" },
      { id: "rule_private", subjectId: "blood_rule", category: "rule", text: "The hidden blood law binds every heir.", visibility: "private", knownByCharacterIds: [], evidence: "Secret rule" },
    ],
    secrets: [{ id: "amon_identity", title: "Amon's secret function", ownerCharacterId: "amon", knownByCharacterIds: ["amon"], layer: "locked", summary: "Amon secretly commands the hidden order.", revealCondition: "Amon openly claims command." }],
    narrativeArcs: [{ id: "transformation", title: "Robert transforms", status: "inactive", observedState: "Robert has not transformed.", momentum: "low", impossibilityEvidence: "", impossibilityFact: "", confidence: "" }],
    candidateBeats: [{ id: "beast_change", title: "Robert's transformation", relatedArcIds: ["transformation"], status: "unavailable", hardPrerequisites: [], readinessSignals: [], blockers: [], setupStrategies: ["Robert will transform into a beast."], relatedSecretIds: [] }] };
  const contradictory = structuredClone(base); contradictory.facts = base.facts.map((fact) => ({ ...fact, id: `${fact.id}_public`, visibility: "public", knownByCharacterIds: [] }));
  const merged = core.mergeAnalysisPartials([base, contradictory], "character_focus", "# PRIVATE\nDamian secretly adopted the protagonist.\nAmon secretly commands the hidden order.\nThe hidden blood law binds every heir.");
  for (const text of ["Damian secretly adopted the protagonist.", "Amon secretly commands the hidden order.", "Robert will transform into a beast.", "The hidden blood law binds every heir."]) { const matches = merged.facts.filter((fact) => fact.text === text); assert.ok(matches.length); assert.ok(matches.every((fact) => fact.visibility === "private")); }
  assert.equal(merged.facts.find((fact) => fact.text === "Robert is a professor.")?.visibility, "public"); assert.match(merged.characters.find((row) => row.name === "Robert").description, /professor/i); assert.doesNotMatch(merged.characters.find((row) => row.name === "Robert").description, /transform/i); assert.doesNotMatch(merged.characters.find((row) => row.name === "Damian").description, /adopt/i); assert.doesNotMatch(merged.characters.find((row) => row.name === "Amon").description, /commands/i);
  const value = core.createProject({ id: "conflicts", name: "Conflicts", sourceText: "# PRIVATE\nDamian secretly adopted the protagonist.", intermediate: merged, primaryCharacterEntityId: merged.characters.find((row) => row.name === "Damian").id, separateCharacterEntityIds: merged.characters.filter((row) => row.name !== "Damian").map((row) => row.id) }); const output = core.compilePublicResources(value); const publicText = JSON.stringify(output);
  assert.match(publicText, /Robert is a professor/i); for (const forbidden of ["adopted the protagonist", "commands the hidden order", "transform into a beast", "hidden blood law"]) assert.doesNotMatch(publicText, new RegExp(forbidden, "i"));
});

test("fixed agent prompts enforce advisory Director and observational Tracker boundaries", () => {
  for (const value of [core.DIRECTOR_LOREBOOK_SENTINEL, "eligible beat is only a possibility", "clue, then suspicion, then confirmation", "{{user}} agency", "never an automatic action"]) assert.match(core.DIRECTOR_PROMPT, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  for (const value of [core.TRACKER_LOREBOOK_SENTINEL, "Without new evidence, preserve prior values exactly", "never direct the story", "never execute, reveal, advance or order", "Refusal, delay, low readiness or divergence never abandon"]) assert.match(core.TRACKER_PROMPT, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const preset = JSON.parse(readFileSync(new URL("../presets/marinara-agents.json", import.meta.url), "utf8")); const tracker = preset.agents.find((row) => row.type === core.TRACKER_TYPE); const contract = JSON.parse(tracker.promptTemplate.match(/Return exactly (\{\"fields\":\[.*?\]\})\./)[1]); assert.deepEqual(contract.fields.map((row) => row.name), core.TRACKER_FIELD_NAMES); assert.ok(contract.fields.every((row) => typeof row.value === "string"));
});

test("analysis parses fenced JSON and keeps mixed facts separate", () => {
  const parsed = core.parseAnalysisResponse(`\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``);
  assert.equal(parsed.facts.find((row) => row.id === "blue_coat").visibility, "public");
  assert.equal(parsed.facts.find((row) => row.id === "hidden_map").visibility, "private");
  assert.equal(parsed.facts.find((row) => row.id === "bell_meaning").visibility, "uncertain");
});

test("Character focus compiler fills native card fields and never leaks private facts", () => {
  const output = core.compilePublicResources(project()); const card = output.cards[0].data;
  assert.equal(card.name, "Courier"); assert.match(card.description, /known courier/i); assert.match(card.personality, /courteous/i); assert.match(card.scenario, /harbor/i); assert.match(card.extensions.appearance, /blue coat/i);
  assert.doesNotMatch(JSON.stringify(output), /sealed refuge|conceals the refuge map|map is openly read/i);
});

test("World ensemble retains NPCs and avoids card/lorebook duplication", () => {
  const value = project({ projectType: "world_ensemble", separateCharacterEntityIds: [] }); const output = core.compilePublicResources(value);
  assert.equal(output.cards[0].entityId, "world_narrator"); assert.ok(output.lorebookEntries.some((entry) => entry.entityId === "warden"));
  const selected = core.compilePublicResources(core.createProject({ ...value, separateCharacterEntityIds: ["warden"] }, value.createdAt));
  assert.ok(selected.cards.some((card) => card.entityId === "warden")); assert.ok(!selected.lorebookEntries.some((entry) => entry.entityId === "warden"));
});

test("Apply is blocked while an uncertain fact has no decision", () => {
  assert.throws(() => core.compilePublicResources(project({ uncertainDecisions: {} })), /Resolve 1 uncertain fact/);
});

test("Director document is complete while Tracker plan cannot reconstruct secrets", () => {
  const value = project(); const director = core.buildDirectorDocument(value); const tracker = core.buildTrackerPlan(value); const trackerText = JSON.stringify(tracker);
  assert.equal(director.structuredProject.privateDocument, analysis.privateDocument); assert.equal(director.structuredProject.secrets[0].summary, analysis.secrets[0].summary); assert.equal(director.structuredProject.knowledgeMatrix[0].characterId, "courier");
  for (const forbidden of [analysis.privateDocument, analysis.privateSummary, analysis.characters[0].privateGoal, analysis.secrets[0].summary, analysis.secrets[0].revealCondition, analysis.candidateBeats[0].setupStrategies[0]]) assert.ok(!trackerText.includes(forbidden));
  assert.deepEqual(tracker.secretLayers, { map_destination: "locked" }); assert.deepEqual(tracker.fieldNames, core.TRACKER_FIELD_NAMES);
});

test("single-lorebook transport keeps complete concepts for Director and sanitized observations for Tracker", () => {
  const transport = core.buildLorebookTransport(project()); const director = JSON.parse(transport.director.content); const tracker = JSON.parse(transport.tracker.content);
  assert.equal(director.structuredProject.secrets[0].summary, analysis.secrets[0].summary); assert.equal(director.structuredProject.candidateBeats[0].setupStrategies[0], analysis.candidateBeats[0].setupStrategies[0]);
  assert.deepEqual(transport.director.keys, [core.NEVER_MATCH_REGEX]); assert.deepEqual(transport.tracker.keys, [core.NEVER_MATCH_REGEX]);
  assert.equal(new RegExp(core.NEVER_MATCH_REGEX).test(`${analysis.title} ${analysis.privateDocument} ordinary roleplay`), false);
  for (const entry of [transport.director, transport.tracker]) { assert.equal(entry.enabled, true); assert.equal(entry.constant, false); assert.equal(entry.useRegex, true); assert.equal(entry.excludeFromVectorization, true); assert.equal(entry.preventRecursion, true); assert.deepEqual(entry.additionalMatchingSources, []); }
  const trackerText = JSON.stringify(tracker); for (const forbidden of [analysis.privateDocument, analysis.privateSummary, analysis.secrets[0].summary, analysis.secrets[0].revealCondition, analysis.candidateBeats[0].setupStrategies[0]]) assert.ok(!trackerText.includes(forbidden));
});

test("different chats can recover the same project from its Director document", () => {
  const memory = core.buildDirectorDocument(project()); const a = core.recoverProjectFromDirectorDocument(memory, { chatId: "chat-a" }); const b = core.recoverProjectFromDirectorDocument(memory, { chatId: "chat-b" });
  assert.equal(a.id, b.id); assert.notEqual(a.chatId, b.chatId); assert.equal(b.intermediate.privateDocument, analysis.privateDocument);
});

test("agent status distinguishes missing, inactive and active", () => {
  assert.equal(core.agentStatuses([], {}).director.status, "missing");
  assert.equal(core.agentStatuses([{ type: core.DIRECTOR_TYPE }], {}).director.status, "inactive");
  assert.equal(core.agentStatuses([{ type: core.DIRECTOR_TYPE }], { activeAgentIds: [core.DIRECTOR_TYPE] }).director.status, "active");
});

test("activation preserves unrelated agents", () => {
  assert.deepEqual(core.updateFixedActivation(["other"], true), ["other", core.DIRECTOR_TYPE, core.TRACKER_TYPE]);
  assert.deepEqual(core.updateFixedActivation(["other", core.DIRECTOR_TYPE, core.TRACKER_TYPE], false), ["other"]);
});

test("Tracker payload is the minimum exact Custom Tracker fields array", () => {
  const payload = core.trackerPayload(core.buildTrackerPlan(project())); assert.equal(payload.fields.length, 7); assert.deepEqual(payload.fields.map((row) => row.name), core.TRACKER_FIELD_NAMES); assert.ok(core.validateTrackerPayload(payload));
  assert.equal(core.validateTrackerPayload({ fields: payload.fields.slice(1) }), false);
});

test("Director validator accepts editorial direction and rejects evident narration", () => {
  assert.equal(core.validateDirectorInstruction("Let the harbor bell create pressure while the Warden remains observant."), true);
  assert.equal(core.validateDirectorInstruction('The Warden walked to the gate and said, "Stop."'), false);
  assert.equal(core.validateDirectorInstruction("```json\n{}\n```"), false);
});

test("chronological chunking omits no content and preserves exact cursor", () => {
  const messages = [{ id: "a", role: "user", content: "A".repeat(40_000) }, { id: "b", role: "assistant", content: "B".repeat(40_000) }]; const parts = []; let cursor = {};
  while (true) { const block = core.buildNextInitializationBlock(project(), messages, cursor, null, { routeBudget: 30_000 }); if (block.done) break; parts.push(...block.messages); cursor = block.nextCursor; assert.ok(block.selectedText.length < 50_000); }
  for (const [index, message] of messages.entries()) assert.equal(parts.filter((row) => row.sourceIndex === index).map((row) => row.content).join(""), message.content);
});

test("export and import use only schema v2", () => {
  const bundle = core.exportBundle([project()]); const restored = core.importBundle(JSON.parse(JSON.stringify(bundle))); assert.equal(restored[0].schemaVersion, 2); assert.equal(restored[0].intermediate.facts.length, analysis.facts.length);
  assert.throws(() => core.importBundle({ kind: bundle.kind, schemaVersion: 1, projects: [] }), /Unsupported/);
});

test("production source contains no removed architecture", () => {
  const source = ["core.js", "api.js", "ui.js"].map((name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8")).join("\n");
  for (const removed of ["agentKey", "ensureAgents", "upsertAgent", "buildDirectorPayload", "buildTrackerPayload", "settings.narrative", "directorConnectionId", "trackerConnectionId", "progressionProjection", "trackerStages", "trackedSecrets", "currentStageId", "narrativeStages"]) assert.doesNotMatch(source, new RegExp(removed));
  assert.doesNotMatch(source, /post\(["']\/agents["']/); assert.doesNotMatch(source, /patch\(["']\/agents\//);
});

test("UI exposes review groups, lorebook recovery, and responsive no-overflow rules", () => {
  const ui = readFileSync(new URL("../src/ui.js", import.meta.url), "utf8"); const css = readFileSync(new URL("../src/extension.css", import.meta.url), "utf8");
  assert.match(ui, /facts-public/); assert.match(ui, /facts-private/); assert.match(ui, /facts-uncertain/); assert.match(ui, /load-lorebook/); assert.match(ui, /lorebook-contract-warning/);
  assert.match(ui, /analysis-progress/); assert.match(ui, /cancel-story-analysis/); assert.match(ui, /Characters.*charStart/); assert.match(ui, /subdivided automatically/); assert.match(ui, /Analyzing subdivided block/);
  assert.match(ui, /Analysis Classification Instructions/); assert.match(ui, /save-classification/); assert.match(ui, /reset-classification/); assert.match(ui, /classificationInstructions: state\.classificationInstructions/);
  assert.match(css, /@media \(max-width: 620px\)/); assert.match(css, /overflow-wrap: anywhere/);
});
