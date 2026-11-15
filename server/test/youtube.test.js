import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeYouTubeUrl, youtubeAudioUrlOptions } from '../src/services/youtube.js';

test('accepts supported YouTube video URLs and rejects other hosts', () => {
  assert.equal(
    normalizeYouTubeUrl('https://youtu.be/abcdefghijk?t=30'),
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  assert.equal(normalizeYouTubeUrl('https://example.com/watch?v=abcdefghijk'), null);
});

test('resolves an audio stream URL without requesting a media download', () => {
  const options = youtubeAudioUrlOptions();

  assert.equal(options.format, 'bestaudio/best');
  assert.equal(options.getUrl, true);
  assert.equal(options.noPlaylist, true);
  assert.equal(options.jsRuntimes, 'node');
  assert.equal('output' in options, false);
});
