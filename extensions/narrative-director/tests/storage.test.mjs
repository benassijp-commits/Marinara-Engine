import test from "node:test";
import assert from "node:assert/strict";
import { createFakeIndexedDB } from "./fake-indexeddb.mjs";
await import("../src/core.js"); await import("../src/storage.js");
const core = globalThis.__NarrativeDirectorCore; const factory = globalThis.__NarrativeDirectorStorage;
const story = { title: "Stored", mainCharacterId: "", worldCard: { name: "Stored", description: "", personality: "", scenario: "" }, characters: [], worldEntries: [], directorGuide: "", secrets: [], storylines: [] };

test("IndexedDB stores v3 projects and local analysis rules", async () => { const store = factory.createStore(createFakeIndexedDB()); const project = core.createProject({ id: "p", story }); await store.saveProject(project); assert.equal((await store.getProject("p")).schemaVersion, 3); await store.setMeta("analysisRulesV3", "Custom rules"); assert.equal(await store.getMeta("analysisRulesV3"), "Custom rules"); });

test("loading a local v2 project returns a deterministic v3 migration", async () => { const store = factory.createStore(createFakeIndexedDB()); await store.saveProject({ id: "old", schemaVersion: 2, name: "Old", intermediate: { title: "Old", publicPremise: "Opening", characters: [], secrets: [], narrativeArcs: [] } }); const loaded = await store.getProject("old"); assert.equal(loaded.schemaVersion, 3); assert.equal(loaded.story.title, "Old"); assert.equal(loaded.story.worldCard.description, "Opening"); assert.equal(loaded.needsReview, true); });

test("replaceProjects atomically replaces local drafts", async () => { const store = factory.createStore(createFakeIndexedDB()); await store.saveProject(core.createProject({ id: "old", story })); await store.replaceProjects([core.createProject({ id: "a", story }), core.createProject({ id: "b", story })]); assert.deepEqual((await store.listProjects()).map((row) => row.id).sort(), ["a", "b"]); });
