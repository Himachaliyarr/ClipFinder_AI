import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { downloadYouTubeVideo } from './youtube.js';

const run = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${stderr}`)));
});
const videoEncoder = process.env.FFMPEG_VIDEO_ENCODER || (process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264');
if (!['libx264', 'h264_videotoolbox'].includes(videoEncoder)) throw new Error('FFMPEG_VIDEO_ENCODER must be libx264 or h264_videotoolbox');
const videoCodecArgs = videoEncoder === 'libx264'
  ? ['-c:v', videoEncoder, '-preset', process.env.FFMPEG_PRESET || 'veryfast', '-crf', '20']
  : ['-c:v', videoEncoder, '-b:v', process.env.FFMPEG_VIDEO_BITRATE || '8M'];
const youtubeDownloads = new Map();

export async function resolveRenderSources(podcast, mediaRoot, signal, downloadVideo = downloadYouTubeVideo) {
  const sources = [...(podcast.sourceFiles || [])];
  if (sources.some(source => source.kind === 'video') || !podcast.sourceUrl) return sources;

  const sourcePath = path.join(mediaRoot, String(podcast._id), 'youtube-source.mp4');
  let source;
  try {
    source = await fs.stat(sourcePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (source?.isFile() && source.size > 0) {
    sources.push({ kind: 'video', path: sourcePath });
    return sources;
  }

  const pending = youtubeDownloads.get(sourcePath);
  if (pending) {
    const downloadedPath = await pending;
    sources.push({ kind: 'video', path: downloadedPath });
    return sources;
  }

  const download = (async () => {
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    const temporaryPath = `${sourcePath}.${nanoid(8)}.partial.mp4`;
    try {
      await downloadVideo(podcast.sourceUrl, temporaryPath, signal);
      await fs.rename(temporaryPath, sourcePath);
      return sourcePath;
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  })();
  youtubeDownloads.set(sourcePath, download);
  try {
    const downloadedPath = await download;
    sources.push({ kind: 'video', path: downloadedPath });
    return sources;
  } finally {
    if (youtubeDownloads.get(sourcePath) === download) youtubeDownloads.delete(sourcePath);
  }
}

export function getRenderDimensions(aspectRatio = '9:16') {
  if (aspectRatio === '9:16') return { width: 1080, height: 1920 };
  if (aspectRatio === '1:1') return { width: 1080, height: 1080 };
  if (aspectRatio === '16:9') return { width: 1920, height: 1080 };
  throw new Error('Aspect ratio must be 9:16, 1:1, or 16:9');
}

/**
 * Render a vertical short. cameraSegments use clip-relative seconds and a `speaker`
 * value matching sourceFiles[].speaker. The editor may provide a manual camera map;
 * otherwise the primary source is used for the whole clip.
 */
export async function renderClip({ clip, podcast, settings = {}, signal }) {
  const { width, height } = getRenderDimensions(settings.aspectRatio);
  const mediaRoot = path.resolve(process.env.MEDIA_ROOT || './server/storage');
  const outputDir = path.join(mediaRoot, String(podcast._id), 'renders');
  await fs.mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, `${clip._id}-${Date.now()}-${nanoid(5)}.mp4`);
  const start = Math.max(0, Number(clip.start) || 0), end = Number(clip.end);
  if (!Number.isFinite(end) || end <= start) throw new Error('Clip end must be greater than start');
  const sources = await resolveRenderSources(podcast, mediaRoot, signal);
  if (!sources.length) throw new Error('Podcast has no source media');
  const duration = end - start;
  const speakerFiles = new Map(sources.filter(s => s.speaker && s.kind !== 'audio' && s.kind !== 'mix').map(s => [s.speaker, s.path]));
  const primary = sources.find(s => s.kind === 'video');
  if (!primary) throw new Error('Rendering requires at least one uploaded video camera source');
  const requested = (clip.cameraSegments || []).filter(s => s.speaker && speakerFiles.has(s.speaker))
    .map(s => ({ start: Math.max(0, Number(s.start) || 0), end: Math.min(duration, Number(s.end) || duration), file: speakerFiles.get(s.speaker) }))
    .filter(s => s.end > s.start).sort((a,b) => a.start-b.start);
  // Fill uncovered intervals with the primary/wide camera so cuts never shorten the clip.
  const plan = []; let cursor = 0;
  for (const seg of requested) {
    if (seg.start < cursor - 0.02) throw new Error('Camera plan contains overlapping segments');
    if (seg.start > cursor + 0.02) plan.push({ start: cursor, end: seg.start, file: primary.path });
    plan.push({ ...seg, start: Math.max(cursor, seg.start) }); cursor = seg.end;
  }
  if (cursor < duration - 0.02) plan.push({ start: cursor, end: duration, file: primary.path });
  if (!plan.length) plan.push({ start: 0, end: duration, file: primary.path });
  for (const seg of plan) { try { await fs.access(seg.file); } catch { throw new Error(`Media source not found: ${seg.file}`); } }
  // Create synchronized camera segments, normalize them, then concatenate. Each input
  // is independently seeked to the podcast time range so multi-camera files stay aligned.
  const parts = [];
  try {
    for (let i = 0; i < plan.length; i++) {
      const seg = plan[i];
      const part = path.join(outputDir, `${clip._id}-${nanoid(6)}-${i}.mp4`);
      const args = ['-y', '-ss', String(start + seg.start), '-i', seg.file, '-t', String(seg.end-seg.start),
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
        '-an', ...videoCodecArgs, '-pix_fmt', 'yuv420p', part];
      await run(process.env.FFMPEG_PATH || 'ffmpeg', args);
      parts.push(part);
    }
    let videoInput = parts[0];
    if (parts.length > 1) {
      const list = path.join(outputDir, `${clip._id}-${nanoid(5)}.txt`);
      await fs.writeFile(list, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
      const joined = path.join(outputDir, `${clip._id}-${nanoid(5)}-joined.mp4`);
      await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-y','-f','concat','-safe','0','-i',list,'-c','copy',joined]);
      videoInput = joined;
      await fs.unlink(list).catch(()=>{});
    }
    // Prefer an explicitly supplied mixed/master track; isolated speaker mics are not a final mix.
    const audioSource = sources.find(s => s.kind === 'mix') || primary;
    const args = ['-y','-i',videoInput,'-ss',String(start),'-i',audioSource.path,'-t',String(duration),
      '-map','0:v:0','-map','1:a:0?',...videoCodecArgs,
      '-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',output];
    await run(process.env.FFMPEG_PATH || 'ffmpeg', args);
    return { output, duration, cameraSwitches: Math.max(0, plan.length - 1) };
  } finally {
    await Promise.all(parts.map(p => fs.unlink(p).catch(()=>{})));
  }
}
