import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFolder, normalizeTags } from '../src/services/projectMetadata.js';

test('normalizes optional folders and rejects oversized folder names', () => {
  assert.equal(normalizeFolder('  Client A  '), 'Client A');
  assert.equal(normalizeFolder(''), '');
  assert.throws(() => normalizeFolder('x'.repeat(101)), /100 characters/);
});

test('trims and deduplicates tags without case-sensitive duplicates', () => {
  assert.deepEqual(normalizeTags([' Launch ', 'launch', '', 'Hindi']), ['Launch', 'Hindi']);
  assert.throws(() => normalizeTags('launch'), /Tags must be a list/);
  assert.throws(() => normalizeTags(['x'.repeat(41)]), /40 characters/);
});
