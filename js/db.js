/**
 * db.js — Local offline database (IndexedDB)
 * Every read/write in the app goes through here FIRST.
 * The network (api.js/sync.js) is a background concern layered on top.
 */
const DB_NAME = 'ledger-db';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('transactions')) {
        const store = db.createObjectStore('transactions', { keyPath: 'id' });
        store.createIndex('by_date', 'txn_date');
        store.createIndex('by_updated', 'updated_at');
        store.createIndex('by_synced', 'synced');
      }

      if (!db.objectStoreNames.contains('categories')) {
        const store = db.createObjectStore('categories', { keyPath: 'id' });
        store.createIndex('by_updated', 'updated_at');
        store.createIndex('by_synced', 'synced');
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const Store = {
  async put(storeName, record) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.put(record));
  },

  async bulkPut(storeName, records) {
    const store = await tx(storeName, 'readwrite');
    return Promise.all(records.map((r) => promisify(store.put(r))));
  },

  async get(storeName, id) {
    const store = await tx(storeName);
    return promisify(store.get(id));
  },

  async getAll(storeName) {
    const store = await tx(storeName);
    return promisify(store.getAll());
  },

  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.delete(id));
  },

  async getUnsynced(storeName) {
    const all = await Store.getAll(storeName);
    return all.filter((r) => r.synced === 0);
  },

  async getMeta(key) {
    const row = await Store.get('meta', key);
    return row ? row.value : null;
  },

  async setMeta(key, value) {
    return Store.put('meta', { key, value });
  },

  async clearStore(storeName) {
    const store = await tx(storeName, 'readwrite');
    return promisify(store.clear());
  },
};

// Wipes locally-cached transactions/categories/sync markers. Used when
// switching accounts on a shared device so one person never sees another
// person's data before a fresh sync pulls the right owner's records.
async function clearLocalData() {
  await Store.clearStore('transactions');
  await Store.clearStore('categories');
  await Store.clearStore('meta');
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO() {
  return new Date().toISOString();
}
