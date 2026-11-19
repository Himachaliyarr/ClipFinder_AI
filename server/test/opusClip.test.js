import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildOpusClipPrompt, createOpusClipProject, getOpusClipProjectClips, normalizeOpusClip } from '../src/services/opusClip.js';

const openAiMoments = [{
  start: 42.2,
  end: 67.5,
  title: 'The surprising lesson',
  hook: 'A story about a difficult choice',
  reason: 'Strong emotional turn',
}];

function mockEnvironment(t, fetchMock) {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPUSCLIP_API_KEY;
  const originalOrgId = process.env.OPUSCLIP_ORG_ID;
  process.env.OPUSCLIP_API_KEY = 'test-api-key';
  delete process.env.OPUSCLIP_ORG_ID;
  global.fetch = fetchMock;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPUSCLIP_API_KEY;
    else process.env.OPUSCLIP_API_KEY = originalKey;
    if (originalOrgId === undefined) delete process.env.OPUSCLIP_ORG_ID;
    else process.env.OPUSCLIP_ORG_ID = originalOrgId;
  });
}

test('requires OpenAI timed moments to build OpusClip guidance', () => {
  assert.throws(() => buildOpusClipPrompt([]), /OpenAI must select at least one timed moment/);
  assert.match(buildOpusClipPrompt(openAiMoments), /OpenAI analyzed the source transcript/);
  assert.match(buildOpusClipPrompt(openAiMoments), /no captions, subtitles, headings, titles/);
});

test('creates an OpusClip ClipAnything project directly from a YouTube source', async t => {
  let request;
  mockEnvironment(t, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ projectId: 'project-123' }), {
      status: 201,
      headers: { 'content-type': 'application/json', 'x-opus-org-id': 'org-123' },
    });
  });

  const project = await createOpusClipProject({
    title: 'Podcast episode',
    sourceUrl: 'https://www.youtube.com/watch?v=example',
    sourceFiles: [],
  }, openAiMoments);

  assert.deepEqual(project, { projectId: 'project-123', orgId: 'org-123' });
  assert.equal(request.url, 'https://api.opus.pro/api/clip-projects');
  assert.equal(request.options.headers.Authorization, 'Bearer test-api-key');
  const body = JSON.parse(request.options.body);
  assert.equal(body.videoUrl, 'https://www.youtube.com/watch?v=example');
  assert.equal(body.curationPref.model, 'ClipAnything');
  assert.match(body.curationPref.customPrompt, /42\.2-67\.5 seconds/);
  assert.match(body.curationPref.customPrompt, /The surprising lesson/);
  assert.equal(body.renderPref.layoutAspectRatio, 'portrait');
});

test('passes the worker cancellation signal to OpusClip project creation', async t => {
  const controller = new AbortController();
  mockEnvironment(t, async (_url, options) => new Promise((_, reject) => {
    assert.equal(options.signal, controller.signal);
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    controller.abort(new Error('Processing cancelled by user'));
  }));

  await assert.rejects(
    createOpusClipProject({
      title: 'Podcast episode',
      sourceUrl: 'https://www.youtube.com/watch?v=example',
      sourceFiles: [],
    }, openAiMoments, controller.signal),
    /Processing cancelled by user/,
  );
});

test('uploads a local video through OpusClip resumable upload before creating the project', async t => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opusclip-test-'));
  t.after(() => fs.rm(tempDir, { recursive: true, force: true }));
  const videoPath = path.join(tempDir, 'source.mp4');
  await fs.writeFile(videoPath, Buffer.from('video-bytes'));
  const calls = [];

  mockEnvironment(t, async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        url: 'https://storage.googleapis.com/upload-session',
        uploadId: 'upload-123',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (calls.length === 2) {
      return new Response(null, { status: 201, headers: { location: 'https://storage.googleapis.com/resumable-upload' } });
    }
    if (calls.length === 3) {
      const uploaded = [];
      await new Promise((resolve, reject) => {
        options.body.on('data', chunk => uploaded.push(chunk));
        options.body.on('error', reject);
        options.body.on('end', resolve);
        options.body.resume();
      });
      assert.deepEqual(Buffer.concat(uploaded), Buffer.from('video-bytes'));
      return new Response(null, { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'project-local' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });

  const project = await createOpusClipProject({
    title: 'Local episode',
    sourceFiles: [{ kind: 'video', path: videoPath }],
  }, openAiMoments);

  assert.deepEqual(project, { projectId: 'project-local', orgId: null });
  assert.equal(calls[0].url, 'https://api.opus.pro/api/upload-links');
  assert.equal(calls[1].options.headers['x-goog-resumable'], 'start');
  assert.equal(calls[2].options.method, 'PUT');
  assert.equal(JSON.parse(calls[3].options.body).videoUrl, 'upload-123');
});

test('retrieves exportable OpusClip reels and rejects untrusted media URLs', async t => {
  let request;
  mockEnvironment(t, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify([{
      id: 'project-123.clip-1',
      title: 'A good story',
      durationMs: 35000,
      uriForPreview: 'https://ext.cdn.opus.pro/preview.mp4',
      uriForExport: 'https://storage.googleapis.com/opus/export.mp4',
    }]), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  const clips = await getOpusClipProjectClips('project-123', 'org-123');

  assert.match(request.url, /q=findByProjectId/);
  assert.match(request.url, /projectId=project-123/);
  assert.equal(request.options.headers['x-opus-org-id'], 'org-123');
  assert.equal(clips[0].title, 'A good story');
  assert.equal(clips[0].durationMs, 35000);
  assert.throws(() => normalizeOpusClip({ uriForExport: 'https://example.com/unsafe.mp4' }), /unsupported media URL/);
});
