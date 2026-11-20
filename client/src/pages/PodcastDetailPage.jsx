import { useEffect, useRef, useState } from 'react';
import { CheckCircle, PlayCircle, Trash2 } from 'lucide-react';
import { formatClipTimecode, formatTranscriptTimestamp, getTranscriptLinesInRange, parseClipTimecode } from '../utils/transcript.js';
import PodcastJobProgress, {
  canRestartPodcastJob,
  isPodcastJobActive,
} from '../components/PodcastJobProgress.jsx';
import TranscriptPanel from '../components/TranscriptPanel.jsx';
import ClipSentenceEditor from '../components/ClipSentenceEditor.jsx';

// Podcast processing, transcript, story, and clip controls belong to the detail page.
export default function PodcastDetailPage({ data, actions }) {
  const {
    selected,
    clips,
    busy,
    sourceKind,
    speakerKey,
    extraFiles,
    localMediaDirectoryName,
    localMediaCopyStatus,
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
    stopGeneration,
    restartPodcastJob,
    transcribe,
    generateStories,
    generateClipSuggestions,
    generateOpusClips,
    uploadMore,
    chooseLocalMediaFolder,
    setExportFormat,
    exportTranscript,
    setOpenTranscriptFor,
    updateClip,
    editCameraPlan,
    renderClip,
    previewClip,
    downloadClip,
    deleteRenderedClip,
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
  const [selectedClipIds, setSelectedClipIds] = useState([]);
  const [expandedTranscriptClips, setExpandedTranscriptClips] = useState([]);
  const [clipSaveStates, setClipSaveStates] = useState({});
  const [focusedTranscriptTime, setFocusedTranscriptTime] = useState(null);
  const [focusedClipId, setFocusedClipId] = useState(null);
  const [renderedPreviewUrl, setRenderedPreviewUrl] = useState(null);
  const clipSaveTimers = useRef(new Map());
  const filteredClips = clips.filter(clip => {
    const assignedTo = clip.assignedTo?._id || clip.assignedTo?.id || clip.assignedTo || '';
    return (clipStatusFilter === 'all' || clip.status === clipStatusFilter)
      && (clipAssigneeFilter === 'all' || (clipAssigneeFilter === 'unassigned' ? !assignedTo : String(assignedTo) === clipAssigneeFilter));
  });
  const hasSource = Boolean(selected?.sourceUrl || selected?.sourceFiles?.length);
  const momentsReady = Boolean(selected?.storyMoments?.length);
  const needsReview = clips.filter(clip => clip.status === 'suggested').length;
  const renderedClips = clips.filter(clip => clip.renderStatus === 'completed');
  const sourceVideos = (selected?.sourceFiles || []).filter(file => file.kind === 'video');
  const allVisibleClipsSelected = filteredClips.length > 0
    && filteredClips.every(clip => selectedClipIds.includes(clip._id));
  const workflowSteps = [
    { id: 'upload', label: 'Upload', complete: hasSource, target: 'source-upload' },
    { id: 'transcript', label: 'Transcribe', complete: hasTranscript, tab: 'transcript' },
    { id: 'stories', label: 'Review moments', complete: momentsReady, tab: 'stories' },
    { id: 'clips', label: 'Approve reels', complete: clips.length > 0 && needsReview === 0, tab: 'clips' },
    { id: 'generated', label: 'Export', complete: renderedClips.length > 0 || Boolean(selected?.opusClipClips?.length), tab: 'generated' },
  ];
  const currentWorkflowStep = workflowSteps.find(step => !step.complete)?.id || 'generated';
  useEffect(() => () => {
    if (renderedPreviewUrl) URL.revokeObjectURL(renderedPreviewUrl);
  }, [renderedPreviewUrl]);
  useEffect(() => () => {
    clipSaveTimers.current.forEach(timer => window.clearTimeout(timer));
  }, []);
  useEffect(() => {
    if (activeTab !== 'clips' || !focusedClipId) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector(`[data-clip-id="${focusedClipId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, focusedClipId]);
  async function openRenderedPreview(clipId) {
    const url = await previewClip(clipId);
    if (url) setRenderedPreviewUrl(url);
  }
  function findClipForRange(line) {
    return clips.find(clip => Number(clip.start) <= line.end && Number(clip.end) >= line.start);
  }
  function jumpToReelSuggestion(line) {
    const clip = findClipForRange(line);
    if (!clip) return;
    setClipStatusFilter('all');
    setClipAssigneeFilter('all');
    setFocusedClipId(clip._id);
    setActiveTab('clips');
  }
  function navigateWorkflowStep(step) {
    if (step.tab) setActiveTab(step.tab);
    if (step.target) document.getElementById(step.target)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function jumpToTranscript(clip) {
    setFocusedTranscriptTime(clip.start);
    setOpenTranscriptFor(selected?._id);
    setActiveTab('transcript');
  }
  async function updateSelectedClips(status) {
    const updated = await Promise.all(selectedClipIds.map(id => updateClip(id, { status })));
    if (updated.every(Boolean)) setSelectedClipIds([]);
  }
  async function saveInlineClipEdit(clip, field, value) {
    const previousValue = clip[field] ?? '';
    const nextValue = field === 'caption' ? String(value) : Number(value);
    const currentValue = field === 'caption' ? String(previousValue) : Number(previousValue);
    if (Object.is(nextValue, currentValue)) return;

    const timerKey = `${clip._id}:${field}`;
    window.clearTimeout(clipSaveTimers.current.get(timerKey));
    setClipSaveStates(current => ({
      ...current,
      [clip._id]: { ...current[clip._id], [field]: 'saving' },
    }));

    const saved = await updateClip(clip._id, { [field]: nextValue });
    setClipSaveStates(current => ({
      ...current,
      [clip._id]: { ...current[clip._id], [field]: saved ? 'saved' : 'failed' },
    }));
    if (saved) {
      const timer = window.setTimeout(() => {
        setClipSaveStates(current => {
          if (current[clip._id]?.[field] !== 'saved') return current;
          const next = { ...current, [clip._id]: { ...current[clip._id] } };
          delete next[clip._id][field];
          if (Object.keys(next[clip._id]).length === 0) delete next[clip._id];
          return next;
        });
        clipSaveTimers.current.delete(timerKey);
      }, 2200);
      clipSaveTimers.current.set(timerKey, timer);
    }
  }
  function clearClipSaveState(clipId, field) {
    setClipSaveStates(current => {
      if (!current[clipId]?.[field]) return current;
      const next = { ...current, [clipId]: { ...current[clipId] } };
      delete next[clipId][field];
      if (Object.keys(next[clipId]).length === 0) delete next[clipId];
      return next;
    });
  }
  function saveClipTimecodeEdit(clip, field, input) {
    const nextValue = parseClipTimecode(input.value);
    if (nextValue === null) {
      setClipSaveStates(current => ({
        ...current,
        [clip._id]: { ...current[clip._id], [field]: 'invalid' },
      }));
      return;
    }

    input.value = formatClipTimecode(nextValue);
    if (Object.is(nextValue, Number(clip[field]))) {
      clearClipSaveState(clip._id, field);
      return;
    }
    void saveInlineClipEdit(clip, field, nextValue);
  }
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
    { id: 'generated', label: `Exports (${renderedClips.length + (selected?.opusClipClips?.length || 0)})` },
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
          <>
            <button
              className="secondary"
              onClick={generateClipSuggestions}
              disabled={busy || isPodcastJobActive(selected?.status)}
            >
              {clips.length ? 'Regenerate reel suggestions' : 'Generate reel suggestions'}
            </button>
            <button
              className="secondary"
              onClick={generateStories}
              disabled={busy || hasStoryMomentJob}
            >
              {selected?.storyMomentsStatus === 'completed' ? 'Regenerate stories' : 'Find story moments'}
            </button>
            {hasStoryMomentJob && (
              <button className="secondary" onClick={() => stopGeneration(selected._id, 'stories')} disabled={busy}>
                Stop story finding
              </button>
            )}
          </>
        )}
        {selected?.transcript && (selected?.sourceUrl || selected?.sourceFiles?.some(file => file.kind === 'video')) && (
          <>
            <button
              className="secondary"
              onClick={openReelStoryPicker}
              disabled={busy || hasOpusClipJob}
            >
              Generate Reels
            </button>
            {hasOpusClipJob && (
              <button className="secondary" onClick={() => stopGeneration(selected._id, 'reels')} disabled={busy}>
                Stop reel generation
              </button>
            )}
          </>
        )}
      </section>
      <nav className="workflow-stepper" aria-label="Podcast production workflow">
        {workflowSteps.map((step, index) => {
          const current = step.id === currentWorkflowStep;
          return (
            <button
              type="button"
              key={step.id}
              className={`workflow-step${step.complete ? ' complete' : ''}${current ? ' current' : ''}`}
              aria-current={current ? 'step' : undefined}
              onClick={() => navigateWorkflowStep(step)}
            >
              <span className="workflow-step-number">{step.complete ? <CheckCircle size={16} /> : index + 1}</span>
              <span><strong>{step.label}</strong><small>{step.complete ? 'Complete' : current ? 'Next step' : 'Upcoming'}</small></span>
            </button>
          );
        })}
      </nav>
      <section className="create sourceupload" id="source-upload">
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
        <button type="button" className="secondary" onClick={chooseLocalMediaFolder} disabled={busy}>
          Choose local save folder
        </button>
        <span className="muted">{localMediaDirectoryName || 'Choose a destination for these tracks and later downloads.'}</span>
        <button onClick={uploadMore} disabled={busy || !extraFiles.length || !localMediaDirectoryName || (!speakerKey && sourceKind !== 'mix')}>
          Upload track
        </button>
        {localMediaCopyStatus && <p className="muted" role="status" aria-live="polite">{localMediaCopyStatus}…</p>}
        {uploadProgress && (
          <div className="upload-transfer-progress" role="status" aria-live="polite">
            <span>Uploading {uploadProgress.fileName} · {Math.floor(uploadProgress.loaded / 1024 ** 2)} / {Math.ceil(uploadProgress.total / 1024 ** 2)} MiB</span>
            <progress max={uploadProgress.total} value={uploadProgress.loaded} />
          </div>
        )}
        {selected?.sourceFiles?.length > 0 && (
          <div className="source-assets" aria-label="Uploaded source assets">
            <strong>Project sources</strong>
            {selected.sourceFiles.map((file, index) => (
              <div className="source-asset" key={`${file.originalName}-${index}`}>
                <span>{file.kind === 'video' ? 'Camera video' : file.kind === 'mix' ? 'Master mix' : 'Speaker mic'}</span>
                <span>{file.originalName || `Source ${index + 1}`}</span>
                {file.speaker && <small>{file.speaker}</small>}
                {Number.isFinite(file.size) && <small>{(file.size / 1024 ** 2).toFixed(1)} MiB</small>}
              </div>
            ))}
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
            focusedTime={focusedTranscriptTime}
            onPreviewRange={sourceVideos.length ? line => previewSourceClip({
              title: 'Transcript source preview',
              start: line.start,
              end: line.end,
            }) : null}
            hasClipForRange={line => Boolean(findClipForRange(line))}
            onFindReel={jumpToReelSuggestion}
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
                      : selected?.storyMomentsStatus === 'cancelled'
                        ? 'Story finding was stopped.'
                        : hasStoryMomentJob
                          ? 'Finding story moments…'
                          : hasTranscript
                            ? selected?.sourceUrl && !selected?.sourceFiles?.length
                              ? 'Click Find story moments above to generate story cards from this YouTube transcript.'
                              : 'Click Find story moments above to generate story cards from this transcript.'
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
                      {sourceVideos.length > 0 && (
                        <button
                          type="button"
                          className="secondary story-preview-action"
                          onClick={() => previewSourceClip({
                            title: story.title || `Story moment ${index + 1}`,
                            start: story.start,
                            end: story.end,
                          })}
                        >
                          <PlayCircle size={16} /> Preview video
                        </button>
                      )}
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
          {filteredClips.length > 0 && (
            <div className="clip-bulk-actions">
              <label className="clip-select-all">
                <input
                  type="checkbox"
                  checked={allVisibleClipsSelected}
                  onChange={() => setSelectedClipIds(current => (
                    allVisibleClipsSelected
                      ? current.filter(id => !filteredClips.some(clip => clip._id === id))
                      : [...new Set([...current, ...filteredClips.map(clip => clip._id)])]
                  ))}
                />
                Select visible ({filteredClips.length})
              </label>
              {selectedClipIds.length > 0 && (
                <div className="clip-bulk-buttons" role="group" aria-label="Bulk review actions">
                  <span>{selectedClipIds.length} selected</span>
                  <button type="button" className="approve" onClick={() => updateSelectedClips('approved')} disabled={busy}>
                    Approve selected
                  </button>
                  <button type="button" className="reject" onClick={() => updateSelectedClips('rejected')} disabled={busy}>
                    Reject selected
                  </button>
                </div>
              )}
            </div>
          )}
          {!clips.length && <p className="muted">{selected?.transcript ? 'No reel suggestions are available yet.' : 'Transcribe the source to prepare reel suggestions.'}</p>}
          {clips.length > 0 && !filteredClips.length && <p className="muted">No clips match these filters.</p>}
          <div className="cliplist">
            {filteredClips.map(clip => {
              const transcriptExcerpt = getTranscriptLinesInRange(selected?.segments, clip.start, clip.end);
              const isExcerptExpanded = expandedTranscriptClips.includes(clip._id);
              return (
              <article className={`clip${focusedClipId === clip._id ? ' clip-focused' : ''}`} data-clip-id={clip._id} key={clip._id}>
                <div className="clip-card-meta">
                  <label className="clip-select" onClick={event => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${clip.title}`}
                      checked={selectedClipIds.includes(clip._id)}
                      onChange={() => setSelectedClipIds(current => (
                        current.includes(clip._id) ? current.filter(id => id !== clip._id) : [...current, clip._id]
                      ))}
                    />
                  </label>
                  <div className="score">{clip.score}/10</div>
                </div>
                <div className="clipbody">
                  <div className="clip-title-row">
                    <h3>{clip.title}</h3>
                    {sourceVideos.length > 0 && (
                      <button className="secondary clip-preview-action" type="button" onClick={() => previewSourceClip(clip)}>
                        <PlayCircle size={16} /> Preview clip
                      </button>
                    )}
                  </div>
                  <p>{clip.hook}</p>
                  <p className="muted">{formatClipTimecode(clip.start)} – {formatClipTimecode(clip.end)} · {clip.reason}</p>
                  {transcriptExcerpt.length > 0 && (
                    <div className="clip-transcript-excerpt">
                      <strong>From transcript</strong>
                      {(isExcerptExpanded ? transcriptExcerpt : transcriptExcerpt.slice(0, 3)).map((line, index) => (
                        <p key={`${line.start}-${index}`}>{line.text}</p>
                      ))}
                      {transcriptExcerpt.length > 3 && (
                        <button
                          className="clip-excerpt-toggle"
                          type="button"
                          aria-expanded={isExcerptExpanded}
                          onClick={() => setExpandedTranscriptClips(current => (
                            isExcerptExpanded
                              ? current.filter(id => id !== clip._id)
                              : [...current, clip._id]
                          ))}
                        >
                          {isExcerptExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>
                  )}
                  <ClipSentenceEditor
                    clip={clip}
                    transcriptSegments={selected?.segments}
                    sourceDuration={selected?.duration}
                    onSave={updateClip}
                  />
                  <div className="trimrow">
                    <label>
                      In (HH:MM:SS)
                      <input
                        type="text"
                        placeholder="HH:MM:SS"
                        defaultValue={formatClipTimecode(clip.start)}
                        aria-invalid={clipSaveStates[clip._id]?.start === 'invalid'}
                        onBlur={event => saveClipTimecodeEdit(clip, 'start', event.currentTarget)}
                      />
                      <small className={`clip-save-state ${clipSaveStates[clip._id]?.start || ''}`} aria-live="polite">
                        {clipSaveStates[clip._id]?.start === 'invalid' ? 'Use HH:MM:SS, optionally with one decimal place.' : clipSaveStates[clip._id]?.start === 'saving' ? 'Saving…' : clipSaveStates[clip._id]?.start === 'saved' ? 'Saved' : clipSaveStates[clip._id]?.start === 'failed' ? 'Could not save' : ''}
                      </small>
                    </label>
                    <label>
                      Out (HH:MM:SS)
                      <input
                        type="text"
                        placeholder="HH:MM:SS"
                        defaultValue={formatClipTimecode(clip.end)}
                        aria-invalid={clipSaveStates[clip._id]?.end === 'invalid'}
                        onBlur={event => saveClipTimecodeEdit(clip, 'end', event.currentTarget)}
                      />
                      <small className={`clip-save-state ${clipSaveStates[clip._id]?.end || ''}`} aria-live="polite">
                        {clipSaveStates[clip._id]?.end === 'invalid' ? 'Use HH:MM:SS, optionally with one decimal place.' : clipSaveStates[clip._id]?.end === 'saving' ? 'Saving…' : clipSaveStates[clip._id]?.end === 'saved' ? 'Saved' : clipSaveStates[clip._id]?.end === 'failed' ? 'Could not save' : ''}
                      </small>
                    </label>
                  </div>
                  <button className="secondary" type="button" onClick={() => jumpToTranscript(clip)}>View in transcript</button>
                  <label>Caption</label>
                  <textarea aria-label={`Caption for ${clip.title}`} defaultValue={clip.caption} onBlur={event => saveInlineClipEdit(clip, 'caption', event.target.value)} />
                  <small className={`clip-save-state caption-save-state ${clipSaveStates[clip._id]?.caption || ''}`} aria-live="polite">
                    {clipSaveStates[clip._id]?.caption === 'saving' ? 'Saving caption…' : clipSaveStates[clip._id]?.caption === 'saved' ? 'Caption saved' : clipSaveStates[clip._id]?.caption === 'failed' ? 'Caption could not be saved' : ''}
                  </small>
                  <div className="trimrow performance">
                    <label>Published views<input type="number" min="0" step="1" defaultValue={clip.performance?.views ?? ''} onBlur={event => updateClip(clip._id, { performance: { views: Number(event.target.value || 0) } })} /></label>
                    <label>Average watch time (sec)<input type="number" min="0" step="0.1" defaultValue={clip.performance?.watchTime ?? ''} onBlur={event => updateClip(clip._id, { performance: { watchTime: Number(event.target.value || 0) } })} /></label>
                  </div>
                  <div className="actions">
                    {clip.status === 'suggested' && <button className="approve" onClick={() => updateClip(clip._id, { status: 'approved' })}><CheckCircle size={15} /> Approve</button>}
                    {['approved', 'rendered'].includes(clip.status) && <button className="approve" onClick={() => updateClip(clip._id, { status: 'published' })}>Mark published</button>}
                    {clip.status !== 'published' && <button className="reject" onClick={() => updateClip(clip._id, { status: 'rejected' })}>Reject</button>}
                    <button className="secondary" onClick={() => editCameraPlan(clip)}>Camera plan</button>
                    <button onClick={() => renderClip(clip._id, aspectRatio)} disabled={busy || ['queued', 'processing'].includes(clip.renderStatus)}>
                      {clip.renderStatus === 'completed' ? `Re-render ${aspectRatio}` : `Render ${aspectRatio}`}
                    </button>
                    {['queued', 'processing'].includes(clip.renderStatus) && <span className="renderprogress">{clip.renderStatus} · {clip.renderProgress || 0}%</span>}
                    {clip.renderStatus === 'failed' && <span className="error">{clip.renderError || 'Render failed'}</span>}
                    {clip.renderStatus === 'completed' && (
                      <>
                        <button className="secondary" onClick={() => openRenderedPreview(clip._id)}>Preview render</button>
                        <button className="secondary" onClick={() => downloadClip(clip._id)} disabled={busy}>Save to local folder</button>
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
              );
            })}
          </div>
      </div>
      <div id="detail-panel-generated" className="detail-tab-panel" role="tabpanel" aria-labelledby="detail-tab-generated" tabIndex={0} hidden={activeTab !== 'generated'}>
          <section className="opusclip-results rendered-results">
            <div className="rendered-results-heading">
              <div>
                <h3>Rendered clips ({clips.filter(clip => clip.renderStatus && clip.renderStatus !== 'idle').length})</h3>
                <p className="muted">Preview, download, or re-render locally generated clips.</p>
              </div>
              <label>
                <span>Output format</span>
                <select value={aspectRatio} onChange={event => setAspectRatio(event.target.value)} aria-label="Rendered clip output format">
                  <option value="9:16">Portrait (9:16)</option>
                  <option value="1:1">Square (1:1)</option>
                  <option value="16:9">Landscape (16:9)</option>
                </select>
              </label>
            </div>
            {clips.some(clip => clip.renderStatus && clip.renderStatus !== 'idle') ? (
              <div className="opusclip-grid">
                {clips.filter(clip => clip.renderStatus && clip.renderStatus !== 'idle').map(clip => {
                  const renderDuration = clip.sentenceEdits?.length
                    ? clip.sentenceEdits.reduce((total, sentence) => total + sentence.end - sentence.start, 0)
                    : clip.end - clip.start;
                  return (
                  <article className="opusclip-card generated-render-card" key={clip._id}>
                    <div className="generated-render-heading">
                      <h4>{clip.title}</h4>
                      <span className={`status ${clip.renderStatus}`}>{clip.renderStatus}</span>
                    </div>
                    <p className="muted">{renderDuration.toFixed(1)}s · {aspectRatio}</p>
                    {['queued', 'processing'].includes(clip.renderStatus) && (
                      <div className="rendered-progress">
                        <span>{clip.renderStatus} · {clip.renderProgress || 0}%</span>
                        <progress max="100" value={clip.renderProgress || 0} />
                      </div>
                    )}
                    {clip.renderStatus === 'failed' && <p className="error">{clip.renderError || 'Render failed'}</p>}
                    <div className="opusclip-actions">
                      {clip.renderStatus === 'completed' && (
                        <>
                          <button className="secondary" type="button" onClick={() => openRenderedPreview(clip._id)}>Preview</button>
                          <button className="secondary" type="button" onClick={() => downloadClip(clip._id)} disabled={busy}>Save to local folder</button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => renderClip(clip._id, aspectRatio)}
                        disabled={busy || ['queued', 'processing'].includes(clip.renderStatus)}
                      >
                        {clip.renderStatus === 'completed' ? 'Re-render' : 'Render'}
                      </button>
                      {['completed', 'failed'].includes(clip.renderStatus) && (
                        <button className="reject" type="button" onClick={() => deleteRenderedClip(clip._id)} disabled={busy}>
                          <Trash2 size={15} /> Delete render
                        </button>
                      )}
                    </div>
                  </article>
                  );
                })}
              </div>
            ) : <p className="muted empty-inline">No locally rendered clips yet. Approve a suggestion and render it to get started.</p>}
          </section>
          {selected?.opusClipStatus && selected.opusClipStatus !== 'idle' ? (
            <section className="opusclip-results">
              <h3>Generated reels ({selected.opusClipClips?.length || 0})</h3>
              <p className={selected.opusClipStatus === 'failed' ? 'error' : 'muted'}>
                {selected.opusClipStatus === 'completed'
                  ? 'Reels are ready.'
                  : selected.opusClipStatus === 'failed'
                    ? selected.opusClipError || 'Reel generation failed. Please try again.'
                    : selected.opusClipStatus === 'cancelled'
                      ? 'Reel generation was stopped.'
                      : 'Reels are being generated...'}
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
                      {opusClip.uriForPreview && (
                        <video className="opusclip-preview" controls preload="metadata" src={opusClip.uriForPreview}>
                          Your browser does not support video playback.
                        </video>
                      )}
                      <h4>{opusClip.title || `Reel ${index + 1}`}</h4>
                      {opusClip.durationMs && <small className="muted">{(opusClip.durationMs / 1000).toFixed(1)}s</small>}
                      {opusClip.text && <p>{opusClip.text}</p>}
                      <div className="opusclip-actions">
                        {opusClip.uriForExport && <a className="secondary" href={opusClip.uriForExport} target="_blank" rel="noreferrer">Open export</a>}
                      </div>
                    </article>
                  ))}
                </div>
              ) : !hasOpusClipJob && <p className="muted empty-inline">No reels are available yet.</p>}
            </section>
          ) : renderedClips.length === 0 ? (
            <div className="empty-state">
              <h3>No generated reels yet</h3>
              <p className="muted">Generate Reels from a YouTube source or uploaded video.</p>
              <button className="secondary" onClick={openReelStoryPicker} disabled={busy || !selected?.transcript}>
                Generate Reels
              </button>
            </div>
          ) : null}
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
      {renderedPreviewUrl && (
        <div className="clip-preview-backdrop" role="presentation" onClick={() => setRenderedPreviewUrl(null)}>
          <section className="clip-preview-modal rendered-preview-modal" role="dialog" aria-modal="true" aria-label="Rendered clip preview" onClick={event => event.stopPropagation()}>
            <div className="clip-preview-header">
              <h3>Rendered clip preview</h3>
              <button type="button" className="secondary" onClick={() => setRenderedPreviewUrl(null)}>Close preview</button>
            </div>
            <video src={renderedPreviewUrl} controls autoPlay />
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
