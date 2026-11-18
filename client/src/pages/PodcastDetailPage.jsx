import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { formatTranscriptTimestamp, getTranscriptLinesInRange } from '../utils/transcript.js';
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
    assignees,
    savingTranscript,
    previewSource,
    uploadProgress,
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
    saveTranscript,
    exportClipMetadata,
    exportStoryMetadata,
    previewSourceClip,
    closeSourcePreview,
  } = actions;
  const [activeTab, setActiveTab] = useState('transcript');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [storyExportFormat, setStoryExportFormat] = useState('pdf');
  const [showReelStoryPicker, setShowReelStoryPicker] = useState(false);
  const [selectedStoryIndexes, setSelectedStoryIndexes] = useState([]);
  const [clipStatusFilter, setClipStatusFilter] = useState('all');
  const [clipAssigneeFilter, setClipAssigneeFilter] = useState('all');
  const filteredClips = clips.filter(clip => {
    const assignedTo = clip.assignedTo?._id || clip.assignedTo?.id || clip.assignedTo || '';
    return (clipStatusFilter === 'all' || clip.status === clipStatusFilter)
      && (clipAssigneeFilter === 'all' || (clipAssigneeFilter === 'unassigned' ? !assignedTo : String(assignedTo) === clipAssigneeFilter));
  });
  function openReelStoryPicker() {
    setSelectedStoryIndexes((selected?.storyMoments || []).map((_, index) => index).slice(0, 8));
    setShowReelStoryPicker(true);
  }
  function toggleStoryIndex(index) {
    setSelectedStoryIndexes(current => {
      if (current.includes(index)) return current.filter(item => item !== index);
      return current.length < 8 ? [...current, index] : current;
    });
  }
  async function confirmReelGeneration() {
    await generateOpusClips(selectedStoryIndexes);
    setShowReelStoryPicker(false);
  }
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
            onClick={openReelStoryPicker}
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
        {uploadProgress && (
          <div className="upload-transfer-progress" role="status" aria-live="polite">
            <span>Uploading {uploadProgress.fileName} · {Math.floor(uploadProgress.loaded / 1024 ** 2)} / {Math.ceil(uploadProgress.total / 1024 ** 2)} MiB</span>
            <progress max={uploadProgress.total} value={uploadProgress.loaded} />
          </div>
        )}
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
            saveTranscript={saveTranscript}
            savingTranscript={savingTranscript}
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
              {selected?.storyMoments?.length > 0 && (
                <div className="transcript-actions">
                  <select
                    className="transcript-export-format"
                    aria-label="Story export format"
                    value={storyExportFormat}
                    onChange={event => setStoryExportFormat(event.target.value)}
                  >
                    <option value="pdf">PDF</option>
                    <option value="docx">Word (.docx)</option>
                    <option value="txt">Text (.txt)</option>
                    <option value="csv">CSV (.csv)</option>
                  </select>
                  <button type="button" className="secondary" onClick={() => exportStoryMetadata(storyExportFormat)}>Export stories</button>
                </div>
              )}
            </div>
            {selected?.storyMoments?.length ? (
              <div className="story-grid">
                {selected.storyMoments.map((story, index) => {
                  const scriptLines = getTranscriptLinesInRange(selected.segments, story.start, story.end);
                  return (
                    <article className="story-card" key={`${story.start}-${index}`}>
                      <div className="story-card-top">
                        <span className="story-time">
                          {formatTranscriptTimestamp(story.start)} – {formatTranscriptTimestamp(story.end)}
                        </span>
                        <span className="score">{story.score}/10</span>
                      </div>
                      <h4>{story.title}</h4>
                      <p>{story.summary}</p>
                      {scriptLines.length ? (
                        <div className="story-script">
                          <strong className="story-script-heading">Exact transcript</strong>
                          {scriptLines.map(line => {
                            return (
                              <p className="story-script-line" key={`${line.start}-${line.end}`}>
                                <span className="story-script-time">
                                  {formatTranscriptTimestamp(line.start)}–{formatTranscriptTimestamp(line.end)}
                                </span>
                                <span>{line.text}</span>
                              </p>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="muted">Timestamped transcript is unavailable for this range.</p>
                      )}
                      {story.excerpt && <blockquote>{story.excerpt}</blockquote>}
                      {story.reason && <small className="muted">{story.reason}</small>}
                    </article>
                  );
                })}
              </div>
            ) : !hasStoryMomentJob && (
              <p className="muted empty-inline">{hasTranscript ? 'No story moments yet. Use “Find story moments” above to generate them.' : 'Transcribe this podcast to find story moments.'}</p>
            )}
          </section>
      </div>
      <div id="detail-panel-clips" className="detail-tab-panel" role="tabpanel" aria-labelledby="detail-tab-clips" tabIndex={0} hidden={activeTab !== 'clips'}>
          <div className="clip-library-heading">
            <h3 className="sectiontitle">Reel suggestions ({filteredClips.length}{filteredClips.length !== clips.length ? ` of ${clips.length}` : ''})</h3>
            <div className="clip-library-actions">
              <label>
                <span>Review status</span>
                <select value={clipStatusFilter} onChange={event => setClipStatusFilter(event.target.value)} aria-label="Filter clips by review status">
                  <option value="all">All statuses</option>
                  <option value="suggested">Needs review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="rendered">Rendered</option>
                  <option value="published">Published</option>
                </select>
              </label>
              <label>
                <span>Assigned editor</span>
                <select value={clipAssigneeFilter} onChange={event => setClipAssigneeFilter(event.target.value)} aria-label="Filter clips by assigned editor">
                  <option value="all">All editors</option>
                  <option value="unassigned">Unassigned</option>
                  {assignees.map(user => (
                    <option value={user._id || user.id} key={user._id || user.id}>{user.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Social format</span>
                <select value={aspectRatio} onChange={event => setAspectRatio(event.target.value)} aria-label="Social video format">
                  <option value="9:16">TikTok / Reels / Shorts (9:16)</option>
                  <option value="1:1">Square feed (1:1)</option>
                  <option value="16:9">Landscape (16:9)</option>
                </select>
              </label>
              <button type="button" className="secondary" onClick={exportClipMetadata} disabled={!clips.length}>Export CSV</button>
            </div>
          </div>
          {!clips.length && <p className="muted">{selected?.transcript ? 'No reel suggestions are available yet.' : 'Transcribe the source to prepare reel suggestions.'}</p>}
          {clips.length > 0 && !filteredClips.length && <p className="muted">No clips match these filters.</p>}
          <div className="cliplist">
            {filteredClips.map(clip => (
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
                  {selected?.sourceFiles?.some(file => file.kind === 'video') && (
                    <button className="secondary" type="button" onClick={() => previewSourceClip(clip)}>Preview source segment</button>
                  )}
                  <label>Caption</label>
                  <textarea aria-label={`Caption for ${clip.title}`} defaultValue={clip.caption} onBlur={event => updateClip(clip._id, { caption: event.target.value })} />
                  <div className="trimrow performance">
                    <label>Published views<input type="number" min="0" step="1" defaultValue={clip.performance?.views ?? ''} onBlur={event => updateClip(clip._id, { performance: { views: Number(event.target.value || 0) } })} /></label>
                    <label>Average watch time (sec)<input type="number" min="0" step="0.1" defaultValue={clip.performance?.watchTime ?? ''} onBlur={event => updateClip(clip._id, { performance: { watchTime: Number(event.target.value || 0) } })} /></label>
                  </div>
                  <div className="actions">
                    {clip.status === 'suggested' && <button className="approve" onClick={() => updateClip(clip._id, { status: 'approved' })}><CheckCircle size={15} /> Approve</button>}
                    {['approved', 'rendered'].includes(clip.status) && <button className="approve" onClick={() => updateClip(clip._id, { status: 'published' })}>Mark published</button>}
                    {clip.status !== 'published' && <button className="reject" onClick={() => updateClip(clip._id, { status: 'rejected' })}>Reject</button>}
                    <button className="secondary" onClick={() => editCameraPlan(clip)}>Camera plan</button>
                    <button onClick={() => renderClip(clip._id, aspectRatio)} disabled={busy || ['queued', 'processing'].includes(clip.renderStatus)}>Render {aspectRatio}</button>
                    {['queued', 'processing'].includes(clip.renderStatus) && <span className="renderprogress">{clip.renderStatus} · {clip.renderProgress || 0}%</span>}
                    {clip.renderStatus === 'failed' && <span className="error">{clip.renderError || 'Render failed'}</span>}
                    {clip.renderStatus === 'completed' && (
                      <>
                        <button className="secondary" onClick={() => previewClip(clip._id)}>Preview render</button>
                        <button className="secondary" onClick={() => downloadClip(clip._id)}>Download MP4</button>
                      </>
                    )}
                  </div>
                  {assignees?.length > 0 && (
                    <label className="clip-assignee">
                      Assigned editor
                      <select value={clip.assignedTo?._id || clip.assignedTo || ''} onChange={event => updateClip(clip._id, { assignedTo: event.target.value || null })}>
                        <option value="">Unassigned</option>
                        {assignees.map(user => <option value={user._id || user.id} key={user._id || user.id}>{user.name}</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <span className={`status ${clip.status}`}>{clip.status === 'suggested' ? 'Needs review' : clip.status}</span>
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
              <button className="secondary" onClick={openReelStoryPicker} disabled={busy || !selected?.transcript}>
                Generate Reels
              </button>
            </div>
          )}
        </div>
      {previewSource && (
        <div className="clip-preview-backdrop" role="presentation" onClick={closeSourcePreview}>
          <section className="clip-preview-modal" role="dialog" aria-modal="true" aria-labelledby="clip-preview-title" onClick={event => event.stopPropagation()}>
            <div className="clip-preview-header">
              <h3 id="clip-preview-title">{previewSource.title}</h3>
              <button type="button" className="secondary" onClick={closeSourcePreview}>Close preview</button>
            </div>
            <video
              key={previewSource.url}
              src={previewSource.url}
              controls
              autoPlay
              onLoadedMetadata={event => { event.currentTarget.currentTime = previewSource.start; }}
              onTimeUpdate={event => {
                if (event.currentTarget.currentTime >= previewSource.end) event.currentTarget.pause();
              }}
            />
            <p className="muted">Previewing {previewSource.start.toFixed(1)}–{previewSource.end.toFixed(1)} seconds from the source.</p>
          </section>
        </div>
      )}
      {showReelStoryPicker && (
        <div className="clip-preview-backdrop" role="presentation" onClick={() => setShowReelStoryPicker(false)}>
          <section className="clip-preview-modal reel-story-picker" role="dialog" aria-modal="true" aria-labelledby="reel-story-picker-title" onClick={event => event.stopPropagation()}>
            <div className="clip-preview-header">
              <h3 id="reel-story-picker-title">Select story moments for reels</h3>
              <button type="button" className="secondary" onClick={() => setShowReelStoryPicker(false)}>Close</button>
            </div>
            {selected?.storyMoments?.length ? (
              <>
                <div className="reel-story-picker-actions">
                  <button type="button" className="secondary" onClick={() => setSelectedStoryIndexes(selected.storyMoments.map((_, index) => index).slice(0, 8))}>Select all</button>
                  <button type="button" className="secondary" onClick={() => setSelectedStoryIndexes([])}>Deselect all</button>
                </div>
                <div className="reel-story-options">
                  {selected.storyMoments.map((story, index) => (
                    <label className="reel-story-option" key={`${story.start}-${story.end}-${index}`}>
                      <input
                        type="checkbox"
                        checked={selectedStoryIndexes.includes(index)}
                        onChange={() => toggleStoryIndex(index)}
                      />
                      <span>
                        <strong>{story.title || `Story ${index + 1}`}</strong>
                        <small>{formatTranscriptTimestamp(story.start)} – {formatTranscriptTimestamp(story.end)}{story.summary ? ` · ${story.summary}` : ''}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={confirmReelGeneration}
                  disabled={busy || selectedStoryIndexes.length === 0}
                >
                  Generate reels for {selectedStoryIndexes.length} story {selectedStoryIndexes.length === 1 ? 'moment' : 'moments'}
                </button>
              </>
            ) : (
              <p className="muted">No story moments are available. Generate story moments first.</p>
            )}
          </section>
        </div>
      )}
    </>
  );
}
