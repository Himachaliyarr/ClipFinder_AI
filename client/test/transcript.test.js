import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClipSentenceEditPatch,
  formatClipTimecode,
  formatEditableTimestamp,
  formatClipMetadataCsv,
  formatStoryMetadataCsv,
  formatStoryMetadataText,
  formatTranscriptForExport,
  formatTranscriptJson,
  formatTranscriptSrt,
  formatTranscriptVtt,
  getTranscriptLines,
  getTranscriptLinesInRange,
  getTranscriptLinesOverlappingRange,
  parseClipTimecode,
  parseEditableTimestamp,
} from '../src/utils/transcript.js';

test('formats clip boundaries as full timecodes and parses validated edits back to seconds', () => {
  assert.equal(formatClipTimecode(2020), '00:33:40');
  assert.equal(formatClipTimecode(2090.5), '00:34:50.5');
  assert.equal(formatClipTimecode(3723.4), '01:02:03.4');
  assert.equal(parseClipTimecode('00:33:40'), 2020);
  assert.equal(parseClipTimecode('01:02:03.4'), 3723.4);
  assert.equal(parseClipTimecode('00:60:00'), null);
  assert.equal(parseClipTimecode('00:00:60'), null);
  assert.equal(parseClipTimecode('2020'), null);
});

test('formats and parses editable sentence timestamps to millisecond precision', () => {
  assert.equal(formatEditableTimestamp(2347.123), '00:39:07.123');
  assert.equal(parseEditableTimestamp('00:39:07.123'), 2347.123);
  assert.equal(parseEditableTimestamp('00:39:07'), 2347);
  assert.equal(parseEditableTimestamp('00:60:07.123'), null);
});

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

test('selects only timestamped transcript segments overlapping a story range', () => {
  const lines = getTranscriptLinesInRange([
    { start: 0, end: 0.4, text: 'Before.', timingType: 'word' },
    { start: 0.5, end: 0.8, text: 'This', timingType: 'word' },
    { start: 0.9, end: 1.1, text: 'is', timingType: 'word' },
    { start: 1.2, end: 1.4, text: 'inside.', timingType: 'word' },
    { start: 1.5, end: 1.9, text: 'After.', timingType: 'word' },
  ], 0.5, 1.5);

  assert.deepEqual(lines, [
    { start: 0.5, end: 1.4, speaker: null, text: 'This is inside.' },
  ]);
});

test('preserves full sentence timestamps when the clip trim overlaps only part of the sentence', () => {
  assert.deepEqual(getTranscriptLinesOverlappingRange([
    { start: 2, end: 2.2, text: 'This', timingType: 'word' },
    { start: 2.3, end: 2.5, text: 'whole', timingType: 'word' },
    { start: 2.6, end: 2.9, text: 'sentence.', timingType: 'word' },
    { start: 3, end: 3.2, text: 'Next.', timingType: 'word' },
  ], 2.4, 3.5), [
    { start: 2, end: 2.9, speaker: null, text: 'This whole sentence.' },
    { start: 3, end: 3.2, speaker: null, text: 'Next.' },
  ]);
});

test('expands a clip trim to keep reordered boundary sentences whole and shifts its camera plan', () => {
  const patch = buildClipSentenceEditPatch({
    start: 2.5,
    end: 5,
    cameraSegments: [{ start: 0.5, end: 2, speaker: 'host' }],
  }, [
    { sentenceId: 'second', start: 3, end: 4, text: 'Second sentence.' },
    { sentenceId: 'first', start: 2, end: 2.8, text: 'First sentence.' },
  ], [
    { sentenceId: 'first', start: 2, end: 2.8, text: 'First sentence.' },
    { sentenceId: 'second', start: 3, end: 4, text: 'Second sentence.' },
  ]);

  assert.deepEqual(patch, {
    start: 2,
    end: 5,
    sentenceEdits: [
      { sentenceId: 'second', start: 3, end: 4 },
      { sentenceId: 'first', start: 2, end: 2.8 },
    ],
    cameraSegments: [{ start: 1, end: 2.5, speaker: 'host' }],
  });
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

test('exports story moments with metadata as spreadsheet-safe CSV', () => {
  assert.equal(
    formatStoryMetadataCsv([{
      title: 'A "story"',
      start: 12.5,
      end: 42,
      summary: 'A compelling, self-contained story.',
      excerpt: '=HYPERLINK("https://example.com")',
      script: '[00:12.5 - 00:14.0] This is the exact transcript.',
      reason: 'Strong payoff',
      score: 9,
    }]),
    '\uFEFF"Title","Start (seconds)","End (seconds)","Summary","Excerpt","Exact transcript","Reason","Score"\r\n"A ""story""","12.5","42","A compelling, self-contained story.","\'=HYPERLINK(""https://example.com"")","[00:12.5 - 00:14.0] This is the exact transcript.","Strong payoff","9"'
  );
});

test('exports story moments with readable timestamps as plain text', () => {
  assert.equal(
    formatStoryMetadataText([{
      title: 'The breakthrough',
      start: 12.5,
      end: 42,
      summary: 'A compelling story.',
      excerpt: 'It finally worked.',
      script: '[00:12.5 - 00:14.0] The exact words.\n[00:14.0 - 00:15.0] Continue here.',
      reason: 'Clear payoff',
      score: 9,
    }]),
    'Story 1: The breakthrough\nTime: 00:12.5 - 00:42.0\nSummary: A compelling story.\nExcerpt: It finally worked.\nExact transcript:\n[00:12.5 - 00:14.0] The exact words.\n[00:14.0 - 00:15.0] Continue here.\nWhy it stands out: Clear payoff\nScore: 9/10'
  );
});
