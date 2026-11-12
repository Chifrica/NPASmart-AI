import { APP_CONFIG } from '../config.js';

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('This browser does not support IndexedDB. Please use a recent version of Chrome, Edge, Firefox or Safari.'));
      return;
    }
    const request = indexedDB.open(APP_CONFIG.databaseName, APP_CONFIG.databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(APP_CONFIG.storeName)) {
        const store = db.createObjectStore(APP_CONFIG.storeName, { keyPath: 'id' });
        store.createIndex('docDate', 'docDate', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('title', 'title', { unique: false });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
    };
    request.onblocked = () => reject(new Error('Close other NPASmart AI tabs to finish upgrading local document storage.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error('Could not open the local document database.'));
  });
  return databasePromise;
}

export async function saveDocument(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_CONFIG.storeName, 'readwrite');
    tx.objectStore(APP_CONFIG.storeName).put(record);
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error || new Error('Document could not be saved.'));
    tx.onabort = () => reject(tx.error || new Error('Document save was cancelled.'));
  });
}

export async function getAllDocuments() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_CONFIG.storeName, 'readonly');
    const request = tx.objectStore(APP_CONFIG.storeName).getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    request.onerror = () => reject(request.error || new Error('Could not load documents.'));
  });
}

export async function getDocument(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(APP_CONFIG.storeName, 'readonly').objectStore(APP_CONFIG.storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Could not retrieve document.'));
  });
}

export async function deleteDocument(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_CONFIG.storeName, 'readwrite');
    tx.objectStore(APP_CONFIG.storeName).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Could not delete document.'));
  });
}

export async function getAllFolders() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('folders', 'readonly').objectStore('folders').getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.name.localeCompare(b.name)));
    request.onerror = () => reject(request.error || new Error('Could not load folders.'));
  });
}

export async function saveFolder(folder) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('folders', 'readwrite');
    tx.objectStore('folders').put(folder);
    tx.oncomplete = () => resolve(folder);
    tx.onerror = () => reject(tx.error || new Error('Folder could not be saved.'));
    tx.onabort = () => reject(tx.error || new Error('Folder creation was cancelled.'));
  });
}
