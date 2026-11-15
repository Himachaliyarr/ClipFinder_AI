# ClipFinder AI V3 — audit and verification report

## Fixes applied

- Removed unauthenticated public static serving of the media directory. Original media and rendered previews are now available only through authenticated API routes.
- Removed filesystem paths from podcast and clip API responses and from render job results.
- Disabled public registration unless `INVITE_CODE` is explicitly configured; enforced 12+ character registration passwords and added authentication rate limiting.
- Added a startup guard requiring a unique `JWT_SECRET` with at least 32 characters.
- Restricted MongoDB and Redis host port bindings to loopback in Docker Compose.
- Added Express 4 async route error forwarding, consistent API error handling, upload MIME/size/count checks, MongoDB ID checks, trim-duration validation and camera-plan validation.
- Persisted failed transcription job state after BullMQ exhausts retries; added worker error logging and graceful shutdown.
- Locked transcription requests to Sarvam `saaras:v4`; hardened malformed timestamp handling.
- Corrected render audio selection: use `kind=mix` master audio when supplied, otherwise primary camera audio; isolated mic tracks are not mistakenly used as the finished mix.
- Added automatic active-speaker camera-cut suggestions when two or more isolated mic tracks and matching speaker-keyed camera videos are present. This is an RMS-energy heuristic, not neural diarization; editor review is required.
- Filled gaps in camera plans with the primary camera, rejected overlapping ranges, verified media files exist, and retained the full requested clip duration.
- Hardened ASS subtitle text and colour handling and escaped subtitle filter paths.
- Updated Multer to the 2.x line and removed unused `fluent-ffmpeg` dependency.

## Checks completed in this environment

- `node --check` passed for all server and JavaScript source files.
- Python bytecode compilation passed for `worker/speaker_detection.py`.
- `bash -n` passed for `worker/render_clip.sh`.
- Python speaker timeline smoke test passed on two synthetic alternating microphone tracks.
- FFmpeg render smoke test passed for a synthetic 9:16 clip with burned-in ASS captions, audio, and a multi-camera cut plan with fallback coverage. Output probed as H.264 1080x1920 plus AAC, 6 seconds.
- ZIP archive integrity check passed after packaging.

## Checks not completed

- `npm install` could not complete because this environment could not resolve `registry.npmjs.org` (`EAI_AGAIN`). Consequently Vite production build, dependency audit, live API/MongoDB/Redis integration, and Sarvam live API calls could not be run here.
- No real podcast or synchronized production camera/microphone recordings were available. Validate speaker thresholds, track offsets, Devanagari font availability, NAS permissions, and long-running worker stability on the deployment host.

## Production caveat

This is a corrected and smoke-tested project foundation, not a certification of production readiness. Configure secrets, persistent Redis/MongoDB, HTTPS, backups, monitoring, retention, malware scanning, and process supervision before handling client footage.
