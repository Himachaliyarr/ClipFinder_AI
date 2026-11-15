# OpenAI + OpusClip reel generation

The podcast detail page provides one **Generate reels with OpenAI + OpusClip** action. OpenAI selects compelling moments from the saved timestamped transcript, then the app sends their time ranges and editorial hooks to OpusClip as ClipAnything guidance. OpusClip generates the portrait reels from the original video.

## Setup

1. Enable OpusClip API access and create an API key in the [OpusClip dashboard](https://clip.opus.pro/dashboard). API access requires an eligible plan and enough processing credits.
2. Add the key to the root `.env` file:

   ```dotenv
   OPUSCLIP_API_BASE_URL=https://api.opus.pro/api
   OPUSCLIP_API_KEY=your_opusclip_api_key
   ```

3. If the API key can access multiple organizations, also set the organization ID:

   ```dotenv
   OPUSCLIP_ORG_ID=your_opusclip_org_id
   ```

4. Restart the server and media worker so they load the new environment variable.

Do not commit or share the API key. See the [OpusClip API overview](https://help.opus.pro/api-reference/overview) and [API limitations and credits](https://help.opus.pro/api-reference/limitation).

## Workflow

- Transcribe the source first. The combined action requires both a saved transcript and video source.
- The worker reuses saved OpenAI clip suggestions when available; otherwise it asks OpenAI to select timed moments from the transcript.
- OpenAI's selected ranges and hooks are included in OpusClip's ClipAnything custom prompt. The selected guidance is visible in the podcast detail page.
- Public YouTube sources are submitted to OpusClip by URL.
- Uploaded video files use OpusClip's resumable upload API. Audio-only sources are not supported for OpusClip generation.
- The app requests ClipAnything portrait reels, then polls the OpusClip project for exportable clips.
- Ready preview and export links appear in the **OpusClip reels** section. OpenAI API credits and OpusClip API access/credits are both required when no saved OpenAI suggestions are available.

OpusClip API projects have a 10-credit minimum, and generation consumes OpusClip account credits.
