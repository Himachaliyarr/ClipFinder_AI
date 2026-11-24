import test from 'node:test';
import assert from 'node:assert/strict';
import { isPodcastJobQueuedTooLong } from '../src/utils/podcastJobs.js';
import { getPodcastProgress } from '../src/utils/podcastProgress.js';

test('only flags queued jobs that have waited at least 30 seconds', () => {
  const now = Date.parse('2026-11-20T10:00:30.000Z');
  assert.equal(isPodcastJobQueuedTooLong({
    status: 'queued',
    updatedAt: '2026-11-20T10:00:00.000Z',
  }, now), true);
  assert.equal(isPodcastJobQueuedTooLong({
    status: 'queued',
    updatedAt: '2026-11-20T10:00:01.000Z',
  }, now), false);
  assert.equal(isPodcastJobQueuedTooLong({
    status: 'processing',
    updatedAt: '2026-11-20T10:00:00.000Z',
  }, now), false);
});

test('hides percentages when processing has no measurable progress', () => {
  assert.equal(getPodcastProgress({ status: 'queued', jobProgress: 0 }), null);
  assert.equal(getPodcastProgress({ status: 'processing', jobType: 'select-clips', jobProgress: 75 }), null);
  assert.equal(getPodcastProgress({ status: 'processing', jobType: 'transcribe-podcast', jobProgress: 20 }), null);
});

test('shows measured progress as whole percentages and completed jobs at 100%', () => {
  assert.equal(getPodcastProgress({ status: 'processing', jobType: 'transcribe-podcast', jobProgress: 45.9 }), 45);
  assert.equal(getPodcastProgress({ status: 'clips_ready', jobProgress: 96 }), 100);
});
