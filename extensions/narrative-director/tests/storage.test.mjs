import test from "node:test";
import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./fake-indexeddb.mjs";
await import("../src/core.js"); await import("../src/storage.js");
const core = globalThis.__NarrativeDirectorCore;
const storageFactory = globalThis.__NarrativeDirectorStorage;

test("IndexedDB v2 creates, edits, lists and deletes local project drafts", async () => {
  const store = storageFactory.createStore(createFakeIndexedDB()); const project = core.createProject({ id: "project-a", name: "Project A" });
  await store.saveProject(project); assert.equal((await store.getProject(project.id)).name, "Project A"); assert.equal((await store.listProjects()).length, 1);
  await store.saveProject({ ...project, name: "Edited", updatedAt: "2099-01-01T00:00:00.000Z" }); assert.equal((await store.getProject(project.id)).name, "Edited");
  await store.setMeta("lastProjectId", project.id); assert.equal(await store.getMeta("lastProjectId"), project.id);
  await store.deleteProject(project.id); assert.equal(await store.getProject(project.id), null);
});

test("replaceProjects atomically replaces imported v2 drafts", async () => {
  const store = storageFactory.createStore(createFakeIndexedDB()); await store.saveProject(core.createProject({ id: "old" }));
  await store.replaceProjects([core.createProject({ id: "new-a" }), core.createProject({ id: "new-b" })]); assert.deepEqual((await store.listProjects()).map((row) => row.id).sort(), ["new-a", "new-b"]);
});

test("analysis classification instructions persist as a local setting", async () => {
  const store = storageFactory.createStore(createFakeIndexedDB()); const value = "PUBLIC = opening knowledge only. PRIVATE = hidden information."; await store.setMeta("analysisClassificationInstructions", value); assert.equal(await store.getMeta("analysisClassificationInstructions"), value);
});

test("confirmed state and public and agent-lorebook IDs survive local persistence", async () => {
  const store = storageFactory.createStore(createFakeIndexedDB()); const confirmedInitialState = { happenedSummary: "Started", currentPoint: "Gate", occurredEvents: [], pendingEventIds: [], revealedSecretIds: [], blockedSecretIds: [], characterStates: [], confirmedFacts: [] };
  const project = core.createProject({ id: "stateful", confirmedInitialState, publicResourceIds: { characterIds: { lead: "char-a" }, lorebookId: "book-a", entryIds: { harbor: "entry-a" } }, agentLorebookId: "book-agent", agentEntryIds: { director: "entry-director", tracker: "entry-tracker" } });
  await store.saveProject(project); const loaded = core.createProject(await store.getProject(project.id)); assert.equal(loaded.confirmedInitialState.currentPoint, "Gate"); assert.deepEqual(loaded.publicResourceIds.characterIds, { lead: "char-a" }); assert.equal(loaded.agentLorebookId, "book-agent"); assert.deepEqual(loaded.agentEntryIds, { director: "entry-director", tracker: "entry-tracker" });
});

test("raw responses and removed agent configuration fields are never persisted", async () => {
  const store = storageFactory.createStore(createFakeIndexedDB()); const project = core.createProject({ id: "clean", rawAnalysisResponse: "RAW PRIVATE", analysisCheckpoint: { rawResponse: "PARTIAL PRIVATE", partials: [{ privateDocument: "PRIVATE BLOCK" }] }, director: { connectionId: "secret" }, tracker: { promptTemplate: "old" } });
  await store.saveProject(project); const serialized = JSON.stringify(await store.getProject(project.id)); assert.ok(!serialized.includes("RAW PRIVATE")); assert.ok(!serialized.includes("PARTIAL PRIVATE")); assert.ok(!serialized.includes("PRIVATE BLOCK")); assert.ok(!serialized.includes("analysisCheckpoint")); assert.ok(!serialized.includes("connectionId\":\"secret")); assert.ok(!serialized.includes("promptTemplate"));
});
