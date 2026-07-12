import test from "node:test";
import assert from "node:assert/strict";

await import("../src/core.js");
await import("../src/api.js");
const core = globalThis.__NarrativeDirectorCore;

function createHarness(chatMetadata, harnessOptions = {}) {
  const calls = [];
  const marinara = {
    async apiFetch(path, options = {}) {
      calls.push({ path, options, body: options.body ? JSON.parse(options.body) : null });
      if (path === "/agents" && options.method === "POST") {
        return { id: `agent-${calls.length}`, type: JSON.parse(options.body).type };
      }
      if (path === "/agents") return harnessOptions.agents || [];
      if (path === "/agents/suite/rewrite") {
        if (harnessOptions.analysisError) return { error: harnessOptions.analysisError };
        return { rewrittenText: harnessOptions.initializationResponse || harnessOptions.analysisResponse || "{}" };
      }
      if (path === "/chats/chat-1/messages") return harnessOptions.messages || [];
      if (path === "/characters" && options.method === "POST") return { id: "created-character" };
      if (path === "/lorebooks" && options.method === "POST") return { id: "created-lorebook" };
      if (path === "/lorebooks/created-lorebook/entries" && options.method === "POST") return { id: "created-entry" };
      if (path === "/chats/chat-1") return { id: "chat-1", characterIds: ["existing-character"], metadata: JSON.stringify(chatMetadata) };
      if (path === "/chats/chat-1" && options.method === "PATCH") return { id: "chat-1" };
      if (path === "/chats/chat-1/metadata") return { ok: true };
      if (path === "/agents" && options.method === "POST") return { id: `agent-${calls.length}` };
      return { id: `agent-${calls.length}` };
    },
  };
  return { api: globalThis.__NarrativeDirectorApi.createApi(marinara), calls };
}

const story = core.createStory({
  id: "story-1",
  agentKey: "story-1",
  name: "API story",
  chatId: "chat-1",
  privateDocument: "SECRET",
  progressionProjection: "public stages",
  director: { connectionId: "director-connection" },
  tracker: { connectionId: "tracker-connection" },
});

test("activation patches type values while preserving existing active agents", async () => {
  const { api, calls } = createHarness({ enableAgents: true, activeAgentIds: ["director", "external-agent"] });
  await api.updateChatActivation("chat-1", story, true);
  const patch = calls.find((call) => call.path.endsWith("/metadata"));
  assert.deepEqual(patch.body.activeAgentIds, [
    "director",
    "external-agent",
    "narrative-director-director-story-1",
    "narrative-director-tracker-story-1",
  ]);
  assert.equal(patch.body.enableAgents, true);
});

test("deactivation removes only this story types", async () => {
  const types = core.storyTypes(story);
  const { api, calls } = createHarness({ activeAgentIds: ["director", types.director, "external-agent", types.tracker] });
  await api.updateChatActivation("chat-1", story, false);
  const patch = calls.find((call) => call.path.endsWith("/metadata"));
  assert.deepEqual(patch.body.activeAgentIds, ["director", "external-agent"]);
  assert.equal("enableAgents" in patch.body, false);
});

test("creates Director and tracker through public agent API with separated private data", async () => {
  const { api, calls } = createHarness({ activeAgentIds: [] });
  const agents = await api.ensureAgents(story);
  const creates = calls.filter((call) => call.path === "/agents" && call.options.method === "POST");
  assert.equal(creates.length, 2);
  assert.equal(creates[0].body.phase, "pre_generation");
  assert.equal(creates[0].body.resultType, "director_event");
  assert.equal(creates[0].body.settings.narrative.privateDocument, "SECRET");
  assert.equal(creates[1].body.phase, "post_processing");
  assert.equal(creates[1].body.resultType, "custom_tracker_update");
  assert.equal(JSON.stringify(creates[1].body).includes("SECRET"), false);
  assert.ok(agents.director.id && agents.tracker.id);
});

const analysisResponse = JSON.stringify({
  suggestedStoryName: "Analyzed story",
  storySummary: "Summary",
  characterInformation: "Character facts",
  cardAdditions: "Durable facts",
  lorebookEntries: [{ name: "Place", description: "Place summary", content: "Place lore", keys: ["place"] }],
  privateDirectorDocument: "Complete private plan",
  trackerProjection: "stage_one; reveal_place_seen",
});

test("analysis is called only after explicit analyzeStory invocation", async () => {
  const { api, calls } = createHarness({}, { analysisResponse });
  assert.equal(calls.length, 0);
  const result = await api.analyzeStory("analysis-connection", "Source story text");
  assert.equal(calls.filter((call) => call.path === "/agents/suite/rewrite").length, 1);
  assert.equal(result.storySummary, "Summary");
});

test("analysis surfaces connection errors and invalid responses", async () => {
  const failed = createHarness({}, { analysisError: "Provider unavailable" });
  await assert.rejects(() => failed.api.analyzeStory("analysis-connection", "Source"), /Provider unavailable/);

  const invalid = createHarness({}, { analysisResponse: "invalid response" });
  await assert.rejects(() => invalid.api.analyzeStory("analysis-connection", "Source"), /did not contain a JSON/);
});

test("creates public resources and associates them while preserving chat IDs", async () => {
  const { api, calls } = createHarness({ activeLorebookIds: ["existing-lorebook"], excludedLorebookIds: ["created-lorebook"] });
  assert.equal(calls.length, 0, "no public write happens without an explicit API invocation");
  const character = await api.createCharacter({ data: { name: "Mara", description: "Public" } });
  const lorebook = await api.createLorebook({ name: "World", description: "Public", category: "world" });
  const entry = await api.createLorebookEntry(lorebook.id, { name: "Place", content: "Public lore" });
  await api.associateCharacterWithChat("chat-1", character.id);
  await api.associateLorebookWithChat("chat-1", lorebook.id);
  assert.equal(entry.id, "created-entry");
  const chatPatch = calls.find((call) => call.path === "/chats/chat-1" && call.options.method === "PATCH");
  assert.deepEqual(chatPatch.body.characterIds, ["existing-character", "created-character"]);
  const metadataPatch = calls.find((call) => call.path === "/chats/chat-1/metadata" && call.body.activeLorebookIds);
  assert.deepEqual(metadataPatch.body.activeLorebookIds, ["existing-lorebook", "created-lorebook"]);
  assert.deepEqual(metadataPatch.body.excludedLorebookIds, []);
});

const initializationResponse = JSON.stringify({
  happenedSummary: "Confirmed history",
  currentPoint: "Current point",
  occurredEvents: ["event_one"],
  pendingEvents: ["future_event"],
  revealedSecrets: [],
  blockedSecrets: [{ id: "secret_one", label: "Secret remains locked" }],
  characterStates: [{ name: "Mara", state: "Present" }],
  trackerProgression: { currentStage: "stage_one", revealedEvents: ["event_one"] },
});

test("existing-chat analysis reads messages only after explicit invocation", async () => {
  const messages = [{ id: "message-1", role: "assistant", content: "Active content", activeSwipeIndex: 1 }];
  const { api, calls } = createHarness({}, { messages, initializationResponse });
  assert.equal(calls.length, 0);
  const loaded = await api.listChatMessages("chat-1");
  const result = await api.initializeFromChat("analysis-connection", story, loaded);
  assert.equal(result.messageCount, 1);
  assert.equal(result.initialState.currentPoint, "Current point");
  assert.deepEqual(calls.map((call) => [call.path, call.options.method || "GET"]), [
    ["/chats/chat-1/messages", "GET"],
    ["/agents/suite/rewrite", "POST"],
  ]);
  assert.equal(calls.some((call) => /messages/.test(call.path) && call.options.method !== undefined), false);
});

test("invalid initialization response fails without changing the existing story", async () => {
  const before = structuredClone(story);
  const { api } = createHarness({}, { messages: [{ id: "m", role: "user", content: "Hi" }], initializationResponse: "invalid" });
  const loaded = await api.listChatMessages("chat-1");
  await assert.rejects(() => api.initializeFromChat("analysis-connection", story, loaded), /did not contain a JSON/);
  assert.deepEqual(story, before);
});

test("confirmed initialization updates existing agents by type without duplicating them", async () => {
  const initializedStory = core.createStory({ ...story, confirmedInitialState: JSON.parse(initializationResponse) });
  const types = core.storyTypes(initializedStory);
  const { api, calls } = createHarness({}, {
    agents: [{ id: "director-existing", type: types.director }, { id: "tracker-existing", type: types.tracker }],
  });
  await api.ensureAgents(initializedStory);
  assert.equal(calls.filter((call) => call.path === "/agents" && call.options.method === "POST").length, 0);
  assert.deepEqual(calls.filter((call) => call.options.method === "PATCH").map((call) => call.path), [
    "/agents/director-existing",
    "/agents/tracker-existing",
  ]);
  assert.equal(calls.some((call) => call.path.endsWith("/metadata")), false, "agents are not activated automatically");
});
