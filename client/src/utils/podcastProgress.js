export function getPodcastProgress(podcast) {
  const progress = Number(podcast.jobProgress);
  if (podcast.status === 'clips_ready' || (podcast.status === 'transcribed' && (!Number.isFinite(progress) || progress === 0))) return 100;
  if (podcast.status === 'queued' || !Number.isFinite(progress)) return null;
  if (isActiveStatus(podcast.status) && progress <= 0) return null;
  if (podcast.jobType === 'select-clips' && progress < 100) return null;
  if (
    ['import-youtube', 'transcribe-podcast', 'transcribe-youtube'].includes(podcast.jobType)
    && progress <= 20
  ) return null;
  return Math.floor(Math.min(100, Math.max(0, progress)));
}

function isActiveStatus(status) {
  return ['downloading', 'queued', 'processing'].includes(status);
}
