import test from 'node:test';
import assert from 'node:assert/strict';
import { selectStories } from '../src/services/storySelector.js';

function makeStories(count = 25) {
  return Array.from({ length: count }, (_, index) => ({
    start: String(index * 30),
    end: index * 30 + 25,
    title: `Story ${index + 1}`,
    summary: 'A distinct story from the transcript.',
    excerpt: 'A short quote.',
    reason: 'It has a clear payoff.',
    score: 8,
  }));
}

test('selects 25-30 timestamped stories through ChatGPT and normalizes response fields', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousModel = process.env.LLM_MODEL;
  const previousBaseUrl = process.env.LLM_BASE_URL;
  const previousProvider = process.env.LLM_PROVIDER;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  delete process.env.LLM_MODEL;
  process.env.LLM_BASE_URL = 'https://api.openai.com/v1/';
  delete process.env.LLM_PROVIDER;
  let requestUrl;
  let requestBody;
  let requestHeaders;
  globalThis.fetch = async (url, options) => {
    requestUrl = new URL(url);
    requestBody = JSON.parse(options.body);
    requestHeaders = options.headers;
    return {
      ok: true,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ stories: makeStories(32) }) } }],
      }),
    };
  };

  try {
    const result = await selectStories('Transcript text', 1200, [
      { start: 5, end: 9, text: 'Timed story text' },
    ]);

    assert.equal(requestUrl.hostname, 'api.openai.com');
    assert.equal(requestUrl.pathname, '/v1/chat/completions');
    assert.equal(requestHeaders.Authorization, 'Bearer test-key');
    assert.equal(requestBody.model, 'gpt-4o-mini');
    assert.deepEqual(requestBody.response_format, { type: 'json_object' });
    assert.match(requestBody.messages[0].content, /\[0\.0-10\.0s\] Timed story text/);
    assert.equal(result.stories.length, 30);
    assert.equal(result.stories[0].start, 0);
    assert.equal(result.stories[0].score, 8);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = previousModel;
    if (previousBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = previousBaseUrl;
    if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousProvider;
  }
});

test('rejects invalid timestamps and responses with fewer than 25 valid stories', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            stories: [
              ...makeStories(24),
              { ...makeStories(1)[0], start: 900, end: 901 },
            ],
          }),
        },
      }],
    }),
  });

  try {
    await assert.rejects(selectStories('Transcript text', 900), /24 valid story moments; at least 25 are required/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('reports ChatGPT configuration and provider errors', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  delete process.env.LLM_API_KEY;

  try {
    await assert.rejects(selectStories('Transcript text', 900), /LLM_API_KEY is not configured/);
    process.env.LLM_API_KEY = 'test-key';
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Invalid API key' } }),
    });
    await assert.rejects(selectStories('Transcript text', 900), /ChatGPT story selection error \(401\): Invalid API key/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('reports empty and malformed provider response bodies clearly', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';

  try {
    globalThis.fetch = async () => ({ ok: false, status: 502, text: async () => '' });
    await assert.rejects(selectStories('Transcript text', 900), /HTTP 502 with an empty response/);
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '{"choices":' });
    await assert.rejects(selectStories('Transcript text', 900), /malformed JSON \(HTTP 200\)/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});

test('identifies network failures from ChatGPT separately from API responses', async () => {
  const previousKey = process.env.LLM_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.LLM_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };

  try {
    await assert.rejects(
      selectStories('Transcript text', 900),
      /ChatGPT story request failed before receiving a response: fetch failed/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previousKey;
  }
});
