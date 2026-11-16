import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { formatTranscriptTimestamp } from '../utils/transcript.js';
import PodcastJobProgress, {
  canRestartPodcastJob,
  isPodcastJobActive,
} from '../components/PodcastJobProgress.jsx';
import TranscriptPanel from '../components/TranscriptPanel.jsx';

// Podcast processing, transcript, story, and clip controls belong to the detail page.
export default function PodcastDetailPage({ data, actions }) {
  const {
    selected,
    clips,
    busy,
    sourceKind,
    speakerKey,
    extraFiles,
    transcriptLines,
    transcriptVisible,
    hasTranscript,
    selectedExportFormat,
    hasStoryMomentJob,
    hasOpusClipJob,
  } = data;
  const {
    setSourceKind,
    setSpeakerKey,
    setExtraFiles,
    stopPodcastJob,
    restartPodcastJob,
    transcribe,
    generateStories,
    generateOpusClips,
    uploadMore,
    setExportFormat,
    exportTranscript,
    setOpenTranscriptFor,
    updateClip,
    editCameraPlan,
    renderClip,
    previewClip,
    downloadClip,
  } = actions;
  const [activeTab, setActiveTab] = useState('transcript');
  const tabs = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'stories', label: `Story moments (${selected?.storyMoments?.length || 0})` },
    { id: 'clips', label: `Reel suggestions (${clips.length})` },
    { id: 'generated', label: `Generated reels (${selected?.opusClipClips?.length || 0})` },
  ];

  function handleTabKeyDown(event) {
    const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
    let nextIndex = activeIndex;
    if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    setActiveTab(nextTab.id);
    document.getElementById(`detail-tab-${nextTab.id}`)?.focus();
  }

  return (
    <>
      <section className="detailbar">
        <div>
          <span className={`status ${selected?.status}`}>{selected?.status}</span>
          <p className="muted">{selected?.sourceFiles?.length || 0} source files · {selected?.language || 'Language pending'}</p>
          {selected?.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">YouTube source</a>}
          {(selected?.jobId || isPodcastJobActive(selected?.status) || (selected && canRestartPodcastJob(selected))) && (
            <PodcastJobProgress
              podcast={selected}
              busy={busy}
              onStop={() => stopPodcastJob(selected._id)}
              onRestart={() => restartPodcastJob(selected._id)}
            />
          )}
        </div>
        <button onClick={transcribe} disabled={busy || !selected?.sourceFiles?.length || ['downloading', 'queued', 'processing'].includes(selected?.status)}>
          {busy ? 'Starting…' : 'Start transcription'}
        </button>
        {hasTranscript && (
          <button
            className="secondary"
            onClick={generateStories}
            disabled={busy || hasStoryMomentJob}
          >
            {hasStoryMomentJob ? 'Finding stories…' : selected?.storyMomentsStatus === 'completed' ? 'Regenerate stories' : 'Find story moments'}
          </button>
        )}
        {selected?.transcript && (selected?.sourceUrl || selected?.sourceFiles?.some(file => file.kind === 'video')) && (
          <button
            className="secondary"
            onClick={generateOpusClips}
            disabled={busy || hasOpusClipJob}
          >
            Generate Reels
          </button>
        )}
      </section>
      <section className="create sourceupload">
        <div>
          <h3>Add camera / audio track</h3>
          <p className="muted">Upload one speaker camera at a time and assign its stable key.</p>
        </div>
        <select aria-label="Additional track type" value={sourceKind} onChange={event => setSourceKind(event.target.value)}>
          <option value="video">Camera video</option>
          <option value="audio">Speaker mic track</option>
          <option value="mix">Master mix audio</option>
        </select>
        <input aria-label="Speaker key" value={speakerKey ?? ''} onChange={event => setSpeakerKey(event.target.value)} placeholder="Speaker key e.g. host_a" />
        <input type="file" multiple accept="video/*,audio/*" aria-label="Additional audio or video tracks" onChange={event => setExtraFiles(event.target.files)} />
        <button onClick={uploadMore} disabled={busy || !extraFiles.length || (!speakerKey && sourceKind !== 'mix')}>
          Upload track
        </button>
      </section>
      {selected?.error && !isPodcastJobActive(selected.status) && <div className="notice error">Processing failed: {selected.error}</div>}
      <div className="detail-tabs" role="tablist" aria-label="Podcast details" onKeyDown={handleTabKeyDown}>
        {tabs.map(tab => (
          <button
            type="button"
            role="tab"
            id={`detail-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`detail-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? 'detail-tab active' : 'detail-tab'}
            onClick={() => setActiveTab(tab.id)}
            key={tab.id}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div id="detail-panel-transcript" className="detail-tab-panel" role="tabpanel" aria-labelledby="detail-tab-transcript" tabIndex={0} hidden={activeTab !== 'transcript'}>
          <TranscriptPanel
            selected={selected}
            transcriptLines={transcriptLines}
            transcriptVisible={transcriptVisible}
            hasTranscript={hasTranscript}
            selectedExportFormat={selectedExportFormat}
            setExportFormat={setExportFormat}
            exportTranscript={exportTranscript}
            setOpenTranscriptFor={setOpenTranscriptFor}
          />
      </div>
      <div id="detail-panel-stories" className="detail-tab-panel" role="tabpanel" aria-labelledby="detail-tab-stories" tabIndex={0} hidden={activeTab !== 'stories'}>
          <section className="story-results">
            <div className="story-heading">
              <div>
                <h3>Story moments ({selected?.storyMoments?.length || 0})</h3>
                <p className={selected?.storyMomentsStatus === 'failed' ? 'error' : 'muted'}>
                  {selected?.storyMomentsStatus === 'completed'
                    ? 'Story moments are ready.'
                    : selected?.storyMomentsStatus === 'failed'
                      ? 'Story selection failed. Please retry or contact an administrator.'
                      : hasStoryMomentJob
                        ? 'Finding story moments…'
                        : hasTranscript
                          ? selected?.sourceUrl && !selected?.sourceFiles?.length
                            ? 'Generate story moments manually from this YouTube transcript.'
                            : 'Story cards are generated automatically after transcription.'
                          : 'Transcribe the source to find story moments.'}
                </p>
                {hasStoryMomentJob && (
                  <div className="async-progress">
                    <span>{selected?.storyMomentsMessage || 'Finding story moments…'}</span>
                    <div className="indeterminate-progress" role="progressbar" aria-label="Finding story moments" aria-valuetext="In progress">
                      <span />
                    </div>
                  </div>
                )}
              </div>
            </div>
            {selected?.storyMoments?.length ? (
              <div className="story-grid">
                {selected.storyMoments.map((story, index) => (
                  <article className="story-card" key={`${story.start}-${index}`}>
                    <div className="story-card-top">
                      <span className="story-time">
                        {formatTranscriptTimestamp(story.start)} – {formatTranscriptTimestamp(story.end)}
                      </span>
                      <span className="score">{story.score}/10</span>
                    </div>
                    <h4>{story.title}</h4>
                    <p>{story.summary}</p>
                    {story.excerpt && <blockquote>{story.excerpt}</blockquote>}
                    {story.reason && <small className="muted">{story.reason}</small>}
                  </article>
                ))}
              </div>
            ) : !hasStoryMomentJob && (
              <p className="muted empty-inline">{hasTranscript ? 'No story moments yet. Use “Find story moments” above to generate them.' : 'Transcribe this podcast to find story moments.'}</p>
            )}
          </section>
      </div>
      <div id="detail-panel-clips" className="detail-tab-panel" role="tabpanel" aria-labelledby="detail-tab-clips" tabIndex={0} hidden={activeTab !== 'clips'}>
          <h3 className="sectiontitle">Reel suggestions ({clips.length})</h3>
          {!clips.length && <p className="muted">{selected?.transcript ? 'No reel suggestions are available yet.' : 'Transcribe the source to prepare reel suggestions.'}</p>}
          <div className="cliplist">
            {clips.map(clip => (
              <article className="clip" key={clip._id}>
                <div className="score">{clip.score}/10</div>
                <div className="clipbody">
                  <h3>{clip.title}</h3>
                  <p>{clip.hook}</p>
                  <p className="muted">{clip.start?.toFixed(1)}s – {clip.end?.toFixed(1)}s · {clip.reason}</p>
                  <div className="trimrow">
                    <label>In (sec)<input type="number" min="0" step="0.1" defaultValue={clip.start} onBlur={event => updateClip(clip._id, { start: Number(event.target.value) })} /></label>
                    <label>Out (sec)<input type="number" min="0.1" step="0.1" defaultValue={clip.end} onBlur={event => updateClip(clip._id, { end: Number(event.target.value) })} /></label>
                  </div>
                  <label>Caption</label>
                  <textarea aria-label={`Caption for ${clip.title}`} defaultValue={clip.caption} onBlur={event => updateClip(clip._id, { caption: event.target.value })} />
                  <div className="trimrow performance">
                    <label>Published views<input type="number" min="0" step="1" defaultValue={clip.performance?.views ?? ''} onBlur={event => updateClip(clip._id, { performance: { views: Number(event.target.value || 0) } })} /></label>
                    <label>Average watch time (sec)<input type="number" min="0" step="0.1" defaultValue={clip.performance?.watchTime ?? ''} onBlur={event => updateClip(clip._id, { performance: { watchTime: Number(event.target.value || 0) } })} /></label>
                  </div>
                  <div className="actions">
                    <button className="approve" onClick={() => updateClip(clip._id, { status: 'approved' })}><CheckCircle size={15} /> Approve</button>
                    <button className="reject" onClick={() => updateClip(clip._id, { status: 'rejected' })}>Reject</button>
                    <button className="secondary" onClick={() => editCameraPlan(clip)}>Camera plan</button>
                    <button onClick={() => renderClip(clip._id)} disabled={busy || ['queued', 'processing'].includes(clip.renderStatus)}>Render 9:16</button>
                    {['queued', 'processing'].includes(clip.renderStatus) && <span className="renderprogress">{clip.renderStatus} · {clip.renderProgress || 0}%</span>}
                    {clip.renderStatus === 'failed' && <span className="error">{clip.renderError || 'Render failed'}</span>}
                    {clip.renderStatus === 'completed' && (
                      <>
                        <button className="secondary" onClick={() => previewClip(clip._id)}>Preview render</button>
                        <button className="secondary" onClick={() => downloadClip(clip._id)}>Download MP4</button>
                      </>
                    )}
                  </div>
                </div>
                <span className={`status ${clip.status}`}>{clip.status}</span>
              </article>
            ))}
          </div>
      </div>
      <div id="detail-panel-generated" className="detail-tab-panel" role="tabpanel" aria-labelledby="detail-tab-generated" tabIndex={0} hidden={activeTab !== 'generated'}>
          {selected?.opusClipStatus && selected.opusClipStatus !== 'idle' ? (
            <section className="opusclip-results">
              <h3>Generated reels ({selected.opusClipClips?.length || 0})</h3>
              <p className={selected.opusClipStatus === 'failed' ? 'error' : 'muted'}>
                {selected.opusClipStatus === 'completed' ? 'Reels are ready.' : selected.opusClipStatus === 'failed' ? 'Reel generation failed. Please try again.' : 'Reels are being generated...'}
              </p>
              {hasOpusClipJob && (
                <div className="async-progress">
                  <span>{selected.opusClipStatus === 'queued' ? 'Starting reel generation…' : 'Generating your reels…'}</span>
                  <div className="indeterminate-progress" role="progressbar" aria-label="Generating reels" aria-valuetext="In progress">
                    <span />
                  </div>
                </div>
              )}
              {selected.opusClipClips?.length ? (
                <div className="opusclip-grid">
                  {selected.opusClipClips.map((opusClip, index) => (
                    <article className="opusclip-card" key={opusClip.id || index}>
                      <h4>{opusClip.title || `Reel ${index + 1}`}</h4>
                      {opusClip.durationMs && <small className="muted">{(opusClip.durationMs / 1000).toFixed(1)}s</small>}
                      {opusClip.text && <p>{opusClip.text}</p>}
                      <div className="opusclip-actions">
                        {opusClip.uriForPreview && <a className="secondary" href={opusClip.uriForPreview} target="_blank" rel="noreferrer">Preview</a>}
                        {opusClip.uriForExport && <a className="secondary" href={opusClip.uriForExport} target="_blank" rel="noreferrer">Download</a>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : !hasOpusClipJob && <p className="muted empty-inline">No reels are available yet.</p>}
            </section>
          ) : (
            <div className="empty-state">
              <h3>No generated reels yet</h3>
              <p className="muted">Generate Reels from a YouTube source or uploaded video.</p>
              <button className="secondary" onClick={generateOpusClips} disabled={busy || !selected?.transcript}>
                Generate Reels
              </button>
            </div>
          )}
        </div>
    </>
  );
}
