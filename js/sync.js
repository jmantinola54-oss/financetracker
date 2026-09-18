/**
 * sync.js — Two-way sync between IndexedDB and the Hostinger API.
 * Rule: local writes ALWAYS succeed immediately (offline-first).
 * Sync is a background reconciliation, never a blocker for the UI.
 *
 * Conflict rule: last-writer-wins, decided by updated_at timestamp.
 */
const Sync = {
  running: false,
  listeners: [],

  onStatusChange(fn) {
    Sync.listeners.push(fn);
  },
  emit(status) {
    Sync.listeners.forEach((fn) => fn(status));
  },

  async run() {
    if (Sync.running) return;
    if (!navigator.onLine) return Sync.emit('offline');
    if (!API.isConfigured()) return Sync.emit('unconfigured');

    Sync.running = true;
    Sync.emit('syncing');

    try {
      await Sync.syncStore('categories', API.pullCategories, API.pushCategories);
      await Sync.syncStore('transactions', API.pullTransactions, API.pushTransactions);
      await Store.setMeta('last_sync', nowISO());
      Sync.emit('synced');
    } catch (err) {
      console.error('Sync failed:', err);
      Sync.emit('error');
    } finally {
      Sync.running = false;
    }
  },

  async syncStore(storeName, pullFn, pushFn) {
    // 1. Push local unsynced records
    const unsynced = await Store.getUnsynced(storeName);
    if (unsynced.length) {
      await pushFn(unsynced);
      for (const rec of unsynced) {
        rec.synced = 1;
        await Store.put(storeName, rec);
      }
    }

    // 2. Pull remote changes since last sync
    const lastSync = await Store.getMeta(`last_sync_${storeName}`);
    const remote = await pullFn(lastSync);
    if (remote && remote.length) {
      for (const r of remote) {
        const local = await Store.get(storeName, r.id);
        // last-writer-wins: only overwrite if remote is newer (or we have nothing)
        if (!local || new Date(r.updated_at) >= new Date(local.updated_at)) {
          r.synced = 1;
          await Store.put(storeName, r);
        }
      }
    }
    await Store.setMeta(`last_sync_${storeName}`, nowISO());
  },
};

window.addEventListener('online', () => Sync.run());
