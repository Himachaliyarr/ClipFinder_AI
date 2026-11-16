import test from 'node:test';
import assert from 'node:assert/strict';
import { getExpectedChunkLength } from '../src/services/resumableUpload.js';

test('caps upload chunks and sizes the final chunk to the remaining bytes', () => {
  assert.equal(getExpectedChunkLength(40, 0, 16), 16);
  assert.equal(getExpectedChunkLength(40, 32, 16), 8);
});

test('rejects invalid and already-complete upload offsets', () => {
  assert.throws(() => getExpectedChunkLength(0, 0, 16), /invalid/);
  assert.throws(() => getExpectedChunkLength(40, -1, 16), /invalid/);
  assert.throws(() => getExpectedChunkLength(40, 40, 16), /invalid/);
});
