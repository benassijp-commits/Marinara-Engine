import test from "node:test";
import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./fake-indexeddb.mjs";
await import("../src/core.js"); await import("../src/storage.js");
const core = globalThis.__NarrativeDirectorCore; const factory = globalThis.__NarrativeDirectorStorage;
const story = { title: "Stored", mainCharacterId: "", worldCard: { name: "Stored", description: "", personality: "", scenario: "" }, characters: [], relationships: [], worldEntries: [], curatorGuide: "", secrets: [], storylines: [] };

test("IndexedDB uses isolated v4 storage", async () => { assert.equal(factory.DB_NAME, "marinara-extension-narrative-curator-v4"); const store = factory.createStore(createFakeIndexedDB()); const project = core.createProject({ id: "p", story }); await store.saveProject(project); assert.equal((await store.getProject("p")).schemaVersion, 4); await store.setMeta("analysisRulesV4", "Custom rules"); assert.equal(await store.getMeta("analysisRulesV4"), "Custom rules"); });

test("replaceProjects atomically replaces local v4 drafts", async () => { const store = factory.createStore(createFakeIndexedDB()); await store.saveProject(core.createProject({ id: "old", story })); await store.replaceProjects([core.createProject({ id: "a", story }), core.createProject({ id: "b", story })]); assert.deepEqual((await store.listProjects()).map((row) => row.id).sort(), ["a", "b"]); });
