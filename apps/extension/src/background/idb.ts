/**
 * Tiny promise-based key/value store over IndexedDB, used to hold the dictionary
 * snapshot and the surface→lemma parse cache. A single object store keyed by
 * string is all we need. `memoryKvStore` is an in-memory twin for unit tests.
 */
export interface KvStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export function memoryKvStore(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (map.has(key) ? (map.get(key) as T) : null),
    set: async (key: string, value: unknown) => {
      map.set(key, value);
    },
    delete: async (key: string) => {
      map.delete(key);
    },
  };
}

function openDb(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function idbKvStore(dbName = 'primeran-miner', storeName = 'kv'): KvStore {
  // Lazy: the DB isn't opened until the first operation, so merely constructing
  // the store (e.g. as a default in a singleton) is safe in non-browser contexts.
  let dbPromise: Promise<IDBDatabase> | null = null;
  const getDb = () => (dbPromise ??= openDb(dbName, storeName));

  async function run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const db = await getDb();
    return new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(storeName, mode).objectStore(storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async get<T>(key: string) {
      return (await run<T | undefined>('readonly', (s) => s.get(key))) ?? null;
    },
    async set(key: string, value: unknown) {
      await run('readwrite', (s) => s.put(value, key));
    },
    async delete(key: string) {
      await run('readwrite', (s) => s.delete(key));
    },
  };
}
