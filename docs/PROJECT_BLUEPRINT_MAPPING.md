# Blueprint mapping

| Blueprint requirement | Current implementation/status |
|---|---|
| MERN stack | React, Express, MongoDB and Mongoose are implemented. |
| Office NAS/local storage | `MEDIA_ROOT` is configurable; the API and worker must share the same writable directory. NAS operation still needs deployment-host validation. |
| Audio extraction | FFmpeg extraction runs in the background worker. FFmpeg and ffprobe must be installed and configured on the worker host. |
| Hindi/Hinglish transcription | Deepgram Nova-3 multilingual mode is the sole configured transcription provider. Validate Hindi/Hinglish quality on representative real audio. |
| True word timestamps | Deepgram response words are stored with word-level timestamps when available; chunks without word data retain chunk-level timing. Roman Hinglish timing and accuracy need real-sample validation. |
| Speaker detection | Python RMS mic-track analysis is wired into the worker when at least two isolated, speaker-keyed mic tracks match camera keys. It remains a heuristic and needs real-recording QA. |
| AI clip selection | OpenAI-compatible structured output is integrated. Editor-approved clips are used as examples on later selection runs; LLM credentials and editorial quality evaluation are still required. |
| Transcript story moments | ChatGPT selects 25–30 timestamped story moments after transcription using the shared `LLM_API_KEY`; the detail page displays them as review cards. |
| Background jobs | BullMQ/Redis import, transcription and render jobs are implemented. Podcast/render progress and failures are surfaced in the dashboard. |
| Auto-cut 9:16 | FFmpeg vertical rendering and camera switching are implemented. The Mac default uses VideoToolbox hardware encoding; target-host validation is still required. |
| Captions | Branded ASS captions, editing and re-render are implemented. Current timing is phrase/chunk level; word-by-word highlighting is pending alignment. |
| Review dashboard | Podcast status, clip suggestions, trim fields, caption edits, approve/reject, render, preview and MP4 download are implemented. |
| Login and roles | JWT roles and admin user/role management are implemented. Upload, review, render access and admin actions are logged. |
| Learning loop and reporting | Editors can enter published views/watch time; the dashboard reports approval, views and watch time. Approved/rendered examples inform future clip-selection prompts. External performance ingestion is not integrated. |
| Production readiness | Real NAS/Mac Mini setup, provider comparison, representative podcast testing, timing/quality targets, backups, monitoring and security operations remain deployment/acceptance work. |
