import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpeakerCorrections } from '../src/services/transcript.js';

test('applies speaker corrections by segment start time and preserves text and timings', () => {
  const segments = [
    { start: 1, end: 1.4, text: 'Hello', speaker: 0, timingType: 'word' },
    { start: 1.5, end: 1.9, text: 'there.', speaker: 0, timingType: 'word' },
    { start: 2, end: 2.4, text: 'Yes.', speaker: 1, timingType: 'word' },
  ];

  assert.deepEqual(applySpeakerCorrections(segments, [
    { start: 1, end: 2, speaker: 1 },
    { start: 2, end: 3, speaker: null },
  ]), [
    { start: 1, end: 1.4, text: 'Hello', speaker: 1, timingType: 'word' },
    { start: 1.5, end: 1.9, text: 'there.', speaker: 1, timingType: 'word' },
    { start: 2, end: 2.4, text: 'Yes.', speaker: null, timingType: 'word' },
  ]);
});
