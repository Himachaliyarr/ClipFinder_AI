import test from 'node:test';
import assert from 'node:assert/strict';
import {
  copyAuthenticatedFileToDirectory,
  safeMediaFilename,
  writeBlobToDirectory,
} from '../src/utils/localMediaStorage.js';

function createDirectoryHandle() {
  const files = new Map();
  return {
    files,
    async getFileHandle(name, options = {}) {
      if (files.has(name)) return files.get(name);
      if (!options.create) throw Object.assign(new Error('File not found'), { name: 'NotFoundError' });

      const file = { name, contents: null };
      file.createWritable = async () => {
        const chunks = [];
        const writable = new WritableStream({
          async write(chunk) {
            chunks.push(chunk instanceof Blob ? await chunk.text() : new TextDecoder().decode(chunk));
          },
          close() { file.contents = chunks.join(''); },
        });
        return Object.assign(writable, {
          async write(chunk) {
            const writer = writable.getWriter();
            try { await writer.write(chunk); }
            finally { writer.releaseLock(); }
          },
          async close() {
            const writer = writable.getWriter();
            try { await writer.close(); }
            finally { writer.releaseLock(); }
          },
          async abort(reason) {
            const writer = writable.getWriter();
            try { await writer.abort(reason); }
            finally { writer.releaseLock(); }
          },
        });
      };
      files.set(name, file);
      return file;
    },
  };
}

test('sanitizes file names for local filesystem rules', () => {
  assert.equal(safeMediaFilename('episode: one?.mp4'), 'episode_ one_.mp4');
  assert.equal(safeMediaFilename('CON.mp4'), '_CON.mp4');
  assert.equal(safeMediaFilename('... '), 'media');
});

test('writes files without overwriting an existing file in the selected folder', async () => {
  const directory = createDirectoryHandle();
  const firstName = await writeBlobToDirectory(directory, 'episode.mp4', new Blob(['first']));
  const secondName = await writeBlobToDirectory(directory, 'episode.mp4', new Blob(['second']));

  assert.equal(firstName, 'episode.mp4');
  assert.equal(secondName, 'episode (2).mp4');
  assert.equal(directory.files.get(firstName).contents, 'first');
  assert.equal(directory.files.get(secondName).contents, 'second');
});

test('streams authenticated media into the selected folder', async () => {
  const directory = createDirectoryHandle();
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => key === 'cf_token' ? 'test-token' : null };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return new Response(new Blob(['source video']));
  };

  try {
    const savedName = await copyAuthenticatedFileToDirectory(directory, '/api/media', 'source.mp4');
    assert.equal(savedName, 'source.mp4');
    assert.equal(directory.files.get(savedName).contents, 'source video');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});
