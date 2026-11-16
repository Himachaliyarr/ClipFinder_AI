# ClipFinder AI — Vande Digital

Internal podcast-to-reels production workspace based on the supplied **ClipFinder AI Project Blueprint (10 Nov 2026)**. This repository is a runnable MVP foundation with a React dashboard, Express API, MongoDB data models, local/NAS media storage, Sarvam/Deepgram transcription integrations, LLM-based clip suggestions, editor approval workflow, and FFmpeg/Python worker utilities.

## Transcription providers and timing

Sarvam Saaras v4 is the default and returns phrase/chunk timestamps. Deepgram Nova-3 is available as an optional provider (`STT_PROVIDER=deepgram`) and returns word timestamps; it uses multilingual mode for Hindi/English code-switching. Provider accuracy, especially Roman-script Hinglish, still needs comparison on the same authorized sample before choosing a production default. Timing metadata identifies the actual granularity and never invents word timestamps.

Official docs:
- https://docs.sarvam.ai/api/api-guides-tutorials/models/saaras
- https://developers.deepgram.com/docs/models-languages-overview
- https://developers.deepgram.com/docs/multilingual-code-switching

## Included today

- Email/password login with rate-limited authentication and roles (`admin`, `editor`, `viewer`) with JWT.
- Podcast records and multi-file upload (5 GiB default per-file cap; configurable with `MAX_UPLOAD_BYTES`) to `MEDIA_ROOT` (point this to your office NAS mount).
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
- Automatic speaker-to-camera cut suggestions from synchronized isolated mic tracks using the included RMS timeline utility; editor review is still required.
- FFmpeg 9:16 rough-cut utility.
- Docker Compose for MongoDB and Redis.

## Production readiness boundary

BullMQ transcription/render jobs, speaker-keyed camera plans, branded ASS caption burn-in, clip trim/re-render and authenticated preview endpoints are implemented. When at least two isolated mic tracks and matching speaker-keyed camera videos are uploaded, the worker automatically generates a heuristic camera plan for each suggested clip. Editors can review and override it. This RMS-based method is not robust diarization and requires synchronized tracks. This is still not a fully audited production deployment: secure resumable NAS uploads, malware scanning, HTTPS, SSO/2FA, retention policies, off-site backup storage/rotation, provider billing ingestion, provider accuracy comparison, and real-footage QA remain deployment tasks. A manual MongoDB + media backup command is included; schedule and test restore drills before production use. Deepgram word-level timestamps are implemented but need validation on authorized Hindi/Hinglish recordings. Validate synchronized camera source files and caption font rendering (Roman Hinglish and Devanagari) on your own media before production use.

## Requirements

- Node.js 20+
- MongoDB 7+
- FFmpeg + ffprobe installed; `FFMPEG_PATH` can be absolute and `FFPROBE_PATH` can be set separately
- Python 3.10+ for speaker utility; `pip install numpy soundfile`
- Sarvam API key when using the default provider
- Optional Deepgram API key when `STT_PROVIDER=deepgram`
- Optional OpenAI-compatible LLM API key for clip selection

## Quick start

1. Configure `.env` with `ADMIN_NAME`, `ADMIN_EMAIL`, and a strong `ADMIN_PASSWORD` (at least 12 characters), a unique random `JWT_SECRET` of at least 32 characters, and the API key for your selected STT provider (`SARVAM_API_KEY` by default, or `STT_PROVIDER=deepgram` with `DEEPGRAM_API_KEY`). Optionally set `LLM_API_KEY`.
2. Set `MEDIA_ROOT` to a writable local path or mounted NAS directory. Keep source media off cloud storage as specified in the blueprint.
3. Start Redis and MongoDB: `docker compose up -d`. If MongoDB is already installed locally on port 27017, use that service and start only Redis (`docker compose up -d redis`) to avoid a port conflict.
4. Install packages: `npm install`.
5. Confirm the configured `FFMPEG_PATH` points to an installed FFmpeg executable, `ffprobe` is available, and `MEDIA_ROOT` is writable by both API and worker.
6. Start API and UI: `npm run dev`. The server creates or synchronizes the admin account from the three `ADMIN_*` values on startup; these are the admin's login credentials.
7. Start the durable media worker in a second terminal: `npm run worker`.
8. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Create a podcast by uploading media or pasting a YouTube video link. YouTube downloads, transcription, and AI clip selection are queued automatically; only import videos you own or have permission to use. For uploaded media, select **Start transcription** to run transcription and clip selection. If a transcript already exists without suggestions, choose **Generate AI reel suggestions** to reuse it without repeating transcription. For clip output, adjust In/Out, configure a speaker camera plan, then select **Render 9:16**.
9. Open http://localhost:5173.

Admins can manage team roles from **Team & audit**. Enter actual provider costs and published views/watch time in the podcast/clip review screens; the dashboard does not estimate provider billing or fetch social-media analytics automatically.

API health check: http://localhost:5000/api/health

## Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection |
| `JWT_SECRET` | JWT signing secret |
| `ADMIN_NAME` | Name for the initial admin created when the database has no users |
| `ADMIN_EMAIL` | Login email for the initial admin |
| `ADMIN_PASSWORD` | Login password for the initial admin (at least 12 characters) |
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
| `MAX_UPLOAD_BYTES` | Maximum size for uploaded and imported media (default 5 GiB) |
| `MAX_UPLOAD_FILES` | Maximum number of files per upload request (default 12, maximum 50) |
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
- `POST /api/podcasts/:id/source-preview` (create a short-lived authenticated source-preview link)

## Backups

Install MongoDB Database Tools (`mongodump`/`mongorestore`) on the API host, configure `MONGODB_URI`, and run:

```bash
npm --workspace server run backup
```

For recurring backups, run `npm --workspace server run backup:schedule` under a process supervisor. It creates one backup at startup and repeats at `BACKUP_INTERVAL_HOURS` (default 24).

The command writes a compressed database archive and, when `MEDIA_ROOT` exists, a media copy beneath `BACKUP_ROOT`. Restore the database with `mongorestore --gzip --archive=<backup-folder>/database.archive.gz`; restore the matching `media` folder to `MEDIA_ROOT`. Keep backups outside the repository, restrict access because they contain client media and transcripts, copy them off-host, rotate old backups, and regularly test restoration.

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