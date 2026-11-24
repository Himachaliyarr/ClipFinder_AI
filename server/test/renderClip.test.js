import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSentenceCameraPlan, getFinalRenderOptions, getRenderDimensions, getSpliceTransitions, resolveRenderSources } from '../src/services/renderClip.js';

test('maps supported social formats to even render dimensions', () => {
  assert.deepEqual(getRenderDimensions('9:16'), { width: 1080, height: 1920 });
  assert.deepEqual(getRenderDimensions('1:1'), { width: 1080, height: 1080 });
  assert.deepEqual(getRenderDimensions('16:9'), { width: 1920, height: 1080 });
});

test('rejects unsupported render formats', () => {
  assert.throws(() => getRenderDimensions('4:3'), /Aspect ratio must be/);
});

test('selects delivery codecs for MP4 and ProRes MOV renders', () => {
  assert.equal(getFinalRenderOptions('mp4').extension, 'mp4');
  assert.deepEqual(getFinalRenderOptions('mp4').audioArgs, ['-c:a', 'aac', '-b:a', '160k']);
  assert.equal(getFinalRenderOptions('mov').extension, 'mov');
  assert.deepEqual(getFinalRenderOptions('mov').videoArgs, ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']);
  assert.deepEqual(getFinalRenderOptions('mov').audioArgs, ['-c:a', 'pcm_s16le']);
  assert.throws(() => getFinalRenderOptions('avi'), /Output format must be mp4 or mov/);
});

test('crossfades adjacent kept ranges and shortens the transition for very short ranges', () => {
  const composition = getSpliceTransitions([0.8, 0.3, 1.2]);
  assert.deepEqual(composition.transitions.map(transition => transition.duration), [0.1, 0.1]);
  assert.ok(Math.abs(composition.transitions[0].offset - 0.7) < 0.000001);
  assert.ok(Math.abs(composition.transitions[1].offset - 0.9) < 0.000001);
  assert.ok(Math.abs(composition.duration - 2.1) < 0.000001);

  const shortComposition = getSpliceTransitions([0.06, 0.04]);
  assert.equal(shortComposition.transitions[0].duration, 0.02);
  assert.ok(Math.abs(shortComposition.duration - 0.08) < 0.000001);
});

test('builds the edited video plan in sentence order and uses the original camera map', () => {
  const plan = buildSentenceCameraPlan({
    start: 10,
    end: 20,
    sentenceEdits: [
      { start: 15, end: 18 },
      { start: 11, end: 13 },
    ],
    cameraSegments: [{ start: 0, end: 5, speaker: 'host' }],
  }, 'wide.mp4', new Map([['host', 'host.mp4']]));

  assert.deepEqual(plan, [
    { start: 5, end: 8, file: 'wide.mp4' },
    { start: 1, end: 3, file: 'host.mp4' },
  ]);
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
