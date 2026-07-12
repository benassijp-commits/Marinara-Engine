import test from "node:test";
import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./fake-indexeddb.mjs";

await import("../src/core.js");
await import("../src/storage.js");
const core = globalThis.__NarrativeDirectorCore;

test("IndexedDB store creates, edits, lists and deletes stories", async () => {
  const store = globalThis.__NarrativeDirectorStorage.createStore(createFakeIndexedDB());
  const story = core.createStory({ id: "indexed-story", name: "Indexed story" });
  await store.saveStory(story);
  assert.equal((await store.getStory(story.id)).name, "Indexed story");
  assert.equal((await store.listStories()).length, 1);

  await store.saveStory({ ...story, name: "Edited story", updatedAt: "2099-01-01T00:00:00.000Z" });
  assert.equal((await store.getStory(story.id)).name, "Edited story");

  await store.setMeta("lastStoryId", story.id);
  assert.equal(await store.getMeta("lastStoryId"), story.id);

  await store.deleteStory(story.id);
  assert.equal(await store.getStory(story.id), null);
  assert.deepEqual(await store.listStories(), []);
});

test("IndexedDB store atomically replaces imported stories", async () => {
  const store = globalThis.__NarrativeDirectorStorage.createStore(createFakeIndexedDB());
  await store.saveStory(core.createStory({ id: "old", name: "Old" }));
  await store.replaceStories([
    core.createStory({ id: "new-1", name: "New one" }),
    core.createStory({ id: "new-2", name: "New two" }),
  ]);
  const rows = await store.listStories();
  assert.deepEqual(rows.map((row) => row.id).sort(), ["new-1", "new-2"]);
});

test("analyzed result is saved and remains manually editable", async () => {
  const store = globalThis.__NarrativeDirectorStorage.createStore(createFakeIndexedDB());
  const original = core.createStory({ id: "analysis-story", name: "Before", sourceText: "Original source" });
  const analyzed = core.applyAnalysis(original, {
    suggestedStoryName: "After analysis",
    storySummary: "Generated summary",
    characterInformation: "Generated character information",
    cardAdditions: "Generated card proposal",
    lorebookEntries: [],
    privateDirectorDocument: "Private plan",
    trackerProjection: "stage_one",
  });
  await store.saveStory(analyzed);
  const loaded = await store.getStory(original.id);
  assert.equal(loaded.sourceText, "Original source");
  assert.equal(loaded.storySummary, "Generated summary");
  await store.saveStory({ ...loaded, storySummary: "Manually edited summary" });
  assert.equal((await store.getStory(original.id)).storySummary, "Manually edited summary");
});

test("public resource IDs and partial entry progress survive local persistence", async () => {
  const store = globalThis.__NarrativeDirectorStorage.createStore(createFakeIndexedDB());
  const story = core.createStory({
    id: "application-story",
    name: "Applied story",
    createdCharacterId: "character-created",
    createdLorebookId: "lorebook-created",
    createdLorebookEntryIds: { 0: "entry-created" },
    applicationLog: [core.applicationLogEntry({
      operation: "create_lorebook_entry",
      status: "error",
      stage: "entry_2",
      error: "Temporary failure",
    })],
  });
  await store.saveStory(story);
  const loaded = core.createStory(await store.getStory(story.id));
  assert.equal(loaded.createdCharacterId, "character-created");
  assert.equal(loaded.createdLorebookId, "lorebook-created");
  assert.deepEqual(loaded.createdLorebookEntryIds, { 0: "entry-created" });
  assert.equal(loaded.applicationLog[0].stage, "entry_2");
});

test("an initialization proposal is not persisted until explicit confirmation", async () => {
  const store = globalThis.__NarrativeDirectorStorage.createStore(createFakeIndexedDB());
  const original = core.createStory({ id: "existing-chat-story", name: "Existing chat", privateDocument: "Private" });
  await store.saveStory(original);
  const proposal = {
    happenedSummary: "Occurred",
    currentPoint: "Current",
    occurredEvents: [], pendingEvents: [], revealedSecrets: [], blockedSecrets: [], characterStates: [],
    trackerProgression: { currentStage: "stage", revealedEvents: [] },
  };
  assert.equal((await store.getStory(original.id)).confirmedInitialState, null, "cancel/no confirmation leaves storage unchanged");
  await store.saveStory(core.createStory({ ...original, confirmedInitialState: proposal, initializedChatId: "chat-1" }));
  assert.equal((await store.getStory(original.id)).confirmedInitialState.currentPoint, "Current");
});
