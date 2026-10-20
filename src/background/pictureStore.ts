/**
 * Walkthrough pictures, kept by the service worker in IndexedDB (they outlive the worker being
 * stopped, and the page that took them when a link loads the next one). Keyed by session and
 * picture key; a session's pictures go when its walkthrough is discarded, replaced, its tab is
 * closed, or after a day.
 */

interface Stored {
  id: string;
  session: string;
  blob: Blob;
  at: number;
}

const DB = 'chrome-design';
const STORE = 'pictures';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('session', 'session');
      store.createIndex('at', 'at');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = work(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const idOf = (session: string, key: string) => `${session}/${key}`;

export function putPicture(session: string, key: string, blob: Blob): Promise<unknown> {
  return run('readwrite', (s) =>
    s.put({ id: idOf(session, key), session, blob, at: Date.now() } satisfies Stored),
  );
}

export async function getPicture(session: string, key: string): Promise<Blob | null> {
  const found = (await run('readonly', (s) => s.get(idOf(session, key)))) as Stored | undefined;
  return found?.blob ?? null;
}

/** Delete pictures by a test on each one (a cursor over the session, or over all). */
async function removeWhere(
  range: { session: string } | { before: number },
  drop: (p: Stored) => boolean,
): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req =
      'session' in range
        ? store.index('session').openCursor(IDBKeyRange.only(range.session))
        : store.index('at').openCursor(IDBKeyRange.upperBound(range.before));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (drop(cursor.value as Stored)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** A session's pictures, all of them or all but `keep`. */
export function removeSession(session: string, keep?: ReadonlySet<string>): Promise<void> {
  return removeWhere({ session }, (p) => !keep?.has(p.id.slice(session.length + 1)));
}

/** Anything left over from a day ago (a crash, a closed window). */
export function removeOld(): Promise<void> {
  return removeWhere({ before: Date.now() - MAX_AGE_MS }, () => true);
}
