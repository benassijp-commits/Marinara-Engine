export function createFakeIndexedDB() {
  const databases = new Map();

  class FakeTransaction {
    constructor(db, stores) {
      this.db = db;
      this.stores = stores;
      this.error = null;
      this.pending = 0;
      this.scheduled = false;
    }

    objectStore(name) {
      if (!this.stores.includes(name)) throw new Error(`Unknown store: ${name}`);
      const data = this.db.stores.get(name);
      const keyPath = this.db.keyPaths.get(name);
      const request = (operation) => {
        const req = {};
        this.pending++;
        setTimeout(() => {
          try {
            req.result = operation();
            req.onsuccess?.();
          } catch (error) {
            req.error = error;
            this.error = error;
            req.onerror?.();
            this.onerror?.();
          } finally {
            this.pending--;
            this.scheduleComplete();
          }
        }, 0);
        return req;
      };
      const write = (operation) => {
        this.pending++;
        setTimeout(() => {
          try { operation(); }
          catch (error) { this.error = error; this.onerror?.(); }
          finally { this.pending--; this.scheduleComplete(); }
        }, 0);
      };
      return {
        getAll: () => request(() => Array.from(data.values()).map(clone)),
        get: (key) => request(() => clone(data.get(key))),
        put: (value) => write(() => data.set(value[keyPath], clone(value))),
        delete: (key) => write(() => data.delete(key)),
        clear: () => write(() => data.clear()),
      };
    }

    scheduleComplete() {
      if (this.pending || this.scheduled) return;
      this.scheduled = true;
      setTimeout(() => {
        if (!this.pending && !this.error) this.oncomplete?.();
        this.scheduled = false;
      }, 0);
    }
  }

  class FakeDatabase {
    constructor() {
      this.stores = new Map();
      this.keyPaths = new Map();
      this.objectStoreNames = { contains: (name) => this.stores.has(name) };
    }
    createObjectStore(name, options) {
      this.stores.set(name, new Map());
      this.keyPaths.set(name, options.keyPath);
    }
    transaction(name) {
      const names = Array.isArray(name) ? name : [name];
      const transaction = new FakeTransaction(this, names);
      transaction.scheduleComplete();
      return transaction;
    }
  }

  return {
    open(name) {
      const request = {};
      setTimeout(() => {
        let db = databases.get(name);
        const fresh = !db;
        if (!db) {
          db = new FakeDatabase();
          databases.set(name, db);
        }
        request.result = db;
        if (fresh) request.onupgradeneeded?.();
        request.onsuccess?.();
      }, 0);
      return request;
    },
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
