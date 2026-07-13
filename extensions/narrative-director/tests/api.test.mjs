import test from "node:test";
import assert from "node:assert/strict";
await import("../src/core.js"); await import("../src/api.js");
const core = globalThis.__NarrativeDirectorCore;
const apiFactory = globalThis.__NarrativeDirectorApi;

const analysis = { projectType: "character_focus", title: "Test project", publicPremise: "Public opening", privateSummary: "Private summary", privateDocument: "Private document", mainCharacterId: "lead",
  characters: [{ id: "lead", name: "Lead", role: "lead", isMain: true, description: "Visible", appearance: "", personality: "Calm", scenario: "Opening" }], places: [], organizations: [], worldRules: [],
  facts: [{ id: "visible", subjectId: "lead", category: "description", text: "Visible fact", visibility: "public", knownByCharacterIds: ["lead"], evidence: "Opening" }],
  secrets: [{ id: "secret", title: "Secret", ownerCharacterId: "lead", knownByCharacterIds: ["lead"], layer: "locked", summary: "Private truth", revealCondition: "Explicit reveal" }], knowledgeMatrix: [{ characterId: "lead", knownFactIds: ["visible"], knownSecretIds: ["secret"] }],
  narrativeArcs: [{ id: "arc", title: "Arc", status: "active", observedState: "Started", momentum: "low", impossibilityEvidence: "", impossibilityFact: "", confidence: "" }],
  candidateBeats: [{ id: "beat", title: "Beat", relatedArcIds: ["arc"], status: "unavailable", hardPrerequisites: [], readinessSignals: ["Signal"], blockers: [], setupStrategies: ["Private setup"], relatedSecretIds: ["secret"] }] };
const initialState = { happenedSummary: "Nothing yet", currentPoint: "Opening", occurredEvents: [], pendingEventIds: ["beat"], revealedSecretIds: [], blockedSecretIds: ["secret"], characterStates: [{ characterId: "lead", state: "Present" }], confirmedFacts: [] };
function project(overrides = {}) { return core.createProject({ id: "test-project", name: "Test", chatId: "chat-a", analysisConnectionId: "conn", initializationConnectionId: "conn", intermediate: analysis, ...overrides }); }

function harness({ rewrites = [JSON.stringify(analysis)], agents = [{ id: "d", type: core.DIRECTOR_TYPE }, { id: "t", type: core.TRACKER_TYPE }], failMemoryType = "" } = {}) {
  const calls = []; const memories = new Map(); let rewriteIndex = 0;
  const marinara = { apiFetch: async (path, options = {}) => {
    const method = options.method || "GET"; const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ path, method, body });
    if (path === "/agents/suite/rewrite") return { rewrittenText: rewrites[Math.min(rewriteIndex++, rewrites.length - 1)] };
    if (path === "/agents") return agents;
    if (/^\/chats\/[^/]+$/.test(path)) return method === "PATCH" ? { ok: true } : { id: path.split("/").at(-1), metadata: { activeAgentIds: ["other"] }, characterIds: [] };
    if (path.endsWith("/metadata")) return { ok: true };
    if (path.includes("/game-state")) return { playerStats: { customTrackerFields: [] } };
    if (path.includes("/messages")) return [];
    const memory = path.match(/^\/agents\/memory\/([^/]+)\/([^/]+)$/);
    if (memory) { const key = `${memory[1]}:${memory[2]}`; if (method === "PATCH") { if (memory[1] === failMemoryType) throw new Error("memory failed"); memories.set(key, { ...(memories.get(key) || {}), ...body.patch }); return { memory: memories.get(key) }; } if (method === "DELETE") { memories.delete(key); return null; } return { memory: memories.get(key) || {} }; }
    if (path === "/characters" || path === "/lorebooks") return { id: `created-${calls.length}` };
    if (/\/lorebooks\/[^/]+\/entries$/.test(path)) return { id: `entry-${calls.length}` };
    if (path === "/connections") return [];
    if (path.startsWith("/characters?")) return [];
    if (path === "/chats") return [];
    return {};
  } };
  return { api: apiFactory.createApi(marinara), calls, memories };
}

test("exactly 50,000 source characters reach rewrite while 50,001 is rejected before a call", async () => {
  const ok = harness(); await ok.api.analyzeStory("conn", "A".repeat(50_000)); assert.equal(ok.calls.filter((call) => call.path === "/agents/suite/rewrite").length, 1);
  const rejected = harness(); await assert.rejects(rejected.api.analyzeStory("conn", "A".repeat(50_001)), /50,000/); assert.equal(rejected.calls.length, 0);
});

test("invalid JSON gets at most one automatic repair with the same connection", async () => {
  const { api, calls } = harness({ rewrites: ["not json", JSON.stringify(analysis)] }); const result = await api.analyzeStory("conn", "short source"); assert.equal(result.title, analysis.title);
  const rewrites = calls.filter((call) => call.path === "/agents/suite/rewrite"); assert.equal(rewrites.length, 2); assert.equal(rewrites[0].body.connectionId, rewrites[1].body.connectionId); assert.equal(rewrites[1].body.instruction, core.REPAIR_PROMPT);
});

test("raw analysis response remains in session memory only", async () => {
  const { api } = harness(); await api.analyzeStory("conn", "source"); assert.match(api.getLastRawResponse(), /Test project/); api.clearLastRawResponse(); assert.equal(api.getLastRawResponse(), "");
});

test("API never creates or patches agent configuration", async () => {
  const { api, calls } = harness(); await api.getAgentStatuses("chat-a"); await api.syncProjectMemories(project()); await api.updateChatActivation("chat-a", true);
  assert.ok(!calls.some((call) => call.method === "POST" && call.path === "/agents")); assert.ok(!calls.some((call) => call.method === "PATCH" && /^\/agents\/(?!memory)/.test(call.path)));
});

test("two chats store different memories under the same fixed agents", async () => {
  const { api, memories } = harness(); await api.syncProjectMemories(project({ chatId: "chat-a" })); await api.syncProjectMemories(project({ chatId: "chat-b", editorialInstructions: "Different chat posture" }));
  assert.equal(memories.get(`${core.DIRECTOR_TYPE}:chat-a`).editorialInstructions, ""); assert.equal(memories.get(`${core.DIRECTOR_TYPE}:chat-b`).editorialInstructions, "Different chat posture");
  assert.ok(!JSON.stringify(memories.get(`${core.TRACKER_TYPE}:chat-a`)).includes("Private truth"));
});

test("server-side Director memory reload reconstructs a project in a fresh API instance", async () => {
  const shared = harness(); await shared.api.syncProjectMemories(project()); const memory = shared.memories.get(`${core.DIRECTOR_TYPE}:chat-a`);
  const recovered = core.recoverProjectFromDirectorMemory(memory, { chatId: "chat-a" }); assert.equal(recovered.id, project().id); assert.equal(recovered.intermediate.privateDocument, "Private document");
});

test("partial memory failure exposes Director success without deleting confirmed local state", async () => {
  const { api } = harness({ failMemoryType: core.TRACKER_TYPE }); const before = project(); await assert.rejects(async () => { try { await api.syncProjectMemories(before); } catch (error) { assert.equal(error.directorMemoryUpdated, true); throw error; } }, /memory failed/); assert.equal(before.confirmedInitialState, null);
});

test("activation requires both existing types and preserves unrelated active agents", async () => {
  const missing = harness({ agents: [{ type: core.DIRECTOR_TYPE }] }); await assert.rejects(missing.api.updateChatActivation("chat-a", true), /both fixed/i);
  const ready = harness(); await ready.api.updateChatActivation("chat-a", true); const call = ready.calls.find((row) => row.path.endsWith("/metadata") && row.method === "PATCH"); assert.deepEqual(call.body.activeAgentIds, ["other", core.DIRECTOR_TYPE, core.TRACKER_TYPE]);
});

test("Initialize synchronizes analysis state, not agent configuration", async () => {
  const { api, calls } = harness({ rewrites: [JSON.stringify(initialState)] }); const result = await api.initializeFromChat("conn", project(), [{ id: "m", role: "user", content: "Hello" }]); assert.equal(result.initialState.currentPoint, "Opening"); assert.ok(!calls.some((call) => call.path === "/agents" && call.method !== "GET"));
});

test("long-chat failure resumes the exact failed block", async () => {
  const messages = [{ id: "a", role: "user", content: "A".repeat(45_000) }, { id: "b", role: "assistant", content: "B".repeat(45_000) }];
  const bad = "not json"; const { api, calls } = harness({ rewrites: [JSON.stringify(initialState), bad, bad, JSON.stringify(initialState)] }); let checkpoint; await assert.rejects(async () => { try { await api.initializeFromChat("conn", project(), messages); } catch (error) { checkpoint = error.initializationCheckpoint; throw error; } }, /block 2/i);
  assert.ok(calls.filter((call) => call.path === "/agents/suite/rewrite").every((call) => call.body.selectedText.length <= 50_000 && call.body.instruction.length <= 4_000));
  const failedText = calls.filter((call) => call.path === "/agents/suite/rewrite").at(-2).body.selectedText; const before = calls.length; await api.initializeFromChat("conn", project(), messages, { resume: checkpoint }); const resumed = calls.slice(before).find((call) => call.path === "/agents/suite/rewrite"); assert.equal(resumed.body.selectedText, failedText);
});

test("cancellation returns no partial proposal", async () => {
  const controller = new AbortController(); const { api } = harness({ rewrites: [JSON.stringify(initialState)] }); controller.abort(); await assert.rejects(api.initializeFromChat("conn", project(), [{ id: "m", role: "user", content: "Hello" }], { signal: controller.signal }), /cancelled/i);
});
