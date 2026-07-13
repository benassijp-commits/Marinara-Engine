import assert from "node:assert/strict";
import { createFakeIndexedDB } from "../tests/fake-indexeddb.mjs";
await import("../src/core.js"); await import("../src/storage.js"); await import("../src/api.js");
const core = globalThis.__NarrativeDirectorCore;
const fixture = { projectType: "character_focus", title: "Fictional smoke", publicPremise: "A traveler reaches a station.", privateSummary: "A private route remains hidden.", privateDocument: "The Director keeps the hidden route private.", mainCharacterId: "traveler",
  characters: [{ id: "traveler", name: "Traveler", role: "lead", isMain: true, description: "A known traveler.", appearance: "Green coat.", personality: "Patient.", scenario: "At the station." }], places: [{ id: "station", name: "Station" }], organizations: [], worldRules: [],
  facts: [{ id: "coat", subjectId: "traveler", category: "appearance", text: "The traveler wears a green coat.", visibility: "public", knownByCharacterIds: ["traveler"], evidence: "Visible." }, { id: "route", subjectId: "station", category: "place", text: "A hidden route exists.", visibility: "private", knownByCharacterIds: ["traveler"], evidence: "Private outline." }],
  secrets: [{ id: "hidden_route", title: "Hidden route", ownerCharacterId: "traveler", knownByCharacterIds: ["traveler"], layer: "locked", summary: "The route reaches a refuge.", revealCondition: "The route is shown." }], knowledgeMatrix: [{ characterId: "traveler", knownFactIds: ["route"], knownSecretIds: ["hidden_route"] }],
  narrativeArcs: [{ id: "travel_arc", title: "Travel", status: "active", observedState: "At station", momentum: "low", impossibilityEvidence: "", impossibilityFact: "", confidence: "" }],
  candidateBeats: [{ id: "route_clue", title: "Route clue", relatedArcIds: ["travel_arc"], status: "unavailable", hardPrerequisites: [], readinessSignals: ["The route is discussed"], blockers: [], setupStrategies: ["Use an external timetable clue"], relatedSecretIds: ["hidden_route"] }] };
const initial = { happenedSummary: "Arrival confirmed", currentPoint: "Station", occurredEvents: ["arrival"], pendingEventIds: ["route_clue"], revealedSecretIds: [], blockedSecretIds: ["hidden_route"], characterStates: [{ characterId: "traveler", state: "Present" }], confirmedFacts: ["Arrival"] };
const calls = [];
const api = globalThis.__NarrativeDirectorApi.createApi({ apiFetch: async (path, options = {}) => { calls.push({ path, body: options.body ? JSON.parse(options.body) : null }); if (path === "/agents/suite/rewrite") return { rewrittenText: JSON.stringify(fixture) }; return {}; } });
const store = globalThis.__NarrativeDirectorStorage.createStore(createFakeIndexedDB());
let project = core.createProject({ id: "smoke-project", name: "Smoke", chatId: "smoke-chat", analysisConnectionId: "smoke-connection", initializationConnectionId: "smoke-connection", sourceText: "A wholly fictional outline." });
const analyzed = await api.analyzeStory(project.analysisConnectionId, project.sourceText, project.projectType); project = core.applyAnalysis(project, analyzed); await store.saveProject(project);
project = core.createProject(await store.getProject(project.id)); assert.equal(project.intermediate.title, fixture.title);
const preview = core.compilePublicResources(project); assert.equal(preview.cards[0].data.name, "Traveler"); assert.doesNotMatch(JSON.stringify(preview), /hidden route|refuge/i);
const initializationInput = core.buildInitializationInput(project, [{ id: "message", role: "user", content: "The traveler arrives." }]); assert.ok(initializationInput.input.length <= 50_000);
project = core.createProject({ ...project, confirmedInitialState: initial }, project.createdAt); const director = core.buildDirectorMemory(project); const tracker = core.buildTrackerMemory(project); assert.match(JSON.stringify(director), /refuge/); assert.doesNotMatch(JSON.stringify(tracker), /refuge|route is shown/i);
const restored = core.importBundle(JSON.parse(JSON.stringify(core.exportBundle([project]))))[0]; assert.equal(restored.id, project.id);
const serialized = JSON.stringify(restored); for (const removed of ["agentKey", "trackerStages", "narrativeStages"]) assert.ok(!serialized.includes(removed));
assert.equal(calls.length, 1); process.stdout.write("Narrative Director v2 isolated smoke passed.\n");
