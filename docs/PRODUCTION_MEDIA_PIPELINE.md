# Production media pipeline

## Background jobs (BullMQ)

The API only enqueues work. Run Redis and MongoDB, then start the API and one or more worker processes:

```bash
docker compose up -d
npm install
npm run dev:server
# In another terminal:
npm run worker
```

For production, run `npm run start` and `npm run worker` as separate supervised processes (systemd, PM2, Kubernetes, etc.). Redis must be persistent and reachable by both API and workers. BullMQ retries transcription jobs up to three times with exponential backoff and render jobs twice. Worker concurrency is controlled by `WORKER_CONCURRENCY`.
Podcast records persist job ID, percentage and stage text so the dashboard can refresh progress after navigation or reload. Render status/progress/errors are stored on each clip.

## Transcription jobs

`POST /api/podcasts/:id/transcribe` creates a `transcribe-podcast` job. The worker prioritizes an explicit master mix, otherwise extracts mono 16 kHz audio from the first video source, falling back to a mic track only when no video/mix is available. By default, 25-second audio chunks are transcribed with Deepgram Nova-3; word timings are grouped into sentence-level transcript segments and split at speaker changes. Set `DEEPGRAM_API_KEY` in the server's root `.env` file. Sarvam is optional: set `STT_PROVIDER=both`, `SARVAM_API_KEY`, and optionally `SARVAM_MODE` (defaults to `codemix`) to run it alongside Deepgram.

YouTube links use the `transcribe-youtube` job. The worker resolves the audio stream URL and pipes decoded audio through FFmpeg directly into in-memory chunks for both providers; it does not save YouTube video or audio files locally. The saved source URL remains available, but local clip rendering needs an uploaded media file. YouTube-link transcription stores the transcript and timing data without automatically creating video-dependent clips.

Timestamped transcript segments from uploaded media are then sent to the LLM for clip suggestions. A separate ChatGPT job selects 25–30 distinct story moments with source timestamps; the detail page displays these as cards. Story selection reuses `LLM_API_KEY`, `LLM_BASE_URL` (defaults to `https://api.openai.com/v1`), and `LLM_MODEL` (defaults to `gpt-6-astra`) from clip selection. GPT-6 Astra uses low reasoning effort by default; set `LLM_REASONING_EFFORT` to tune it. If story generation fails, use **Find story moments** to retry after fixing the configuration.

If a transcript already exists but suggestions are missing, `POST /api/podcasts/:id/select-clips` queues AI selection from the saved transcript without repeating transcription. The dashboard exposes this as **Generate AI reel suggestions**.
Story moments can similarly be regenerated from a saved transcript with `POST /api/podcasts/:id/select-stories`.

## Camera switching

Upload each camera feed as a separate source file and set its `speaker` metadata to a stable speaker key (for example `host_a`, `guest_b`). The upload endpoint accepts one `speaker` value per upload request. If at least two isolated mic tracks (`kind=audio`) and matching speaker-keyed camera videos (`kind=video`) are present, the worker runs the RMS speaker timeline utility and proposes clip-relative camera cuts automatically. Editors can review/override with **Camera plan**. Manual ranges use this shape:

```json
[
  { "start": 0, "end": 4.2, "speaker": "host_a" },
  { "start": 4.2, "end": 9.5, "speaker": "guest_b" },
  { "start": 9.5, "end": 15, "speaker": "host_a" }
]
```

The renderer maps each speaker key to the matching uploaded source, seeks each camera to the corresponding podcast timeline, crops to 1080x1920, and concatenates the selected shots. When no camera plan is provided, the primary video source is used for the full clip. Camera source files must share a synchronized timeline. Uncovered ranges now fall back to the primary video camera, so a partial camera plan does not shorten the final render. The RMS timeline is only an active-mic heuristic, not neural speaker diarization. Assign matching speaker keys to mic and camera uploads and review every generated camera plan before publishing.

## Trim and re-render workflow

The clip editor exposes In/Out values in seconds on the original podcast timeline. Saving a trim updates `start` and `end`; the API rejects an end that is not greater than the start. Caption text and camera plans are editable before render. Press **Render 9:16** to enqueue a render job. Each successful render increments `renderVersion` and updates `renderPath`; prior render files are retained for rollback/audit. Authenticated preview is available through `GET /api/podcasts/clips/:clipId/render`.

Project exports identify source media by filename and do not include the server's absolute storage path. Relink the source file to its local or mounted copy when opening the exported XML project in an editor.

## Branded captions

The worker creates an ASS subtitle file and burns it into the 1080x1920 output. The default brand is `VANDE DIGITAL`; font and colour settings can be passed to the render endpoint (`brandText`, `fontName`, `primaryColour`, `accentColour`, `outlineColour`). Colours use ASS colour notation, e.g. `&H00FFFFFF`. The hook is displayed briefly at the top and caption text near the lower safe area. Caption timing can be stored as clip-relative `captionSegments` (`[{"start":0,"end":2.4,"text":"..."}]`). If no timed segments exist, the full caption is shown as one subtitle event.

## Production requirements and caveats

- Install FFmpeg with libx264 and AAC support on every worker host; the default encoder is VideoToolbox on macOS and libx264 elsewhere. `FFMPEG_PATH` may point to a custom binary. When it is absolute, `ffprobe` defaults to the same directory; set `FFPROBE_PATH` to override it. Confirm the selected encoder is available on the target host.
- The API and media worker must use the same `MEDIA_QUEUE_NAME`; by default it is platform-specific (`clipfinder-media-win32`, `clipfinder-media-darwin`, or `clipfinder-media-linux`) so workers on another OS cannot consume jobs with incompatible file paths. Set it explicitly only when all participating workers share compatible media storage.
- Mount the same durable `MEDIA_ROOT` on API and worker processes. Store media on durable NAS/object storage in production; local ephemeral disks are not sufficient.
- Camera cuts assume synchronized camera files and the same timeline origin. Audio is taken from an explicitly uploaded `kind=mix` master track when present, otherwise from the primary video. Isolated `kind=audio` mic tracks are used for transcription but are not automatically mixed into the final render.
- Deepgram Nova-3 supplies word-level timing when available; Sarvam supplies a separate Hindi/multilingual transcript with phrase/chunk timing. Validate Hindi/Hinglish timing and transcription quality on authorized sample media before production use.
- Configure worker process supervision, Redis persistence, disk cleanup/retention, backup, monitoring, and an HTTPS reverse proxy before public production use.

## Job status

Use `GET /api/podcasts/jobs/:jobId` with the normal bearer token to inspect BullMQ state (`waiting`, `active`, `completed`, `failed`, etc.), progress, failure reason, and result. The transcription and render enqueue responses include the job ID.

## Editor feedback and reporting

Editors can record published views and average watch time on each clip. The dashboard aggregates clip approval, views and watch time. Approved/rendered clips with performance data are sent as style examples to the next clip-selection request (up to 20); they are examples, not copied content.

Admin users can manage roles and review the recent activity log. Uploads, clip edits, renders, render access and user/role changes are recorded.
