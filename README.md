# ClipFinder AI — Vande Digital

Internal podcast-to-reels production workspace based on the supplied **ClipFinder AI Project Blueprint (10 Nov 2026)**. This repository is a runnable MVP foundation with a React dashboard, Express API, MongoDB data models, local/NAS media storage, Sarvam/Deepgram transcription integrations, LLM-based clip suggestions, editor approval workflow, and FFmpeg/Python worker utilities.

## Codebase architecture

```text
client/src/
  components/   Reusable UI and workspace chrome
  context/      Shared page data/actions through React Context
  pages/        Route-level screens; presentation consumes context, not API calls
  services/     API client and cross-page service integrations
  utils/        Reusable formatting, media, transcript, and export helpers
server/src/
  config/       Dotenv loading, validated settings, database and upload limits
  middleware/   Authentication, async route forwarding, and API error responses
  models/       MongoDB schemas
  routes/       API composition, podcast analytics, and other domain handlers
  services/     Transcription, selection, rendering, and provider integrations
  workers/      Background media-job processing
  scripts/      Explicit admin and backup operations
```

`App.jsx` owns workspace state and workflows; page components receive the current page's data and actions through `WorkspaceProvider`/`useWorkspace`. Keep UI rendering in `pages/` and reusable presentation in `components/`; put shared transformations in `utils/` and network access in `services/`. The API client is centralized in `client/src/services/apiClient.js`.

The server loads the root `.env` via `server/src/config/env.js`. Runtime modules read settings from `server/src/config/settings.js`; add new environment values there rather than reading `process.env` from feature code. Keep secrets only in `.env` or the deployment environment, never in source control. Upload-limit settings are validated in `server/src/config/limits.js`.

API endpoints are mounted under `/api` by `server/src/routes/index.js`; domain routers are mounted there without changing their public paths. Add async handlers with `asyncHandler` and let `errorHandler` produce the standard `{ error, requestId }` response for unexpected failures. Route-specific validation should continue returning explicit 4xx responses. Media files are not served from a public static directory.

Podcast analytics and backup/audit endpoints live in `server/src/routes/podcastAnalytics.js` and are mounted under `/api/podcasts/analytics`. The remaining podcast endpoints are still in `podcasts.js`; extract the next cohesive group when its middleware and dependencies can move with it. This incremental approach preserves existing API contracts while the route surface grows.

## Transcription providers and timing

Sarvam Saaras v4 is the default and returns phrase/chunk timestamps. Deepgram Nova-3 is available as an optional provider (`STT_PROVIDER=deepgram`) and returns word timestamps; it uses multilingual mode for Hindi/English code-switching. Provider accuracy, especially Roman-script Hinglish, still needs comparison on the same authorized sample before choosing a production default. Timing metadata identifies the actual granularity and never invents word timestamps.

Official docs:
- https://docs.sarvam.ai/api/api-guides-tutorials/models/saaras
- https://developers.deepgram.com/docs/models-languages-overview
- https://developers.deepgram.com/docs/multilingual-code-switching

## Included today

- Email/password login with rate-limited authentication and roles (`admin`, `editor`, `viewer`) with JWT.
- Podcast records and resumable multi-file uploads to `MEDIA_ROOT` (point this to your office NAS mount). Resumable uploads support files up to 100 GiB by default in 16 MiB chunks; the legacy multipart endpoint retains its separate 5 GiB default cap.
- Audio extraction using FFmpeg.
- Long audio split into 25-second REST chunks and sent to the configured STT provider; Sarvam `saaras:v4` is the default and Deepgram Nova-3 is available for word-timing comparisons.
- Transcript segments and provider-specific phrase/word timing metadata persisted in MongoDB.
- Optional OpenAI-compatible LLM call to propose 15–25 reel candidates with hook/title/caption/score/reason.
- Clip list, approve/reject, caption editing and activity events.
- Workspace-wide project folders and tags with dashboard filters.
- Line-level transcript editing, SubRip/WebVTT downloads, and clip metadata CSV export.
- Review assignments, Needs review/Approved/Published clip workflow, source-segment preview, and 9:16/1:1/16:9 render presets.
- In-app notifications for background processing, reel generation, and render completion/failure.
- BullMQ/Redis durable transcription and render jobs with retries and a separately supervised worker process.
- Live background-job progress/failure status, admin team/role management, audit activity, and a production metrics/learning-loop dashboard.
- Speaker-keyed multi-camera cut plans, 1080x1920 FFmpeg render pipeline, branded ASS captions, trim validation, re-render versioning and authenticated preview endpoint.
- Authenticated MP4 download and manually entered per-clip performance and per-podcast AI-cost tracking; approved examples seed later clip-selection prompts.
- Export rendered clips as MP4 (H.264) or MOV (ProRes 422); export editing timelines as Premiere XML, EDL, or JSON, and transcripts/subtitles as TXT, JSON, DOCX, PDF, SRT, or VTT. The Exports tab can bundle these project/transcript files and already-rendered clips into one ZIP without starting new renders.
- Automatic speaker-to-camera cut suggestions from synchronized isolated mic tracks using the included RMS timeline utility; editor review is still required.
- FFmpeg 9:16 rough-cut utility.
- Docker Compose for MongoDB and Redis.

## Production readiness boundary

BullMQ transcription/render jobs, speaker-keyed camera plans, branded ASS caption burn-in, clip trim/re-render and authenticated preview endpoints are implemented. When at least two isolated mic tracks and matching speaker-keyed camera videos are uploaded, the worker automatically generates a heuristic camera plan for each suggested clip. Editors can review and override it. This RMS-based method is not robust diarization and requires synchronized tracks. This is still not a fully audited production deployment: malware scanning, HTTPS, SSO/2FA, upload quotas, reverse-proxy body-size configuration, retention policies, off-site backup storage/rotation, provider billing ingestion, provider accuracy comparison, and real-footage QA remain deployment tasks. A manual MongoDB + media backup command is included; schedule backups and test restores before production use. Deepgram word-level timestamps are implemented but need validation on authorized Hindi/Hinglish recordings. Validate synchronized camera source files and caption font rendering (Roman Hinglish and Devanagari) on your own media before production use.

## Local media copies

In desktop Chrome or Edge over HTTPS (or localhost), choosing a destination folder is optional. When selected, uploaded audio/video is copied to that folder on the user's computer and also uploaded to `MEDIA_ROOT` for processing; without a local folder, uploads still go to the workspace for processing. The app remembers the folder handle in that browser; access may need to be granted again after restarting the browser. Additional source tracks can also be uploaded without selecting a folder. Use **Save to local folder** on a rendered clip to save the MP4; for YouTube projects this also copies the source video after it has been downloaded for rendering. The server-side processing copy remains available to the workspace.

After a local upload, transcription is queued automatically when all files finish uploading. Reel suggestions are generated only after selecting **Generate reel suggestions**. The **Add optional camera / audio tracks** section is only for extra camera angles, speaker mic tracks, or a master mix; it is not required to start transcription.

## Requirements

- Node.js 20+
- MongoDB 7+
- FFmpeg + ffprobe installed; `FFMPEG_PATH` can be absolute and `FFPROBE_PATH` can be set separately
- Python 3.10+ for speaker utility; `pip install numpy soundfile`
- Sarvam API key when using the default provider
- Optional Deepgram API key when `STT_PROVIDER=deepgram`
- Optional OpenAI-compatible LLM API key for clip selection

## Quick start

1. Configure `.env` with a unique random `JWT_SECRET` of at least 32 characters and the API key for your selected STT provider (`SARVAM_API_KEY` by default, or `STT_PROVIDER=deepgram` with `DEEPGRAM_API_KEY`). Optionally set `LLM_API_KEY`.
2. Set `MEDIA_ROOT` to a writable local path or mounted NAS directory. Keep source media off cloud storage as specified in the blueprint.
3. Start Redis and MongoDB: `docker compose up -d`. If MongoDB is already installed locally on port 27017, use that service and start only Redis (`docker compose up -d redis`) to avoid a port conflict.
4. Install packages: `npm install`.
5. Confirm the configured `FFMPEG_PATH` points to an installed FFmpeg executable, `ffprobe` is available, and `MEDIA_ROOT` is writable by both API and worker.
6. On a new database only, set `ADMIN_NAME`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` (at least 12 characters) in `.env`, then run `npm --workspace server run admin:bootstrap` once to create the first administrator. Server startup does not create or modify users.
7. Start Docker Desktop, Redis, the API, UI, and media worker together with one command: `npm run dev:stack` (equivalent to `docker desktop start && docker compose up -d redis && npm run dev`). Sign in with the account created during bootstrap or another account provisioned by an administrator. Create a podcast by uploading media or pasting a YouTube video link. YouTube transcription is queued automatically; only import videos you own or have permission to use. For uploaded media, transcription starts automatically after upload; if processing failed or you need to rerun it, select **Start transcription**. When the transcript is ready, select **Generate reel suggestions** if you want AI suggestions. For clip output, adjust In/Out, configure a speaker camera plan, then select **Render 9:16**.
8. Open http://localhost:5173.

Admins can manage team roles from **Team & audit**. Enter actual provider costs and published views/watch time in the podcast/clip review screens; the dashboard does not estimate provider billing or fetch social-media analytics automatically.

API health check: http://localhost:5000/api/health

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection |
| `JWT_SECRET` | JWT signing secret |
| `ADMIN_NAME` | Name used only by the explicit one-time `admin:bootstrap` command |
| `ADMIN_EMAIL` | Login email used only by the explicit one-time `admin:bootstrap` command |
| `ADMIN_PASSWORD` | Login password used only by the explicit one-time `admin:bootstrap` command (at least 12 characters) |
| `SARVAM_API_KEY` | Sarvam subscription key |
| `STT_PROVIDER` | `sarvam` (default) or `deepgram` |
| `DEEPGRAM_API_KEY` | Deepgram API key; required only when `STT_PROVIDER=deepgram` |
| `DEEPGRAM_MODEL` | Deepgram model (defaults to `nova-3`) |
| `PYTHON_PATH` | Python executable used for mic-track speaker analysis (default `python3`) |
| `SARVAM_MODE` | `codemix` default; use `transcribe`, `verbatim`, or `translit` as required |
| `LLM_BASE_URL` | OpenAI-compatible chat completions base URL |
| `LLM_API_KEY` | Clip selection model key |
| `LLM_MODEL` | Defaults to `gpt-4o-mini` |
| `MEDIA_ROOT` | Local/NAS media directory shared by API and worker |
| `MAX_UPLOAD_BYTES` | Maximum size for legacy multipart source uploads (default 5 GiB) |
| `MAX_UPLOAD_FILES` | Maximum number of files per upload request (default 12, maximum 50) |
| `MAX_RESUMABLE_UPLOAD_BYTES` | Maximum size for a resumable source file (default 100 GiB) |
| `UPLOAD_CHUNK_BYTES` | Resumable upload chunk size (default 16 MiB; reverse proxies must allow at least this much request body) |
| `BACKUP_ROOT` | Backup output directory (default `./backups`) |
| `BACKUP_INTERVAL_HOURS` | Scheduled backup interval (default 24 hours; `backup:schedule` only) |
| `REDIS_URL` | BullMQ Redis connection |
| `WORKER_CONCURRENCY` | Number of simultaneous background jobs |
| `FFMPEG_PATH` | FFmpeg executable path |
| `FFPROBE_PATH` | Optional ffprobe executable path; defaults to a sibling of an absolute `FFMPEG_PATH` or `ffprobe` on `PATH` |
| `FFMPEG_VIDEO_ENCODER` | Defaults to `h264_videotoolbox` on macOS and `libx264` elsewhere; both are supported |
| `FFMPEG_VIDEO_BITRATE` | VideoToolbox target bitrate (default `8M`) |
| `FFMPEG_PRESET` | x264 speed/quality preset |

## Upload conventions

For accurate active-speaker switching, record one isolated mic track per speaker plus one wide camera shot. The UI supports assigning each uploaded file a kind and speaker key. The worker automatically estimates active speakers from two or more isolated mic tracks and proposes camera cuts for matching video speaker keys. Use `kind=video` for camera angles, `kind=audio` for isolated mic tracks, and `kind=mix` for a final mixed audio track. Transcription prioritizes a `kind=mix` master track, then extracts audio from the first `kind=video` source, and uses a `kind=audio` mic track only when no mix or video is available. Rendering uses the explicit mixed track if supplied, otherwise the primary video camera's audio; isolated mics are not mixed automatically. Automatically proposed camera cut plans are clip-relative and can be edited by the editor.

YouTube URL import uses `yt-dlp`, installed with the server dependencies, and requires FFmpeg to merge separate video/audio streams. It selects the best available video and audio streams rather than requiring a pre-muxed MP4 format. Only supported public YouTube videos can be imported; playlists and non-YouTube URLs are rejected. The import worker automatically queues transcription after the download completes. Only import videos you own or have permission to use.

## API outline

- `GET /api/podcasts/upload-limits` returns the configured per-request file count and per-file size limits for the upload UI
- `POST /api/podcasts/:id/uploads` and `PATCH /api/podcasts/:id/uploads/:uploadId` create and append authenticated resumable upload chunks; `GET` returns the saved offset and `POST .../:uploadId/complete` attaches the completed file
- `POST /api/auth/login`
- `POST /api/auth/register` (disabled unless `INVITE_CODE` is configured; requires a 12+ character password)
- `GET /api/podcasts`
- `POST /api/podcasts`
- `POST /api/podcasts/:id/files` multipart field `files`
- `POST /api/podcasts/:id/transcribe`
- `POST /api/podcasts/:id/select-clips` (generate suggestions from a saved transcript without re-transcribing)
- `GET /api/podcasts/:id`
- `GET /api/podcasts/:id/transcript`
- `PATCH /api/podcasts/:id/transcript` (save transcript text or timed line edits)
- `GET /api/podcasts/:id/clips`
- `PATCH /api/podcasts/:id` (update folder and tags)
- `PATCH /api/podcasts/clips/:clipId` (trim, captions, assignment, and workflow status)
- `POST /api/podcasts/clips/:clipId/render` (enqueue branded render)
- `GET /api/podcasts/clips/:clipId/render` (authenticated MP4 preview; originals are not exposed as public static files)
- `GET /api/podcasts/:id/youtube-source` (authenticated YouTube source download after the source has been fetched for rendering)
- `POST /api/podcasts/:id/source-preview` (create a short-lived authenticated source-preview link)
- `GET /api/podcasts/analytics/backup-status` (admin-only latest backup and integrity-check status)
- `POST /api/podcasts/analytics/backup-restore-test` (admin-only record after a completed restore drill)
- `POST /api/podcasts/notifications/:activityId/retry` (retry supported failed background jobs)

## Backups

Install MongoDB Database Tools (`mongodump`/`mongorestore`) on the API host, configure `MONGODB_URI`, and run:

```bash
npm --workspace server run backup
```

For recurring backups, run `npm --workspace server run backup:schedule` under a process supervisor. It creates one backup at startup and repeats at `BACKUP_INTERVAL_HOURS` (default 24).

The command writes a compressed database archive and, when `MEDIA_ROOT` exists, a media copy beneath `BACKUP_ROOT`. It records recent scheduled successes and failures in `backup-status.json`; admins see those events in-app and can review backup health on **Team & audit**. Run `npm --workspace server run backup:verify` to check the latest archive's gzip integrity and media-directory presence. This check does not restore MongoDB; perform a restore drill against a separate test database, then record the completed drill on **Team & audit**. Restore the database with `mongorestore --gzip --archive=<backup-folder>/database.archive.gz`; restore the matching `media` folder to `MEDIA_ROOT`. Keep backups outside the repository, restrict access because they contain client media and transcripts, copy them off-host, rotate old backups, and regularly test restoration.

## Speaker detection utility

```bash
pip install numpy soundfile
python worker/speaker_detection.py --tracks host.wav guest.wav --names Host Guest --out speaker_timeline.json
```

This uses mic-track RMS level per second. The background worker invokes it automatically when two or more matching mic/camera speaker keys are present. It is a heuristic: bleed, muted mics, cross-talk and poor gain staging can produce wrong labels. Editors must review camera plans before rendering.

## Rough-cut utility

```bash
worker/render_clip.sh podcast.mp4 125.5 178.0 output.mp4
```

The rough-cut shell utility center-crops to 1080x1920. The main BullMQ renderer supports speaker-keyed camera switching from the worker-generated or editor-adjusted camera plan.

## Recommended delivery phases (matching blueprint)

1. Level 1: reliable upload, configured speech transcription, clip selection, clip list and editor feedback.
2. Level 2: durable queue, speaker timeline, camera switching, 9:16 rendering, MP4 export.
3. Level 3: branded captions, review/trim/re-render workflow, roles and complete audit trail.
4. Learning loop: collect approvals and published reel performance, then refresh prompt examples monthly.

Do not use with real client footage until access controls, NAS permissions, backups and production deployment are reviewed.
#   C l i p F i n d e r - A I  
 #   C l i p F i n d e r - A I  
 #   C l i p F i n d e r - A I  
 