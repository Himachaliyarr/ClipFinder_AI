import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRenderDimensions, resolveRenderSources } from '../src/services/renderClip.js';

test('maps supported social formats to even render dimensions', () => {
  assert.deepEqual(getRenderDimensions('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(getRenderDimensions('1:1'), { width: 1080, height: 1080 });
  assert.deepEqual(getRenderDimensions('16:9'), { width: 1920, height: 1080 });
});

test('rejects unsupported render formats', () => {
  assert.throws(() => getRenderDimensions('4:3'), /Aspect ratio must be/);
});

test('uses and caches a downloaded YouTube video when a podcast has no uploaded video', async t => {
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'render-source-test-'));
  t.after(() => fs.rm(mediaRoot, { recursive: true, force: true }));
  let downloadCount = 0;
  const podcast = { _id: 'youtube-podcast', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', sourceFiles: [] };
  const downloadVideo = async (_url, outputPath) => {
    downloadCount += 1;
    await fs.writeFile(outputPath, Buffer.from('video'));
  };

  const first = await resolveRenderSources(podcast, mediaRoot, undefined, downloadVideo);
  const second = await resolveRenderSources(podcast, mediaRoot, undefined, downloadVideo);

  assert.equal(first[0].kind, 'video');
  assert.equal(first[0].path, second[0].path);
  assert.equal(downloadCount, 1);
});

test('prefers an uploaded video over a YouTube source', async t => {
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'render-source-test-'));
  t.after(() => fs.rm(mediaRoot, { recursive: true, force: true }));
  const localVideo = path.join(mediaRoot, 'uploaded.mp4');
  await fs.writeFile(localVideo, Buffer.from('video'));

  const sources = await resolveRenderSources({
    _id: 'uploaded-podcast',
    sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    sourceFiles: [{ kind: 'video', path: localVideo }],
  }, mediaRoot, undefined, async () => {
    throw new Error('Should use the uploaded video');
  });

  assert.equal(sources[0].path, localVideo);
});
