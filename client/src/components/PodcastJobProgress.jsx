// Shared status controls keep podcast cards and detail pages in sync.
export function isPodcastJobActive(status) {
  return ['downloading', 'queued', 'processing'].includes(status);
}

export function getPodcastProgress(podcast) {
  const progress = Number(podcast.jobProgress);
  if (podcast.status === 'clips_ready' || (podcast.status === 'transcribed' && (!Number.isFinite(progress) || progress === 0))) return 100;
  return Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
}

export function canRestartPodcastJob(podcast) {
  return ['failed', 'cancelled'].includes(podcast.status)
    || (podcast.jobType === 'select-clips' && podcast.status === 'transcribed' && Number(podcast.jobProgress) < 100);
}

export function getJobStatusMessage(status) {
  const messages = {
    downloading: 'Downloading source media…',
    queued: 'Waiting to start…',
    processing: 'Processing media…',
    transcribed: 'Transcription complete.',
    clips_ready: 'Clip suggestions are ready.',
    failed: 'Processing failed. Please retry or contact an administrator.',
    cancelled: 'Processing was stopped.',
  };
  return messages[status] || 'Task status updated.';
}

export default function PodcastJobProgress({ podcast, busy, onStop, onRestart, compact = false }) {
  const active = isPodcastJobActive(podcast.status);
  const progress = getPodcastProgress(podcast);

  return (
    <div className="jobprogress" style={compact ? { minWidth: 0 } : undefined}>
      <span>{podcast.jobMessage || getJobStatusMessage(podcast.status)} · {progress}%</span>
      <progress aria-label="Podcast processing progress" max="100" value={progress} />
      {podcast.jobId && active && (
        <button
          className="secondary"
          onClick={onStop}
          disabled={busy || podcast.jobMessage?.startsWith('Cancellation requested')}
        >
          {podcast.jobMessage?.startsWith('Cancellation requested') ? 'Stopping…' : 'Stop'}
        </button>
      )}
      {canRestartPodcastJob(podcast) && (
        <button className="secondary" onClick={onRestart} disabled={busy}>
          Restart
        </button>
      )}
    </div>
  );
}
