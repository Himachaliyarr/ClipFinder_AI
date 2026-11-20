import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSentenceEdits } from '../src/services/clipSentenceEdits.js';

test('preserves the requested sentence order while validating source ranges', () => {
  assert.deepEqual(normalizeSentenceEdits([
    { sentenceId: 'last', start: 6, end: 9 },
    { sentenceId: 'first', start: 0, end: 3 },
    { sentenceId: 'middle', start: 3, end: 6 },
  ], 0, 9), [
    { sentenceId: 'last', start: 6, end: 9 },
    { sentenceId: 'first', start: 0, end: 3 },
    { sentenceId: 'middle', start: 3, end: 6 },
  ]);
});

test('allows an empty sentence list to restore the original continuous clip render', () => {
  assert.deepEqual(normalizeSentenceEdits([], 0, 9), []);
});

test('rejects sentence ranges outside the clip and overlapping source ranges', () => {
  assert.throws(() => normalizeSentenceEdits([{ start: -1, end: 2 }], 0, 9), /within the clip range/);
  assert.throws(() => normalizeSentenceEdits([
    { start: 0, end: 4 },
    { start: 3, end: 5 },
  ], 0, 9), /cannot overlap/);
});

test('limits edits to a practical number of rendered sentences', () => {
  const edits = Array.from({ length: 501 }, (_, index) => ({ start: index * 2, end: index * 2 + 1 }));
  assert.throws(() => normalizeSentenceEdits(edits, 0, 1002), /no more than 500 items/);
});

test('rejects duplicate sentence identifiers', () => {
  assert.throws(() => normalizeSentenceEdits([
    { sentenceId: 'same', start: 0, end: 1 },
    { sentenceId: 'same', start: 1, end: 2 },
  ], 0, 2), /identifiers must be unique/);
});
