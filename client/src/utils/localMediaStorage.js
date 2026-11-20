const DATABASE_NAME = 'clipfinder-local-media';
const DIRECTORY_STORE = 'podcast-directories';

function openDatabase() {
  if (!globalThis.indexedDB) {
    throw new Error('This browser cannot remember local folders. Use desktop Chrome or Edge.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DIRECTORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local folder storage'));
  });
}

async function updateStoredDirectory(podcastId, directoryHandle, remove = false) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(DIRECTORY_STORE, 'readwrite');
      const store = transaction.objectStore(DIRECTORY_STORE);
      if (remove) store.delete(podcastId);
      else store.put(directoryHandle, podcastId);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Could not update local folder storage'));
      transaction.onabort = () => reject(transaction.error || new Error('Local folder storage was interrupted'));
    });
  } finally {
    database.close();
  }
}

export async function rememberPodcastDirectory(podcastId, directoryHandle) {
  await updateStoredDirectory(podcastId, directoryHandle);
}

async function loadPodcastDirectory(podcastId) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(DIRECTORY_STORE, 'readonly');
      const request = transaction.objectStore(DIRECTORY_STORE).get(podcastId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read the saved local folder'));
    });
  } finally {
    database.close();
  }
}

export async function chooseLocalMediaDirectory() {
  if (!globalThis.isSecureContext || typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Choose a local folder using desktop Chrome or Edge over HTTPS or localhost.');
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

async function requireWritePermission(directoryHandle) {
  let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
  }
  if (permission !== 'granted') {
    const error = new Error('Folder access was not granted. Choose the destination folder again.');
    error.code = 'LOCAL_FOLDER_PERMISSION_DENIED';
    throw error;
  }
}

export async function getPodcastDirectoryForWrite(podcastId) {
  let directoryHandle = await loadPodcastDirectory(podcastId);
  if (directoryHandle) {
    try {
      await requireWritePermission(directoryHandle);
      return directoryHandle;
    } catch (error) {
      if (error.code !== 'LOCAL_FOLDER_PERMISSION_DENIED') throw error;
    }
  }

  directoryHandle = await chooseLocalMediaDirectory();
  await requireWritePermission(directoryHandle);
  await rememberPodcastDirectory(podcastId, directoryHandle);
  return directoryHandle;
}

export function safeMediaFilename(value) {
  let filename = String(value || 'media')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180);
  if (!filename || filename === '.' || filename === '..') filename = 'media';

  const baseName = filename.split('.')[0].toUpperCase();
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName)) filename = `_${filename}`;
  return filename;
}

async function createUniqueFileHandle(directoryHandle, requestedName) {
  const filename = safeMediaFilename(requestedName);
  const extensionIndex = filename.lastIndexOf('.');
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : '';

  for (let suffix = 1; suffix <= 1000; suffix += 1) {
    const candidate = suffix === 1 ? filename : `${stem} (${suffix})${extension}`;
    try {
      await directoryHandle.getFileHandle(candidate);
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error;
      return directoryHandle.getFileHandle(candidate, { create: true });
    }
  }
  throw new Error('Could not find an unused filename in the selected folder');
}

export async function writeBlobToDirectory(directoryHandle, filename, blob) {
  const fileHandle = await createUniqueFileHandle(directoryHandle, filename);
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    if (typeof writable.abort === 'function') await writable.abort();
    throw error;
  }
  return fileHandle.name;
}

export async function copyAuthenticatedFileToDirectory(directoryHandle, url, filename) {
  const token = localStorage.getItem('cf_token');
  if (!token) throw new Error('Sign in again before saving this media file.');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const message = response.headers.get('content-type')?.includes('application/json')
      ? (await response.json()).error
      : await response.text();
    throw new Error(message || `Could not retrieve media file (${response.status})`);
  }
  if (!response.body) throw new Error('The server did not return a readable media stream.');

  const fileHandle = await createUniqueFileHandle(directoryHandle, filename);
  const writable = await fileHandle.createWritable();
  await response.body.pipeTo(writable);
  return fileHandle.name;
}
