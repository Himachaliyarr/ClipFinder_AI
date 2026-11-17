import test from 'node:test';
import assert from 'node:assert/strict';
import { forEachConcurrent, getPcmStreamProgress, groupTranscriptSegments, parseDeepgramResponse, parseSarvamResponse, reconcileChunkSpeakerIds, removeTranscriptOverlap, transcribeAudioChunk } from '../src/services/deepgram.js';

test('parses word timings and applies chunk offsets', () => {
  const parsed = parseDeepgramResponse({
    results: {
      channels: [{
        alternatives: [{
          transcript: 'hello world',
          words: [
            { start: 0.1, end: 0.4, punctuated_word: 'Hello', language: 'en' },
            { start: 0.5, end: 0.8, word: 'world' },
          ],
        }],
      }],
    },
  }, 25, 100);

  assert.deepEqual(parsed.segments, [
    { start: 25.1, end: 25.4, text: 'Hello', speaker: null, language: 'en', timingType: 'word' },
    { start: 25.5, end: 25.8, text: 'world', speaker: null, language: null, timingType: 'word' },
  ]);
  assert.equal(parsed.transcript, 'hello world');
});

test('drops malformed, empty, and out-of-range word timings', () => {
  const parsed = parseDeepgramResponse({
    results: {
      channels: [{
        alternatives: [{
          transcript: '',
          words: [
            { start: 'bad', end: 1, word: 'invalid' },
            { start: 2, end: 1, word: 'reversed' },
            { start: 1, end: 2, word: '   ' },
            { start: 11, end: 12, word: 'outside' },
          ],
        }],
      }],
    },
  }, 0, 10);

  assert.deepEqual(parsed.segments, []);
});

test('clamps a valid word at the end of the source audio', () => {
  const parsed = parseDeepgramResponse({
    results: {
      channels: [{
        alternatives: [{
          transcript: 'last',
          words: [{ start: 9.5, end: 10.5, word: 'last' }],
        }],
      }],
    },
  }, 0, 10);

  assert.equal(parsed.segments[0].end, 10);
});

test('preserves Deepgram speaker labels on timed words', () => {
  const parsed = parseDeepgramResponse({
    results: {
      channels: [{
        alternatives: [{
          words: [{ start: 0, end: 0.4, word: 'hello', speaker: 1 }],
        }],
      }],
    },
  });

  assert.equal(parsed.segments[0].speaker, 1);
});

test('matches changed Deepgram speaker ids across overlapping chunks', () => {
  const reconciled = reconcileChunkSpeakerIds([
    { start: 117.1, end: 117.4, text: 'hello', speaker: 0 },
    { start: 118.1, end: 118.5, text: 'there', speaker: 1 },
  ], [
    { start: 117.1, end: 117.4, text: 'hello', speaker: 1 },
    { start: 118.1, end: 118.5, text: 'there', speaker: 0 },
    { start: 119, end: 119.3, text: 'new', speaker: 2 },
  ], 117, 120, 2);

  assert.deepEqual(reconciled.segments.map(segment => segment.speaker), [0, 1, 2]);
  assert.equal(reconciled.nextSpeakerId, 3);
});

test('removes repeated transcript words from overlapping chunks', () => {
  assert.equal(
    removeTranscriptOverlap('This is the repeated phrase', 'repeated phrase, and new words.'),
    'and new words.'
  );
  assert.equal(removeTranscriptOverlap('Previous words', 'Different start.'), 'Different start.');
});

test('advances YouTube progress while FFmpeg is extracting a chunk', () => {
  const bytesPerChunk = 16000 * 2 * 120;
  assert.equal(getPcmStreamProgress(0, bytesPerChunk / 2, bytesPerChunk), 21);
  assert.equal(getPcmStreamProgress(0, bytesPerChunk, bytesPerChunk), 22);
  assert.equal(getPcmStreamProgress(1, 0, bytesPerChunk), 23);
  assert.equal(getPcmStreamProgress(30, bytesPerChunk, bytesPerChunk), 90);
});

test('transcribes streamed chunks concurrently within a bounded limit', async () => {
  let active = 0;
  let maximumActive = 0;
  const results = [];

  await forEachConcurrent(
    [0, 1, 2, 3],
    2,
    async value => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, (4 - value) * 5));
      active--;
      return value * 2;
    },
    (value, index) => {
      results[index] = value;
    }
  );

  assert.equal(maximumActive, 2);
  assert.deepEqual(results, [0, 2, 4, 6]);
});

test('groups word timings into sentences and splits at speaker changes', () => {
  const grouped = groupTranscriptSegments([
    { start: 0, end: 0.3, text: 'Hello,', speaker: 1, language: 'en', timingType: 'word' },
    { start: 0.4, end: 0.8, text: 'world.', speaker: 1, language: 'en', timingType: 'word' },
    { start: 1, end: 1.2, text: 'How', speaker: 1, language: 'en', timingType: 'word' },
    { start: 1.3, end: 1.7, text: 'are you?', speaker: 1, language: 'en', timingType: 'word' },
    { start: 1.8, end: 2, text: 'Fine.', speaker: 2, language: 'en', timingType: 'word' },
  ]);

  assert.deepEqual(grouped, [
    { start: 0, end: 0.8, text: 'Hello, world.', speaker: 1, language: 'en', timingType: 'sentence' },
    { start: 1, end: 1.7, text: 'How are you?', speaker: 1, language: 'en', timingType: 'sentence' },
    { start: 1.8, end: 2, text: 'Fine.', speaker: 2, language: 'en', timingType: 'sentence' },
  ]);
});

test('parses Sarvam phrase timestamps with chunk offsets and duration bounds', () => {
  const parsed = parseSarvamResponse({
    transcript: 'नमस्ते दुनिया',
    language_code: 'hi-IN',
    timestamps: {
      words: ['नमस्ते', 'दुनिया'],
      start_time_seconds: [0.2, 1.1],
      end_time_seconds: [0.9, 2.4],
    },
  }, 25, 27);

  assert.equal(parsed.transcript, 'नमस्ते दुनिया');
  assert.equal(parsed.language, 'hi-IN');
  assert.deepEqual(parsed.segments, [
    { start: 25.2, end: 25.9, text: 'नमस्ते', speaker: null, language: 'hi-IN', timingType: 'phrase' },
    { start: 26.1, end: 27, text: 'दुनिया', speaker: null, language: 'hi-IN', timingType: 'phrase' },
  ]);
});

test('transcribes each audio chunk with both Deepgram and Sarvam', async () => {
  const previousFetch = globalThis.fetch;
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousSarvamKey = process.env.SARVAM_API_KEY;
  const previousProvider = process.env.STT_PROVIDER;
  const calls = [];
  process.env.DEEPGRAM_API_KEY = 'test-deepgram-key';
  process.env.SARVAM_API_KEY = 'test-sarvam-key';
  process.env.STT_PROVIDER = 'both';
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    const body = String(url).startsWith('https://api.deepgram.com/')
      ? {
          results: { channels: [{ alternatives: [{ transcript: 'deepgram text', words: [{ start: 0, end: 1, word: 'deepgram' }] }] }] },
        }
      : { transcript: 'sarvam text', language_code: 'en-IN' };
    return { ok: true, json: async () => body };
  };

  try {
    const result = await transcribeAudioChunk(Buffer.from('audio'), 0, 2, 'audio/wav', 'chunk.wav');
    assert.deepEqual(calls.map(call => call.url.split('?')[0]).sort(), [
      'https://api.deepgram.com/v1/listen',
      'https://api.sarvam.ai/speech-to-text',
    ]);
    assert.equal(result.deepgram.transcript, 'deepgram text');
    assert.equal(result.sarvam.transcript, 'sarvam text');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousSarvamKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = previousSarvamKey;
    if (previousProvider === undefined) delete process.env.STT_PROVIDER;
    else process.env.STT_PROVIDER = previousProvider;
  }
});

test('Deepgram-only transcription does not require or call Sarvam', async () => {
  const previousFetch = globalThis.fetch;
  const previousDeepgramKey = process.env.DEEPGRAM_API_KEY;
  const previousSarvamKey = process.env.SARVAM_API_KEY;
  const previousProvider = process.env.STT_PROVIDER;
  const calls = [];
  process.env.DEEPGRAM_API_KEY = 'test-deepgram-key';
  delete process.env.SARVAM_API_KEY;
  process.env.STT_PROVIDER = 'deepgram';
  globalThis.fetch = async url => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => ({
        results: { channels: [{ alternatives: [{ transcript: 'deepgram only', words: [{ start: 0, end: 1, word: 'hello.' }] }] }] },
      }),
    };
  };

  try {
    const result = await transcribeAudioChunk(Buffer.from('audio'), 0, 2, 'audio/wav', 'chunk.wav');
    assert.deepEqual(calls, ['https://api.deepgram.com/v1/listen?model=nova-3&language=multi&smart_format=true&diarize=true']);
    assert.equal(result.deepgram.transcript, 'deepgram only');
    assert.equal(result.sarvam, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDeepgramKey === undefined) delete process.env.DEEPGRAM_API_KEY;
    else process.env.DEEPGRAM_API_KEY = previousDeepgramKey;
    if (previousSarvamKey === undefined) delete process.env.SARVAM_API_KEY;
    else process.env.SARVAM_API_KEY = previousSarvamKey;
    if (previousProvider === undefined) delete process.env.STT_PROVIDER;
    else process.env.STT_PROVIDER = previousProvider;
  }
});
