import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClipMetadataCsv,
  formatTranscriptForExport,
  formatTranscriptJson,
  formatTranscriptSrt,
  formatTranscriptVtt,
  getTranscriptLines,
} from '../src/utils/transcript.js';

test('groups word timings by sentence and starts a new line when the speaker changes', () => {
  const lines = getTranscriptLines([
    { start: 0.1, end: 0.3, text: 'Hello', timingType: 'word', speaker: 0 },
    { start: 0.4, end: 0.7, text: 'there.', timingType: 'word', speaker: 0 },
    { start: 0.8, end: 1, text: 'Yes,', timingType: 'word', speaker: 1 },
    { start: 1.1, end: 1.4, text: 'exactly.', timingType: 'word', speaker: 1 },
  ]);

  assert.deepEqual(lines, [
    { start: 0.1, end: 0.7, speaker: 0, text: 'Hello there.' },
    { start: 0.8, end: 1.4, speaker: 1, text: 'Yes, exactly.' },
  ]);
});

test('keeps provider phrase timings as separate lines and skips invalid segments', () => {
  const lines = getTranscriptLines([
    { start: 2, end: 3, text: 'First phrase', timingType: 'phrase' },
    { start: 3.1, end: 4, text: 'Second phrase', timingType: 'phrase' },
    { start: 4, end: 4, text: 'Invalid', timingType: 'phrase' },
  ]);

  assert.deepEqual(lines, [
    { start: 2, end: 3, speaker: null, text: 'First phrase' },
    { start: 3.1, end: 4, speaker: null, text: 'Second phrase' },
  ]);
});

test('exports transcript lines with timestamps and speaker labels', () => {
  const content = formatTranscriptForExport('', [
    { start: 0.1, end: 0.7, text: 'Hello there.', speaker: 0, timingType: 'phrase' },
    { start: 1.2, end: 2, text: 'Goodbye.', speaker: 'host', timingType: 'phrase' },
  ]);

  assert.equal(content, '[00:00.1 - 00:00.7] Speaker 1: Hello there.\n[00:01.2 - 00:02.0] host: Goodbye.');
});

test('falls back to plain transcript text when timed segments are unavailable', () => {
  assert.equal(formatTranscriptForExport('  Transcript without timings.  ', []), 'Transcript without timings.');
});

test('exports JSON with transcript metadata and normalized timed segments', () => {
  const data = JSON.parse(formatTranscriptJson('Episode 1', 'Hello there.', [
    { start: 0.1, end: 0.7, text: 'Hello there.', speaker: 0, timingType: 'phrase' },
  ]));

  assert.deepEqual(data, {
    title: 'Episode 1',
    transcript: 'Hello there.',
    segments: [{ start: 0.1, end: 0.7, speaker: 0, text: 'Hello there.' }],
  });
});

test('exports timed subtitles in SRT and VTT formats', () => {
  const segments = [{ start: 1.234, end: 2.5, text: 'Hello, world.' }];
  assert.equal(formatTranscriptSrt(segments), '1\n00:00:01,234 --> 00:00:02,500\nHello, world.');
  assert.equal(formatTranscriptVtt(segments), 'WEBVTT\n\n00:00:01.234 --> 00:00:02.500\nHello, world.');
});

test('exports clip metadata as escaped CSV', () => {
  assert.equal(
    formatClipMetadataCsv([{ title: 'A "quote"', start: 1, end: 2, caption: 'a,b', status: 'approved', assignedTo: { name: 'Editor' } }]),
    '\uFEFF"Title","Start (seconds)","End (seconds)","Hook","Caption","Status","Assigned editor"\r\n"A ""quote""","1","2","","a,b","approved","Editor"'
  );
});
