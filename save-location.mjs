const DATABASE = "conversation-viewer";
const STORE = "file-handles";
const KEY = "markdown-transcript";

export class FileHandleStore {
  constructor(indexedDB = globalThis.indexedDB) {
    this.indexedDB = indexedDB;
  }

  async get() {
    if (!this.indexedDB) return null;
    const database = await this.#open();
    try {
      return await requestResult(database.transaction(STORE).objectStore(STORE).get(KEY));
    } finally {
      database.close();
    }
  }

  async set(handle) {
    if (!this.indexedDB) return;
    const database = await this.#open();
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(handle, KEY);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  }

  #open() {
    return new Promise((resolve, reject) => {
      const request = this.indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
