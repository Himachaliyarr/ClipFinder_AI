export function isPodcastJobQueuedTooLong(podcast, now = Date.now()) {
  if (podcast.status !== 'queued') return false;
  const updatedAt = Date.parse(podcast.updatedAt || podcast.createdAt);
  return Number.isFinite(updatedAt) && now - updatedAt >= 30_000;
}
