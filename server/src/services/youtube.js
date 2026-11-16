import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const youtubeDl = require('youtube-dl-exec');
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be']);

export function normalizeYouTubeUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;

  let url;
  // Accept known video URL forms only, then pass a canonical URL into the worker queue.
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  let id;
  if (url.hostname.toLowerCase().endsWith('youtu.be')) {
    id = url.pathname.split('/').filter(Boolean)[0];
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const match = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)\/?$/);
    id = match?.[1];
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeAudioUrlOptions() {
  return {
    format: 'bestaudio/best',
    getUrl: true,
    noPlaylist: true,
    noWarnings: true,
    quiet: true,
    jsRuntimes: 'node',
  };
}

export async function getYouTubeAudioUrl(url, signal) {
  if (signal?.aborted) throw signal.reason || new Error('YouTube audio lookup cancelled');
  const subprocess = youtubeDl.exec(url, youtubeAudioUrlOptions(), { windowsHide: true });
  const stopLookup = () => subprocess.kill();
  signal?.addEventListener('abort', stopLookup, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    stopLookup();
  }, 30000);
  try {
    const { stdout } = await subprocess;
    const audioUrl = stdout.trim().split(/\r?\n/)[0];
    let parsed;
    try { parsed = new URL(audioUrl); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== 'https:' || !parsed.hostname.toLowerCase().endsWith('.googlevideo.com')) {
      throw new Error('YouTube did not return a supported audio stream URL');
    }
    return audioUrl;
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (timedOut) throw new Error('YouTube audio URL lookup timed out after 30 seconds', { cause: error });
    if (error.message === 'YouTube did not return a supported audio stream URL') throw error;
    throw new Error('Could not resolve the YouTube audio stream', { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stopLookup);
  }
}
