const NarrativeDirectorStorage = (() => {
  "use strict";
  const DB_NAME = "marinara-extension-narrative-director-v2";
  const DB_VERSION = 1;
  const STORE_PROJECTS = "projects";
  const STORE_META = "meta";

  function result(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("IndexedDB request failed.")); }); }
  function done(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed.")); transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted.")); }); }

  function createStore(indexedDB = globalThis.indexedDB) {
    if (!indexedDB) throw new Error("IndexedDB is unavailable in this browser.");
    let dbPromise;
    function open() {
      if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: "id" }); if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" }); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("Could not open Narrative Director storage."));
      });
      return dbPromise;
    }
    async function listProjects() { const db = await open(); const tx = db.transaction(STORE_PROJECTS, "readonly"); const rows = await result(tx.objectStore(STORE_PROJECTS).getAll()); await done(tx); return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }
    async function getProject(id) { const db = await open(); const tx = db.transaction(STORE_PROJECTS, "readonly"); const row = await result(tx.objectStore(STORE_PROJECTS).get(id)); await done(tx); return row || null; }
    async function saveProject(project) { const db = await open(); const tx = db.transaction(STORE_PROJECTS, "readwrite"); tx.objectStore(STORE_PROJECTS).put(project); await done(tx); return project; }
    async function deleteProject(id) { const db = await open(); const tx = db.transaction(STORE_PROJECTS, "readwrite"); tx.objectStore(STORE_PROJECTS).delete(id); await done(tx); }
    async function replaceProjects(projects) { const db = await open(); const tx = db.transaction(STORE_PROJECTS, "readwrite"); const store = tx.objectStore(STORE_PROJECTS); store.clear(); for (const project of projects) store.put(project); await done(tx); }
    async function getMeta(key) { const db = await open(); const tx = db.transaction(STORE_META, "readonly"); const row = await result(tx.objectStore(STORE_META).get(key)); await done(tx); return row?.value; }
    async function setMeta(key, value) { const db = await open(); const tx = db.transaction(STORE_META, "readwrite"); tx.objectStore(STORE_META).put({ key, value }); await done(tx); }
    return { open, listProjects, getProject, saveProject, deleteProject, replaceProjects, getMeta, setMeta };
  }
  return { DB_NAME, DB_VERSION, STORE_PROJECTS, STORE_META, createStore };
})();

globalThis.__NarrativeDirectorStorage = NarrativeDirectorStorage;
