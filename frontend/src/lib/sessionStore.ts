// IndexedDB persistence layer for participant survey sessions.
// Uses raw IndexedDB with promise wrappers — no dependencies.

const DB_NAME = "parlo-sessions";
const DB_VERSION = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionRecord {
  surveyCode: string;
  surveyId: string;
  responseId: string | null;
  responseCode: string | null;
  uploadUrls: Record<string, string> | null;
  uploadUrlsCreatedAt: number | null;
  stage: string;
  questionIndex: number;
  phone: string;
  firstName: string;
  lastName: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceAuthRecord {
  id: string; // random token
  phone: string;
  verifiedAt: number;
  apiKey?: string;
}

export interface AnswerRecord {
  id: string; // `${surveyCode}:${questionId}`
  surveyCode: string;
  questionId: string;
  blob: Blob | null;
  segmentBlobs: Array<{ blob: Blob; durationMs: number }> | null;
  durationMs: number;
  textContent: string | null;
  uploadStatus: "pending" | "uploading" | "uploaded" | "failed";
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Lazy singleton DB connection
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "surveyCode" });
      }

      if (!db.objectStoreNames.contains("answers")) {
        const answersStore = db.createObjectStore("answers", {
          keyPath: "id",
        });
        answersStore.createIndex("bySurveyCode", "surveyCode", {
          unique: false,
        });
      }

    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Run a read-only transaction and return a single result. */
function txGet<T>(
  storeName: string,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return getDB().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = op(store);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Run a read-only transaction and return all results from a request. */
function txGetAll<T>(
  storeName: string,
  op: (store: IDBObjectStore) => IDBRequest,
): Promise<T[]> {
  return getDB().then(
    (db) =>
      new Promise<T[]>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = op(store);
        req.onsuccess = () => resolve((req.result as T[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Run a readwrite transaction with one or more stores. */
function txWrite(
  storeNames: string | string[],
  op: (
    stores: Record<string, IDBObjectStore>,
    tx: IDBTransaction,
  ) => void,
): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        const tx = db.transaction(names, "readwrite");
        const stores: Record<string, IDBObjectStore> = {};
        for (const name of names) {
          stores[name] = tx.objectStore(name);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
        op(stores, tx);
      }),
  );
}

// ---------------------------------------------------------------------------
// Public API — Sessions
// ---------------------------------------------------------------------------

export function getSession(
  surveyCode: string,
): Promise<SessionRecord | null> {
  return txGet<SessionRecord>("sessions", (store) => store.get(surveyCode));
}

export function saveSession(session: SessionRecord): Promise<void> {
  return txWrite("sessions", (stores) => {
    stores.sessions.put(session);
  });
}

export function deleteSession(surveyCode: string): Promise<void> {
  return txWrite(["sessions", "answers"], (stores) => {
    stores.sessions.delete(surveyCode);

    // Delete all answers belonging to this session via the index.
    const index = stores.answers.index("bySurveyCode");
    const cursorReq = index.openCursor(IDBKeyRange.only(surveyCode));
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  });
}

export function getAllSessions(): Promise<SessionRecord[]> {
  return txGetAll<SessionRecord>("sessions", (store) => store.getAll());
}

export function cleanStaleSessions(maxAgeMs: number): Promise<void> {
  return getAllSessions().then(async (sessions) => {
    const now = Date.now();
    const stale = sessions.filter((s) => now - s.updatedAt > maxAgeMs);
    for (const s of stale) {
      await deleteSession(s.surveyCode);
    }
  });
}

// ---------------------------------------------------------------------------
// Public API — Answers
// ---------------------------------------------------------------------------

export function getAnswers(surveyCode: string): Promise<AnswerRecord[]> {
  return getDB().then(
    (db) =>
      new Promise<AnswerRecord[]>((resolve, reject) => {
        const tx = db.transaction("answers", "readonly");
        const store = tx.objectStore("answers");
        const index = store.index("bySurveyCode");
        const req = index.getAll(surveyCode);
        req.onsuccess = () => resolve((req.result as AnswerRecord[]) ?? []);
        req.onerror = () => reject(req.error);
      }),
  );
}

export function saveAnswer(answer: AnswerRecord): Promise<void> {
  return txWrite("answers", (stores) => {
    stores.answers.put(answer);
  });
}

export function deleteAnswer(
  surveyCode: string,
  questionId: string,
): Promise<void> {
  const id = `${surveyCode}:${questionId}`;
  return txWrite("answers", (stores) => {
    stores.answers.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Public API — Device Auth (localStorage — no IDB version bump needed)
// ---------------------------------------------------------------------------

const DEVICE_AUTH_KEY = "parlo-device-auth";
const DEVICE_AUTH_MAX_AGE_MS = Infinity; // permanent — never expires

export function getDeviceAuth(): Promise<DeviceAuthRecord | null> {
  try {
    const raw = localStorage.getItem(DEVICE_AUTH_KEY);
    if (!raw) return Promise.resolve(null);
    const record: DeviceAuthRecord = JSON.parse(raw);
    if (Date.now() - record.verifiedAt > DEVICE_AUTH_MAX_AGE_MS) {
      clearDeviceAuth();
      return Promise.resolve(null);
    }
    return Promise.resolve(record);
  } catch {
    return Promise.resolve(null);
  }
}

export function saveDeviceAuth(phone: string, apiKey?: string): Promise<void> {
  try {
    // Merge with existing record to preserve apiKey if not provided
    const existing = localStorage.getItem(DEVICE_AUTH_KEY);
    const prev = existing ? JSON.parse(existing) as DeviceAuthRecord : null;
    const record: DeviceAuthRecord = {
      id: "parlo-device",
      phone,
      verifiedAt: Date.now(),
      apiKey: apiKey ?? prev?.apiKey,
    };
    localStorage.setItem(DEVICE_AUTH_KEY, JSON.stringify(record));
  } catch {
    // localStorage not available (private browsing etc)
  }
  return Promise.resolve();
}

export function clearDeviceAuth(): Promise<void> {
  try {
    localStorage.removeItem(DEVICE_AUTH_KEY);
  } catch {
    // ignore
  }
  return Promise.resolve();
}

export function updateAnswerUploadStatus(
  surveyCode: string,
  questionId: string,
  status: AnswerRecord["uploadStatus"],
): Promise<void> {
  const id = `${surveyCode}:${questionId}`;
  return getDB().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction("answers", "readwrite");
        const store = tx.objectStore("answers");
        const getReq = store.get(id);

        getReq.onsuccess = () => {
          const record = getReq.result as AnswerRecord | undefined;
          if (!record) {
            reject(new Error(`Answer not found: ${id}`));
            return;
          }
          record.uploadStatus = status;
          record.updatedAt = Date.now();
          store.put(record);
        };

        getReq.onerror = () => reject(getReq.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }),
  );
}
