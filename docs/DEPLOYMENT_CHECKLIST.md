# Deployment checklist

- [ ] Mac Mini/server has Node 20+, Python 3.10+, FFmpeg and ffprobe.
- [ ] NAS mounted with least-privilege read/write account; `MEDIA_ROOT` points to it.
- [ ] MongoDB and Redis have persistent volumes and restricted network access.
- [ ] `.env` secrets generated and stored outside Git.
- [ ] `DEEPGRAM_API_KEY` configured and tested on a representative Hindi/Hinglish sample.
- [ ] Shared `LLM_API_KEY` and OpenAI-compatible endpoint tested for clip selection and story finding.
- [ ] Upload size, concurrent jobs and Deepgram spend limits set.
- [ ] Redis persistence and supervised BullMQ worker verified; retries/backoff and dashboard progress are implemented.
- [ ] HTTPS reverse proxy, firewall, backups, restore drill and monitoring enabled.
- [ ] Editors test on real podcast; record approval rate, editor time, cost and real processing duration against blueprint targets.
- [ ] Validate Deepgram on an authorized Hindi/Hinglish sample, including Roman-script Hinglish.
- [ ] Validate phrase/word timing, speaker switching, camera synchronization and output playback on representative recordings.
- [ ] Verify captions, fonts, speaker switching and exported MP4 on target devices.
