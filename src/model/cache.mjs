// Device-local compressed cache only. Storage failure must not block viewing.
const BUDGET = 48 * 1024 ** 2;
export class ModelCache {
  async open() {
    if (!globalThis.indexedDB) return null;
    return new Promise(resolve => {
      let done = false;
      const finish = db => { if (done) { db?.close(); return; } done = true; clearTimeout(timer); resolve(db); };
      const timer = setTimeout(() => finish(null), 1500);
      const request = indexedDB.open('dfm-models-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('maps', { keyPath: 'name' });
      request.onerror = request.onblocked = () => finish(null);
      request.onsuccess = () => finish(request.result);
    });
  }
  async get(name, version) {
    let db;
    try {
      db = await this.open();
      if (!db) return null;
      return await new Promise(resolve => {
        const tx = db.transaction('maps', 'readwrite'), store = tx.objectStore('maps');
        const request = store.get(name);
        let bytes = null;
        request.onsuccess = () => {
          if (request.result?.version === version) {
            bytes = request.result.data;
            store.put({ ...request.result, usedAt: Date.now() });
          }
        };
        tx.oncomplete = () => resolve(bytes);
        tx.onerror = tx.onabort = () => resolve(null);
      });
    } catch { return null; } finally { db?.close(); }
  }
  async put(name, version, data) {
    let db;
    try {
      if (data.byteLength > BUDGET) return;
      db = await this.open();
      if (!db) return;
      await new Promise(resolve => {
        const tx = db.transaction('maps', 'readwrite'), store = tx.objectStore('maps');
        const request = store.getAll();
        request.onsuccess = () => {
          const retained = request.result.filter(x => x.name !== name).sort((a, b) => b.usedAt - a.usedAt);
          let bytes = data.byteLength, count = 1;
          for (const record of retained) {
            if (count >= 2 || bytes + record.data.byteLength > BUDGET) store.delete(record.name);
            else { count++; bytes += record.data.byteLength; }
          }
          store.put({ name, version, data, usedAt: Date.now() });
        };
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      });
    } catch { /* Private browsing, quota, storage disabled. */ } finally { db?.close(); }
  }
  async remove(name) {
    let db;
    try {
      db = await this.open();
      if (!db) return;
      await new Promise(resolve => {
        const tx = db.transaction('maps', 'readwrite');
        tx.objectStore('maps').delete(name);
        tx.oncomplete = tx.onerror = tx.onabort = resolve;
      });
    } catch {} finally { db?.close(); }
  }
}
