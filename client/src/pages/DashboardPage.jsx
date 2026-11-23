import { useState } from "react";
import { Clapperboard, FileVideo2, Search, Upload, X } from "lucide-react";
import PodcastCard from "../components/PodcastCard.jsx";

function formatFileSize(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// Dashboard UI receives data and handlers from App; it does not make API requests.
export default function DashboardPage({ data, actions }) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const {
    metrics,
    metricsLoading,
    title,
    youtubeUrl,
    sourceKind,
    speakerKey,
    files,
    localMediaDirectoryName,
    localMediaCopyStatus,
    uploadLimits,
    uploadProgress,
    busy,
    podcasts,
    filteredPodcasts,
    allPodcastsSelected,
    selectedPodcastIds,
    canDeletePodcasts,
    podcastSearch,
    podcastStatusFilter,
    podcastDateFrom,
    podcastDateTo,
    projectFolder,
    projectTags,
    folderFilter,
    folderOptions,
    podcastsLoaded,
    podcastsLoadFailed,
    podcastsLoadError,
    showRecentPodcasts,
  } = data;
  const {
    setPodcastSearch,
    setPodcastStatusFilter,
    setPodcastDateFrom,
    setPodcastDateTo,
    setProjectFolder,
    setProjectTags,
    setFolderFilter,
    refreshDashboard,
    setTitle,
    setYoutubeUrl,
    setSourceKind,
    setSpeakerKey,
    setFiles,
    chooseLocalMediaFolder,
    create,
    toggleSelectAllPodcasts,
    deleteSelectedPodcasts,
    open,
    updatePodcastMetadata,
    togglePodcastSelection,
    stopPodcastJob,
    restartPodcastJob,
  } = actions;

  function updateFiles(fileList) {
    setFiles(Array.from(fileList || []));
  }

  return (
    <>
      {!showRecentPodcasts && (
        <>
          <section className="hero">
            <div>
              <span className="eyebrow">AI VIDEO WORKFLOW</span>
              <h2>Turn long podcasts into short-form moments.</h2>
              <p>
                Upload your video to start transcription and clip suggestions.
              </p>
              <a className="hero-cta" href="#new-podcast-form">
                <Upload size={17} aria-hidden="true" />
                New podcast
              </a>
            </div>
            <div className="heroicon" aria-hidden="true">
              <Clapperboard size={56} />
            </div>
          </section>
          <section
            className="create upload-panel"
            id="new-podcast-form"
            aria-labelledby="new-podcast-heading"
          >
            <div className="upload-panel-heading">
              <div>
                <span className="eyebrow">START A PROJECT</span>
                <h3 id="new-podcast-heading">New podcast</h3>
                <p className="muted">
                  Add a video or paste a YouTube link to get started.
                </p>
                {uploadLimits && (
                  <p className="muted upload-limit-note">
                    Up to {uploadLimits.maxFiles} files,{" "}
                    {Math.ceil(
                      (uploadLimits.maxResumableFileBytes ||
                        uploadLimits.maxFileBytes) /
                        1024 ** 3,
                    )}{" "}
                    GiB each.
                  </p>
                )}
              </div>
            </div>
            <div className="upload-controls">
              <section
                className="upload-group"
                aria-labelledby="project-details-heading"
              >
                <h4 id="project-details-heading">Project details</h4>
                <div className="upload-group-fields">
                  <label>
                    <span>Podcast name</span>
                    <input
                      value={title ?? ""}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="e.g. Episode 12 — Creator Stories"
                    />
                  </label>
                  <label>
                    <span>
                      Tags <small>(optional, comma separated)</small>
                    </span>
                    <input
                      maxLength="819"
                      value={projectTags}
                      onChange={(event) => setProjectTags(event.target.value)}
                      placeholder="e.g. launch, interview, Hindi"
                    />
                  </label>
                </div>
              </section>
              <section
                className="upload-group"
                aria-labelledby="video-source-heading"
              >
                <h4 id="video-source-heading">Video source</h4>
                <div className="upload-group-fields">
                  {!youtubeUrl.trim() && (
                    <>
                      <label>
                        <span>Source type</span>
                        <select
                          value={sourceKind}
                          onChange={(event) =>
                            setSourceKind(event.target.value)
                          }
                        >
                          <option value="video">Camera video</option>
                          <option value="audio">Speaker mic track</option>
                          <option value="mix">Master mix audio</option>
                        </select>
                      </label>
                      <label>
                        <span>
                          Speaker key <small>(optional for master mix)</small>
                        </span>
                        <input
                          value={speakerKey ?? ""}
                          onChange={(event) =>
                            setSpeakerKey(event.target.value)
                          }
                          placeholder="e.g. host_a"
                        />
                      </label>
                      <label className="upload-dropzone-field">
                        <span>Video files</span>
                        <div
                          className={`upload-dropzone${isDraggingFiles ? " is-dragging" : ""}`}
                          onDragEnter={(event) => {
                            event.preventDefault();
                            setIsDraggingFiles(true);
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDragLeave={(event) => {
                            if (
                              !event.currentTarget.contains(event.relatedTarget)
                            )
                              setIsDraggingFiles(false);
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            setIsDraggingFiles(false);
                            updateFiles(event.dataTransfer.files);
                          }}
                        >
                          <FileVideo2 size={28} aria-hidden="true" />
                          <span>
                            select file to upload here <strong>Upload</strong>
                          </span>
                          <input
                            type="file"
                            multiple
                            accept="video/*,audio/*"
                            aria-label="Select audio or video files"
                            onChange={(event) =>
                              updateFiles(event.target.files)
                            }
                          />
                        </div>
                        {files.length > 0 && (
                          <ul
                            className="selected-upload-files"
                            aria-live="polite"
                          >
                            {files.map((file, index) => (
                              <li key={`${file.name}-${file.size}-${index}`}>
                                <span>{file.name}</span>
                                <small>{formatFileSize(file.size)}</small>
                              </li>
                            ))}
                          </ul>
                        )}
                      </label>
                    </>
                  )}
                  <label className="upload-url-field">
                    <span>
                      YouTube link <small>(optional)</small>
                    </span>
                    <input
                      type="url"
                      value={youtubeUrl ?? ""}
                      onChange={(event) => setYoutubeUrl(event.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                    />
                  </label>
                </div>
              </section>
              <details className="upload-advanced">
                <summary>Advanced options</summary>
                <div className="upload-group-fields">
                  <label>
                    <span>
                      Project folder <small>(client, show, campaign)</small>
                    </span>
                    <input
                      maxLength="100"
                      value={projectFolder}
                      onChange={(event) => setProjectFolder(event.target.value)}
                      placeholder="e.g. Client A / Season 2"
                    />
                  </label>
                  <div className="local-media-destination">
                    <button
                      type="button"
                      className="secondary"
                      onClick={chooseLocalMediaFolder}
                      disabled={busy}
                    >
                      Choose local save folder (optional)
                    </button>
                    <span className="muted">
                      {localMediaDirectoryName ||
                        "Local copy is optional; uploads still go to the workspace."}
                    </span>
                  </div>
                </div>
              </details>
              <div className="upload-submit-row">
                <button
                  className="upload-submit"
                  onClick={create}
                  disabled={
                    busy ||
                    !title ||
                    (!files.length && !youtubeUrl.trim()) ||
                    (files.length && youtubeUrl.trim())
                  }
                >
                  <Upload size={18} />
                  {busy
                    ? uploadProgress
                      ? "Uploading…"
                      : "Starting transcription…"
                    : youtubeUrl.trim()
                      ? "Transcribe YouTube link"
                      : "Upload & transcribe"}
                </button>
                {localMediaCopyStatus && (
                  <p className="muted" role="status" aria-live="polite">
                    {localMediaCopyStatus}…
                  </p>
                )}
              </div>
              {busy && !uploadProgress && (
                <div
                  className="upload-transfer-progress"
                  role="status"
                  aria-live="polite"
                >
                  <span>
                    {youtubeUrl.trim()
                      ? "Sending your YouTube link…"
                      : "Preparing your upload…"}
                  </span>
                  <progress aria-label="Preparing podcast" />
                </div>
              )}
              {uploadProgress && (
                <div
                  className="upload-transfer-progress"
                  role="status"
                  aria-live="polite"
                >
                  <span>
                    Uploading {uploadProgress.fileName} ·{" "}
                    {Math.floor(uploadProgress.loaded / 1024 ** 2)} /{" "}
                    {Math.ceil(uploadProgress.total / 1024 ** 2)} MiB
                  </span>
                  <progress
                    max={uploadProgress.total}
                    value={uploadProgress.loaded}
                    aria-label="Video upload progress"
                  />
                </div>
              )}
            </div>
          </section>
          <section
            className="metricgrid"
            aria-label="Production metrics"
            aria-busy={metricsLoading}
          >
            {metricsLoading && !metrics ? (
              <div
                className="metric-skeletons"
                role="status"
                aria-label="Loading production metrics"
              >
                {Array.from({ length: 5 }, (_, index) => (
                  <span className="metric-skeleton" key={index} />
                ))}
              </div>
            ) : (
              <>
                <article>
                  <small>Podcasts</small>
                  <strong>{metrics?.podcastCount ?? "—"}</strong>
                </article>
                <article>
                  <small>AI clips</small>
                  <strong>{metrics?.clipCount ?? "—"}</strong>
                </article>
                <article>
                  <small>Editor approval</small>
                  <strong>{metrics ? `${metrics.approvalRate}%` : "—"}</strong>
                </article>
                <article>
                  <small>Published views entered</small>
                  <strong>{metrics?.totalViews ?? "—"}</strong>
                </article>
                <article>
                  <small>Average watch time</small>
                  <strong>
                    {metrics ? `${metrics.averageWatchTime}s` : "—"}
                  </strong>
                </article>
              </>
            )}
          </section>
        </>
      )}
      {showRecentPodcasts && (
        <section
          id="recent-podcasts-section"
          className="podcast-library"
          aria-labelledby="recent-podcasts-heading"
        >
          <div className="library-heading">
            <div>
              <h3 id="recent-podcasts-heading">Recent podcasts</h3>
              <p className="muted">
                {podcastsLoaded
                  ? `${podcasts.length} total · ${filteredPodcasts.length} shown`
                  : "Loading podcasts..."}
              </p>
            </div>
          </div>
          <div
            className="podcast-filters"
            role="search"
            aria-label="Filter podcasts"
          >
            <label className="podcast-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={podcastSearch}
                onChange={(event) => setPodcastSearch(event.target.value)}
                placeholder="Search titles or tags"
                aria-label="Search podcast titles and tags"
              />
              {podcastSearch && (
                <button
                  type="button"
                  className="clear-search"
                  onClick={() => setPodcastSearch("")}
                  aria-label="Clear podcast search"
                >
                  <X size={16} />
                </button>
              )}
            </label>
            <label className="status-filter">
              <span>Folder</span>
              <select
                value={folderFilter}
                onChange={(event) => setFolderFilter(event.target.value)}
                aria-label="Filter podcasts by folder"
              >
                <option value="all">All folders</option>
                <option value="">Unfiled</option>
                {folderOptions.map((folder) => (
                  <option value={folder} key={folder}>
                    {folder}
                  </option>
                ))}
              </select>
            </label>
            <label className="status-filter">
              <span>Status</span>
              <select
                value={podcastStatusFilter}
                onChange={(event) => setPodcastStatusFilter(event.target.value)}
                aria-label="Filter podcasts by status"
              >
                <option value="all">All statuses</option>
                <option value="downloading">Downloading</option>
                <option value="queued">Queued</option>
                <option value="processing">Processing</option>
                <option value="transcribed">Transcribed</option>
                <option value="clips_ready">Clips ready</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
            <label className="status-filter">
              <span>From date</span>
              <input
                type="date"
                value={podcastDateFrom}
                max={podcastDateTo || undefined}
                onChange={(event) => setPodcastDateFrom(event.target.value)}
                aria-label="Filter podcasts created from date"
              />
            </label>
            <label className="status-filter">
              <span>To date</span>
              <input
                type="date"
                value={podcastDateTo}
                min={podcastDateFrom || undefined}
                onChange={(event) => setPodcastDateTo(event.target.value)}
                aria-label="Filter podcasts created until date"
              />
            </label>
            {canDeletePodcasts && podcasts.length > 0 && (
              <label className="select-all-podcasts">
                <input
                  type="checkbox"
                  checked={allPodcastsSelected}
                  onChange={toggleSelectAllPodcasts}
                  disabled={!filteredPodcasts.length || busy}
                />
                Select shown
              </label>
            )}
            {selectedPodcastIds.length > 0 && (
              <div
                className="selection-actions"
                role="group"
                aria-label="Selected podcasts"
              >
                <span className="muted">
                  {selectedPodcastIds.length} selected
                </span>
                {canDeletePodcasts && (
                  <button
                    className="secondary"
                    onClick={deleteSelectedPodcasts}
                    disabled={busy}
                  >
                    {busy ? "Deleting…" : "Delete selected"}
                  </button>
                )}
              </div>
            )}
          </div>
          {!podcastsLoaded ? (
            <div
              className="cards podcast-skeletons"
              role="status"
              aria-label="Loading podcasts"
            >
              {Array.from({ length: 3 }, (_, index) => (
                <div className="podcast-skeleton" key={index} />
              ))}
            </div>
          ) : podcastsLoadFailed ? (
            <div className="empty-state" role="status">
              <h4>Couldn’t load podcasts</h4>
              <p className="muted">
                {podcastsLoadError || "Check your connection, then try again."}
              </p>
              <button className="secondary" onClick={refreshDashboard}>
                Retry
              </button>
            </div>
          ) : podcasts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">
                <Clapperboard size={24} />
              </span>
              <h4>No podcasts yet</h4>
              <p className="muted">
                Create your first project to start turning long recordings into
                short clips.
              </p>
              <a className="empty-state-link" href="#new-podcast-form">
                Create your first podcast
              </a>
            </div>
          ) : filteredPodcasts.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">
                <Search size={22} />
              </span>
              <h4>No matching podcasts</h4>
              <p className="muted">Try another title or status filter.</p>
              <button
                className="secondary"
                onClick={() => {
                  setPodcastSearch("");
                  setPodcastStatusFilter("all");
                  setFolderFilter("all");
                  setPodcastDateFrom("");
                  setPodcastDateTo("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="cards" aria-live="polite">
              {filteredPodcasts.map((podcast) => (
                <PodcastCard
                  key={podcast._id}
                  podcast={podcast}
                  canDelete={canDeletePodcasts}
                  selected={selectedPodcastIds.includes(podcast._id)}
                  busy={busy}
                  onOpen={open}
                  onUpdateMetadata={updatePodcastMetadata}
                  onToggleSelection={togglePodcastSelection}
                  onStop={stopPodcastJob}
                  onRestart={restartPodcastJob}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
