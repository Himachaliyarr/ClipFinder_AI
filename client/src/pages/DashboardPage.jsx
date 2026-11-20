import { Clapperboard, Search, Upload, X } from "lucide-react";
import PodcastCard from "../components/PodcastCard.jsx";

// Dashboard UI receives data and handlers from App; it does not make API requests.
export default function DashboardPage({ data, actions }) {
  const {
    metrics,
    metricsLoading,
    title,
    youtubeUrl,
    sourceKind,
    speakerKey,
    files,
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
    create,
    toggleSelectAllPodcasts,
    deleteSelectedPodcasts,
    open,
    updatePodcastMetadata,
    togglePodcastSelection,
    stopPodcastJob,
    restartPodcastJob,
  } = actions;

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">AI VIDEO WORKFLOW</span>
          <h2>
            Turn long podcasts into
            <br />
            short-form moments.
          </h2>
          <p>
            Upload source footage, transcribe it, then review AI-selected clips.
          </p>
        </div>
        <div className="heroicon">
          <Clapperboard size={64} />
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
              Upload a video or paste a YouTube link. YouTube video is
              downloaded only when you render a clip.
            </p>
            {uploadLimits && (
              <p className="muted">
                Upload limit: {uploadLimits.maxFiles} files per request, up to{" "}
                {Math.ceil(
                  (uploadLimits.maxResumableFileBytes ||
                    uploadLimits.maxFileBytes) /
                    1024 ** 3,
                )}{" "}
                GiB each. Large files resume in chunks.
              </p>
            )}
          </div>
        </div>
        <div className="upload-controls">
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
              Project folder <small>(client, show, campaign)</small>
            </span>
            <input
              maxLength="100"
              value={projectFolder}
              onChange={(event) => setProjectFolder(event.target.value)}
              placeholder="e.g. Client A / Season 2"
            />
          </label>
          <label>
            <span>
              Tags <small>(comma separated)</small>
            </span>
            <input
              maxLength="819"
              value={projectTags}
              onChange={(event) => setProjectTags(event.target.value)}
              placeholder="e.g. launch, interview, Hindi"
            />
          </label>
          {!youtubeUrl.trim() && (
            <>
              <label>
                <span>Source type</span>
                <select
                  value={sourceKind}
                  onChange={(event) => setSourceKind(event.target.value)}
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
                  onChange={(event) => setSpeakerKey(event.target.value)}
                  placeholder="e.g. host_a"
                />
              </label>
              <label>
                <span>Media files</span>
                <input
                  type="file"
                  multiple
                  accept="video/*,audio/*"
                  aria-label="Select audio or video files"
                  onChange={(event) => setFiles(event.target.files)}
                />
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
            <Upload size={16} />{" "}
            {busy
              ? "Creating…"
              : youtubeUrl.trim()
                ? "Transcribe YouTube link"
                : "Create & upload"}
          </button>
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
              <strong>{metrics ? `${metrics.averageWatchTime}s` : "—"}</strong>
            </article>
          </>
        )}
      </section>
      <section
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
    </>
  );
}
