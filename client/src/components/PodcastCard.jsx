import { Film } from 'lucide-react';
import PodcastJobProgress, {
  canRestartPodcastJob,
  isPodcastJobActive,
} from './PodcastJobProgress.jsx';

// A card owns only the rendering and selection behavior for one podcast.
export default function PodcastCard({
  podcast,
  canDelete,
  selected,
  busy,
  onOpen,
  onToggleSelection,
  onStop,
  onRestart,
}) {
  return (
    <article className="podcard" onClick={() => onOpen(podcast)}>
      <div className="podicon" aria-hidden="true"><Film /></div>
      {canDelete && (
        <label onClick={event => event.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${podcast.title}`}
            checked={selected}
            onChange={() => onToggleSelection(podcast._id)}
            style={{ width: 18, height: 18, padding: 0, accentColor: '#c79b41' }}
          />
          Select
        </label>
      )}
      <h3>
        <button
          type="button"
          className="podcard-title"
          onClick={event => {
            event.stopPropagation();
            onOpen(podcast);
          }}
        >
          {podcast.title}
        </button>
      </h3>
      <span className={`status ${podcast.status}`} aria-label={`Status: ${podcast.status.replace('_', ' ')}`}>{podcast.status.replace('_', ' ')}</span>
      <p className="muted">{new Date(podcast.createdAt).toLocaleString()}</p>
      {(podcast.jobId || isPodcastJobActive(podcast.status) || canRestartPodcastJob(podcast)) && (
        <PodcastJobProgress
          podcast={podcast}
          busy={busy}
          onStop={event => { event.stopPropagation(); onStop(podcast._id); }}
          onRestart={event => { event.stopPropagation(); onRestart(podcast._id); }}
          compact
        />
      )}
    </article>
  );
}
