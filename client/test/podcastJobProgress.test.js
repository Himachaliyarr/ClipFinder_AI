import test from 'node:test';
import assert from 'node:assert/strict';
import { isPodcastJobQueuedTooLong } from '../src/utils/podcastJobs.js';

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
