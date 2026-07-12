const NarrativeDirectorStorage = (() => {
  "use strict";

  const DB_NAME = "marinara-extension-narrative-director";
  const DB_VERSION = 1;
  const STORE_STORIES = "stories";
  const STORE_META = "meta";

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted."));
    });
  }

  function createStore(indexedDB = globalThis.indexedDB) {
    if (!indexedDB) throw new Error("IndexedDB is unavailable in this browser.");
    let dbPromise;

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_STORIES)) db.createObjectStore(STORE_STORIES, { keyPath: "id" });
          if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open Narrative Director storage."));
      });
      return dbPromise;
    }

    async function listStories() {
      const db = await open();
      const transaction = db.transaction(STORE_STORIES, "readonly");
      const rows = await requestResult(transaction.objectStore(STORE_STORIES).getAll());
      await transactionDone(transaction);
      return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    async function getStory(id) {
      const db = await open();
      const transaction = db.transaction(STORE_STORIES, "readonly");
      const row = await requestResult(transaction.objectStore(STORE_STORIES).get(id));
      await transactionDone(transaction);
      return row || null;
    }

    async function saveStory(story) {
      const db = await open();
      const transaction = db.transaction(STORE_STORIES, "readwrite");
      transaction.objectStore(STORE_STORIES).put(story);
      await transactionDone(transaction);
      return story;
    }

    async function deleteStory(id) {
      const db = await open();
      const transaction = db.transaction(STORE_STORIES, "readwrite");
      transaction.objectStore(STORE_STORIES).delete(id);
      await transactionDone(transaction);
    }

    async function replaceStories(stories) {
      const db = await open();
      const transaction = db.transaction(STORE_STORIES, "readwrite");
      const store = transaction.objectStore(STORE_STORIES);
      store.clear();
      for (const story of stories) store.put(story);
      await transactionDone(transaction);
    }

    async function getMeta(key) {
      const db = await open();
      const transaction = db.transaction(STORE_META, "readonly");
      const row = await requestResult(transaction.objectStore(STORE_META).get(key));
      await transactionDone(transaction);
      return row?.value;
    }

    async function setMeta(key, value) {
      const db = await open();
      const transaction = db.transaction(STORE_META, "readwrite");
      transaction.objectStore(STORE_META).put({ key, value });
      await transactionDone(transaction);
    }

    return { open, listStories, getStory, saveStory, deleteStory, replaceStories, getMeta, setMeta };
  }

  return { DB_NAME, DB_VERSION, STORE_STORIES, STORE_META, createStore };
})();

globalThis.__NarrativeDirectorStorage = NarrativeDirectorStorage;
