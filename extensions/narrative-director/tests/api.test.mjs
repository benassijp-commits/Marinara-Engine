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

function harness({ rewrites = [JSON.stringify(analysis)], agents = [{ id: "d", type: core.DIRECTOR_TYPE }, { id: "t", type: core.TRACKER_TYPE }], failTrackerEntry = false } = {}) {
  const calls = []; const lorebooks = new Map(); const lorebookData = new Map(); const chatMetadata = { activeAgentIds: ["other"], activeLorebookIds: [], excludedLorebookIds: [] }; let rewriteIndex = 0; let nextId = 1;
  const marinara = { apiFetch: async (path, options = {}) => {
    const method = options.method || "GET"; const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ path, method, body });
    if (path === "/agents/suite/rewrite") { const output = rewrites[Math.min(rewriteIndex++, rewrites.length - 1)]; return typeof output === "string" ? { rewrittenText: output } : output; }
    if (path === "/agents") return agents;
    if (/^\/chats\/[^/]+$/.test(path)) return method === "PATCH" ? { ok: true } : { id: path.split("/").at(-1), metadata: chatMetadata, characterIds: [] };
    if (path.endsWith("/metadata")) { Object.assign(chatMetadata, body); return { metadata: chatMetadata }; }
    if (path.includes("/game-state")) return { playerStats: { customTrackerFields: [] } };
    if (path.includes("/messages")) return [];
    if (path === "/characters") return { id: `created-${nextId++}` };
    if (path === "/lorebooks") { if (method === "GET") return [...lorebookData.values()]; const id = `book-${nextId++}`; lorebooks.set(id, []); const row = { ...body, id }; lorebookData.set(id, row); return row; }
    const entryPath = path.match(/^\/lorebooks\/([^/]+)\/entries(?:\/([^/]+))?$/);
    if (entryPath) { const rows = lorebooks.get(entryPath[1]) || []; if (method === "GET") return rows; if (method === "POST") { if (failTrackerEntry && body.name === core.TRACKER_LOREBOOK_SENTINEL) throw new Error("tracker entry failed"); const row = { ...body, id: `entry-${nextId++}`, lorebookId: entryPath[1] }; rows.push(row); lorebooks.set(entryPath[1], rows); return row; } if (method === "PATCH") { const index = rows.findIndex((row) => row.id === entryPath[2]); const row = { ...rows[index], ...body }; rows[index] = row; return row; } }
    if (path === "/connections") return [];
    if (path.startsWith("/characters?")) return [];
    if (path === "/chats") return [];
    return {};
  } };
  return { api: apiFactory.createApi(marinara), calls, lorebooks, lorebookData, chatMetadata };
}

test("exactly 50,000 source characters use progressive rewrite while 50,001 is rejected before a call", async () => {
  const ok = harness(); const source = "A".repeat(50_000); await ok.api.analyzeStory("conn", source); const rewrites = ok.calls.filter((call) => call.path === "/agents/suite/rewrite"); assert.ok(rewrites.length > 1); assert.equal(rewrites.map((call) => call.body.selectedText).join(""), source);
  const rejected = harness(); await assert.rejects(rejected.api.analyzeStory("conn", "A".repeat(50_001)), /50,000/); assert.equal(rejected.calls.length, 0);
});

test("complete JSON with a small syntax defect gets one repair with the same connection", async () => {
  const trailingComma = `${JSON.stringify(analysis).slice(0, -1)},}`; const { api, calls } = harness({ rewrites: [trailingComma, JSON.stringify(analysis)] }); const result = await api.analyzeStory("conn", "short source"); assert.equal(result.title, analysis.title);
  const rewrites = calls.filter((call) => call.path === "/agents/suite/rewrite"); assert.equal(rewrites.length, 2); assert.equal(rewrites[0].body.connectionId, rewrites[1].body.connectionId); assert.equal(rewrites[1].body.instruction, core.REPAIR_PROMPT);
});

test("truncated facts output is diagnosed and never sent through whole-response repair", async () => {
  const truncated = '{"projectType":"character_focus","facts":[{"id":"f41","text":"cut'; const { api, calls } = harness({ rewrites: [{ rewrittenText: truncated, finishReason: "length" }, JSON.stringify(analysis)] });
  await assert.rejects(api.analyzeStory("conn", "short source"), /truncated/i); assert.equal(calls.filter((call) => call.path === "/agents/suite/rewrite").length, 1); assert.equal(api.getLastRawResponse(), truncated);
});

test("complete JSON inside Markdown is parsed without a repair call", async () => {
  const { api, calls } = harness({ rewrites: [`Result:\n\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``] }); const result = await api.analyzeStory("conn", "short source"); assert.equal(result.title, analysis.title); assert.equal(calls.filter((call) => call.path === "/agents/suite/rewrite").length, 1);
});

test("saved classification instructions are sent to every progressive analysis block", async () => {
  const source = `# Opening\n${"A".repeat(6_500)}\n\n# Later\n${"B".repeat(6_500)}`; const policy = "PUBLIC = opening knowledge. PRIVATE = hidden relationships. UNCERTAIN = unconfirmed claims."; const shared = harness(); await shared.api.analyzeStory("conn", source, "character_focus", { classificationInstructions: policy });
  const calls = shared.calls.filter((call) => call.path === "/agents/suite/rewrite"); assert.ok(calls.length > 1); assert.ok(calls.every((call) => call.body.instruction.includes(policy))); assert.ok(calls.every((call) => call.body.instruction.includes("fixed JSON shape")));
});

test("progressive analysis covers every source block and retries only the failed block", async () => {
  const source = ["# Opening\n", "A".repeat(6_500), "\n\n# Secret\n", "B".repeat(6_500)].join(""); const blocks = core.splitAnalysisSource(source); assert.ok(blocks.length > 1);
  const outputs = blocks.map(() => JSON.stringify(analysis)); outputs[1] = "not json"; outputs.splice(2, 0, JSON.stringify(analysis));
  const shared = harness({ rewrites: outputs }); let checkpoint; await assert.rejects(async () => { try { await shared.api.analyzeStory("conn", source); } catch (error) { checkpoint = error.analysisCheckpoint; throw error; } }, /block 2/i);
  assert.equal(checkpoint.completedBlocks, 1); const callsBeforeRetry = shared.calls.filter((call) => call.path === "/agents/suite/rewrite"); const failedText = callsBeforeRetry.at(-1).body.selectedText;
  const result = await shared.api.analyzeStory("conn", source, "character_focus", { resume: checkpoint }); const retryCalls = shared.calls.filter((call) => call.path === "/agents/suite/rewrite").slice(callsBeforeRetry.length); assert.equal(retryCalls[0].body.selectedText, failedText); assert.equal(result.title, analysis.title);
  const completedTexts = [callsBeforeRetry[0].body.selectedText, ...retryCalls.map((call) => call.body.selectedText)]; assert.equal(completedTexts.join(""), source);
});

test("block 1 of 2 truncated in candidateBeats is recursively subdivided without repeating its original size", async () => {
  const source = `# Opening\n${"A".repeat(6_000)}\n\n# Future\n${"B".repeat(5_000)}`; const initialBlocks = core.splitAnalysisSource(source); assert.equal(initialBlocks.length, 2);
  const truncated = `${JSON.stringify(analysis).split('"candidateBeats"')[0]}"candidateBeats":[{"id":"cut"`; const progress = []; const shared = harness({ rewrites: [{ rewrittenText: truncated, finishReason: "length" }, { rewrittenText: truncated, finishReason: "length" }, JSON.stringify(analysis), JSON.stringify(analysis), JSON.stringify(analysis), JSON.stringify(analysis)] });
  const result = await shared.api.analyzeStory("conn", source, "character_focus", { onProgress: (event) => progress.push(event) }); const calls = shared.calls.filter((call) => call.path === "/agents/suite/rewrite"); const original = initialBlocks[0].text;
  assert.equal(calls.length, 6); assert.equal(calls[0].body.selectedText, original); assert.equal(calls.filter((call) => call.body.selectedText === original).length, 1); const firstChild = calls[1].body.selectedText; assert.ok(firstChild.length < original.length); assert.equal(calls.filter((call) => call.body.selectedText === firstChild).length, 1); assert.equal(calls[2].body.selectedText + calls[3].body.selectedText, firstChild); assert.equal(calls[2].body.selectedText + calls[3].body.selectedText + calls[4].body.selectedText, original); assert.equal(calls[5].body.selectedText, initialBlocks[1].text);
  assert.ok(progress.some((event) => event.subdivided && event.blockPath === "1")); assert.ok(progress.some((event) => event.subdivided && event.blockPath === "1.1")); assert.ok(progress.some((event) => event.autoSubdivided && event.blockPath === "1.1.1")); assert.equal(result.title, analysis.title);
});

test("large artificial story is extracted progressively without one giant response", async () => {
  const source = Array.from({ length: 190 }, (_, index) => `## Scene ${index + 1}\nThe fictional courier observes marker ${index + 1}, while the harbor record keeps its public and private implications distinct.`).join("\n\n");
  assert.ok(source.length > 16_000 && source.length < 50_000); const shared = harness(); const result = await shared.api.analyzeStory("conn", source); const calls = shared.calls.filter((call) => call.path === "/agents/suite/rewrite");
  assert.ok(calls.length > 2); assert.equal(calls.map((call) => call.body.selectedText).join(""), source); assert.ok(calls.slice(1).every((call) => call.body.contextSections?.[0]?.content.includes("## Scene"))); assert.equal(result.projectType, "character_focus"); assert.ok(result.facts.length < source.split(/(?<=[.!?])\s+/).length);
});

test("raw analysis response remains in session memory only", async () => {
  const { api } = harness(); await api.analyzeStory("conn", "source"); assert.match(api.getLastRawResponse(), /Test project/); api.clearLastRawResponse(); assert.equal(api.getLastRawResponse(), "");
});

test("API never creates or patches agent configuration", async () => {
  const { api, calls } = harness(); await api.getAgentStatuses("chat-a"); await api.syncProjectLorebook(project()); await api.updateChatActivation("chat-a", true);
  assert.ok(!calls.some((call) => call.method === "POST" && call.path === "/agents")); assert.ok(!calls.some((call) => call.method === "PATCH" && call.path.startsWith("/agents/")));
});

test("one chat-scoped lorebook stores separate guarded Director and Tracker entries", async () => {
  const shared = harness(); const synced = await shared.api.syncProjectLorebook(project()); const rows = shared.lorebooks.get(synced.lorebookId);
  assert.equal(shared.lorebooks.size, 1); assert.equal(rows.length, 2); assert.deepEqual(rows.map((row) => row.keys), [[core.NEVER_MATCH_REGEX], [core.NEVER_MATCH_REGEX]]);
  assert.ok(rows.every((row) => row.useRegex && row.excludeFromVectorization && row.preventRecursion && row.constant === false));
  assert.match(rows.find((row) => row.name === core.DIRECTOR_LOREBOOK_SENTINEL).content, /Private truth/);
  assert.doesNotMatch(rows.find((row) => row.name === core.TRACKER_LOREBOOK_SENTINEL).content, /Private truth|Private document|Explicit reveal/);
  const loaded = await shared.api.loadProjectFromLorebook("chat-a"); assert.equal(loaded.project.id, project().id); assert.equal(loaded.project.intermediate.privateDocument, "Private document");
});

test("both agents share one transport lorebook without reusing or activating the public book", async () => {
  const shared = harness(); const book = await shared.api.createLorebook({ name: "Existing public book" }); await shared.api.createLorebookEntry(book.id, { name: "Public place", content: "Public", keys: ["place"] });
  shared.chatMetadata.activeLorebookIds = [book.id]; const value = project({ publicResourceIds: { lorebookId: book.id, characterIds: {}, entryIds: {} } }); const synced = await shared.api.syncProjectLorebook(value);
  assert.notEqual(synced.lorebookId, book.id); assert.equal(shared.lorebooks.size, 2); assert.equal(shared.lorebooks.get(synced.lorebookId).length, 2); assert.deepEqual(shared.chatMetadata.activeLorebookIds, [book.id]);
});

test("partial lorebook failure exposes Director success without deleting confirmed local state", async () => {
  const { api } = harness({ failTrackerEntry: true }); const before = project(); await assert.rejects(async () => { try { await api.syncProjectLorebook(before); } catch (error) { assert.equal(error.directorLorebookUpdated, true); throw error; } }, /tracker entry failed/); assert.equal(before.confirmedInitialState, null);
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
  const bad = "not json"; const { api, calls } = harness({ rewrites: [JSON.stringify(initialState), bad, JSON.stringify(initialState)] }); let checkpoint; await assert.rejects(async () => { try { await api.initializeFromChat("conn", project(), messages); } catch (error) { checkpoint = error.initializationCheckpoint; throw error; } }, /block 2/i);
  assert.ok(calls.filter((call) => call.path === "/agents/suite/rewrite").every((call) => call.body.selectedText.length <= 50_000 && call.body.instruction.length <= 4_000));
  const failedText = calls.filter((call) => call.path === "/agents/suite/rewrite").at(-1).body.selectedText; const before = calls.length; await api.initializeFromChat("conn", project(), messages, { resume: checkpoint }); const resumed = calls.slice(before).find((call) => call.path === "/agents/suite/rewrite"); assert.equal(resumed.body.selectedText, failedText);
});

test("cancellation returns no partial proposal", async () => {
  const controller = new AbortController(); const { api } = harness({ rewrites: [JSON.stringify(initialState)] }); controller.abort(); await assert.rejects(api.initializeFromChat("conn", project(), [{ id: "m", role: "user", content: "Hello" }], { signal: controller.signal }), /cancelled/i);
});
