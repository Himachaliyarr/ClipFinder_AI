import test from 'node:test';
import assert from 'node:assert/strict';
import { selectClips } from '../src/services/clipSelector.js';

test('selects clips using transcript source timestamps and normalizes numeric strings', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              clips: [
                { start: '2', end: '27', title: 'Good moment' },
                { start: 190, end: 220, title: 'Past the source end' },
              ],
            }),
          },
        }],
      }),
    };
  };

  try {
    const result = await selectClips('The transcript text', 180, [], [
      { start: 2, end: 2.4, text: 'First phrase' },
      { start: 3, end: 3.5, text: 'Second phrase' },
      { start: 11, end: 11.5, text: 'Later phrase' },
    ]);

    assert.match(request.messages[0].content, /\[0\.0-10\.0s\] First phrase Second phrase/);
    assert.match(request.messages[0].content, /\[10\.0-20\.0s\] Later phrase/);
    assert.deepEqual(result.clips, [{ start: 2, end: 27, title: 'Good moment' }]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('reports malformed model output instead of silently returning no clips', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
  });

  try {
    await assert.rejects(selectClips('Transcript text', 60), /Clip selection returned invalid JSON/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('reports model timestamps that are all outside the source duration', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ clips: [{ start: 200, end: 230 }] }) } }],
    }),
  });

  try {
    await assert.rejects(
      selectClips('Transcript text', 180),
      /all timestamps were invalid or outside the source duration/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('identifies network failures from the clip-selection provider', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      selectClips('Transcript text', 60),
      /Clip selection request failed before receiving a response: fetch failed/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});
