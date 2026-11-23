import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';
import { downloadYouTubeVideo } from './youtube.js';
import { normalizeSentenceEdits } from './clipSentenceEdits.js';

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
const SPLICE_TRANSITION_SECONDS = 0.1;
const youtubeDownloads = new Map();
const ffmpeg = () => process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = () => {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const configuredFfmpeg = process.env.FFMPEG_PATH;
  if (configuredFfmpeg && /[\\/]/.test(configuredFfmpeg)) {
    return path.join(path.dirname(configuredFfmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  }
  return process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
};

function getCameraPlan(clip, start, end, primaryPath, speakerFiles) {
  const duration = end - start;
  const requested = (clip.cameraSegments || []).filter(segment => segment.speaker && speakerFiles.has(segment.speaker))
    .map(segment => ({
      start: Math.max(0, Number(segment.start) || 0),
      end: Math.min(duration, Number(segment.end) || duration),
      file: speakerFiles.get(segment.speaker),
    }))
    .filter(segment => segment.end > segment.start)
    .sort((a, b) => a.start - b.start);
  const plan = [];
  let cursor = 0;
  for (const segment of requested) {
    if (segment.start < cursor - 0.02) throw new Error('Camera plan contains overlapping segments');
    if (segment.start > cursor + 0.02) plan.push({ start: cursor, end: segment.start, file: primaryPath });
    plan.push({ ...segment, start: Math.max(cursor, segment.start) });
    cursor = segment.end;
  }
  if (cursor < duration - 0.02) plan.push({ start: cursor, end: duration, file: primaryPath });
  if (!plan.length) plan.push({ start: 0, end: duration, file: primaryPath });
  return plan;
}

export function buildSentenceCameraPlan(clip, primaryPath, speakerFiles = new Map()) {
  const start = Math.max(0, Number(clip.start) || 0);
  const end = Number(clip.end);
  if (!Number.isFinite(end) || end <= start) throw new Error('Clip end must be greater than start');
  const cameraPlan = getCameraPlan(clip, start, end, primaryPath, speakerFiles);
  const edits = normalizeSentenceEdits(clip.sentenceEdits || [], start, end);
  if (!edits.length) return cameraPlan;

  const plan = [];
  for (const edit of edits) {
    const rangeStart = edit.start - start;
    const rangeEnd = edit.end - start;
    for (const camera of cameraPlan) {
      const segmentStart = Math.max(rangeStart, camera.start);
      const segmentEnd = Math.min(rangeEnd, camera.end);
      if (segmentEnd > segmentStart) {
        plan.push({ start: segmentStart, end: segmentEnd, file: camera.file });
      }
    }
  }
  return plan;
}

async function probeAudioSource(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe(), [
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      file,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve(Boolean(stdout.trim()));
      else reject(new Error(`ffprobe exited ${code}: ${stderr}`));
    });
  });
}

async function concatenateWithFilter(parts, outputDir, clipId, suffix, temporaryFiles, track) {
  let current = parts;
  let level = 0;
  const groupSize = 8;
  const isAudio = track === 'audio';
  const extension = isAudio ? 'm4a' : 'mp4';

  while (current.length > 1) {
    const next = [];
    for (let offset = 0; offset < current.length; offset += groupSize) {
      const group = current.slice(offset, offset + groupSize);
      if (group.length === 1) {
        next.push(group[0]);
        continue;
      }

      const outputPath = path.join(outputDir, `${clipId}-${nanoid(5)}-${suffix}-${level}-${offset}.${extension}`);
      temporaryFiles.push(outputPath);
      const filterGraph = group.map((_, index) => (
        isAudio
          ? `[${index}:a:0]asetpts=PTS-STARTPTS,aresample=48000[a${index}]`
          : `[${index}:v:0]setpts=PTS-STARTPTS[v${index}]`
      ));
      const concatInputs = group.map((_, index) => `[${isAudio ? 'a' : 'v'}${index}]`).join('');
      filterGraph.push(isAudio
        ? `${concatInputs}concat=n=${group.length}:v=0:a=1[outa]`
        : `${concatInputs}concat=n=${group.length}:v=1:a=0[outv]`);

      const args = ['-y'];
      for (const file of group) args.push('-i', file);
      args.push('-filter_complex', filterGraph.join(';'), '-map', isAudio ? '[outa]' : '[outv]');
      if (isAudio) {
        args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
      } else {
        args.push(...videoCodecArgs, '-pix_fmt', 'yuv420p', '-an');
      }
      args.push(outputPath);
      await run(ffmpeg(), args);
      next.push(outputPath);
    }
    current = next;
    level += 1;
  }
  return current[0];
}

export function getSpliceTransitions(durations, transitionSeconds = SPLICE_TRANSITION_SECONDS) {
  let composedDuration = Number(durations[0]) || 0;
  const transitions = [];
  for (let index = 1; index < durations.length; index += 1) {
    const nextDuration = Number(durations[index]) || 0;
    const duration = Math.min(transitionSeconds, composedDuration / 2, nextDuration / 2);
    transitions.push({ duration, offset: composedDuration - duration });
    composedDuration += nextDuration - duration;
  }
  return { transitions, duration: composedDuration };
}

async function crossfadeWithFilter(parts, outputDir, clipId, suffix, temporaryFiles, track) {
  let current = parts;
  let durations = parts.map(part => part.duration);
  let level = 0;
  const isAudio = track === 'audio';
  const extension = isAudio ? 'm4a' : 'mp4';

  while (current.length > 1) {
    const next = [];
    const nextDurations = [];
    for (let offset = 0; offset < current.length; offset += 8) {
      const group = current.slice(offset, offset + 8);
      const groupDurations = durations.slice(offset, offset + 8);
      if (group.length === 1) {
        next.push(group[0]);
        nextDurations.push(groupDurations[0]);
        continue;
      }

      const { transitions, duration } = getSpliceTransitions(groupDurations);
      const outputPath = path.join(outputDir, `${clipId}-${nanoid(5)}-${suffix}-${level}-${offset}.${extension}`);
      temporaryFiles.push(outputPath);
      const filterGraph = group.map((_, index) => (
        isAudio
          ? `[${index}:a:0]asetpts=PTS-STARTPTS,aresample=48000[a${index}]`
          : `[${index}:v:0]settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[v${index}]`
      ));
      let previousLabel = isAudio ? 'a0' : 'v0';
      for (let index = 1; index < group.length; index += 1) {
        const transition = transitions[index - 1];
        const outputLabel = `${isAudio ? 'aout' : 'vout'}${index}`;
        filterGraph.push(isAudio
          ? `[${previousLabel}][a${index}]acrossfade=d=${transition.duration}:c1=tri:c2=tri[${outputLabel}]`
          : `[${previousLabel}][v${index}]xfade=transition=fade:duration=${transition.duration}:offset=${transition.offset}[${outputLabel}]`);
        previousLabel = outputLabel;
      }

      const args = ['-y'];
      for (const part of group) args.push('-i', part.path);
      args.push(
        '-filter_complex', filterGraph.join(';'),
        '-map', `[${previousLabel}]`,
      );
      if (isAudio) {
        args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2');
      } else {
        args.push(...videoCodecArgs, '-pix_fmt', 'yuv420p', '-an');
      }
      args.push(outputPath);
      await run(ffmpeg(), args);
      next.push({ path: outputPath, duration });
      nextDurations.push(duration);
    }
    current = next;
    durations = nextDurations;
    level += 1;
  }
  return current[0];
}

async function renderEditedClip({ clip, sources, primary, speakerFiles, outputDir, output, width, height }) {
  const start = Math.max(0, Number(clip.start) || 0);
  const end = Number(clip.end);
  const edits = normalizeSentenceEdits(clip.sentenceEdits, start, end);
  if (!edits.length) throw new Error('At least one sentence is required for an edited clip');
  const plan = buildSentenceCameraPlan(clip, primary.path, speakerFiles);
  if (!plan.length) throw new Error('Sentence edits contain no renderable source ranges');
  for (const segment of plan) {
    try {
      await fs.access(segment.file);
    } catch {
      throw new Error(`Media source not found: ${segment.file}`);
    }
  }

  const temporaryFiles = [];
  try {
    const videoParts = [];
    for (let editIndex = 0; editIndex < edits.length; editIndex += 1) {
      const edit = edits[editIndex];
      const editPlan = buildSentenceCameraPlan({ ...clip, sentenceEdits: [edit] }, primary.path, speakerFiles);
      if (!editPlan.length) throw new Error('Sentence edit contains no renderable source ranges');
      const cameraParts = [];
      for (let segmentIndex = 0; segmentIndex < editPlan.length; segmentIndex += 1) {
        const segment = editPlan[segmentIndex];
        const part = path.join(outputDir, `${clip._id}-${nanoid(6)}-sentence-video-${editIndex}-${segmentIndex}.mp4`);
        temporaryFiles.push(part);
        await run(ffmpeg(), [
          '-y', '-ss', String(start + segment.start), '-i', segment.file, '-t', String(segment.end - segment.start),
          '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`,
          '-an', ...videoCodecArgs, '-pix_fmt', 'yuv420p', part,
        ]);
        cameraParts.push(part);
      }
      const editVideo = await concatenateWithFilter(cameraParts, outputDir, clip._id, `edit-video-${editIndex}`, temporaryFiles, 'video');
      videoParts.push({ path: editVideo, duration: edit.end - edit.start });
    }
    const videoInput = await crossfadeWithFilter(videoParts, outputDir, clip._id, 'sentence-video', temporaryFiles, 'video');

    const audioSource = sources.find(source => source.kind === 'mix') || primary;
    const hasAudio = await probeAudioSource(audioSource.path);
    const args = ['-y', '-i', videoInput.path];
    if (hasAudio) {
      const audioParts = [];
      for (let index = 0; index < edits.length; index += 1) {
        const edit = edits[index];
        const part = path.join(outputDir, `${clip._id}-${nanoid(6)}-sentence-audio-${index}.m4a`);
        temporaryFiles.push(part);
        await run(ffmpeg(), [
          '-y', '-ss', String(edit.start), '-i', audioSource.path, '-t', String(edit.end - edit.start),
          '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', part,
        ]);
        audioParts.push({ path: part, duration: edit.end - edit.start });
      }
      const audioInput = await crossfadeWithFilter(audioParts, outputDir, clip._id, 'sentence-audio', temporaryFiles, 'audio');
      args.push('-i', audioInput.path, '-map', '0:v:0', '-map', '1:a:0');
    } else {
      args.push('-map', '0:v:0', '-an');
    }
    args.push(...videoCodecArgs);
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '160k');
    args.push('-shortest', '-movflags', '+faststart', output);
    await run(ffmpeg(), args);
    const cameraSwitches = plan.reduce((count, segment, index) => (
      index > 0 && plan[index - 1].file !== segment.file ? count + 1 : count
    ), 0);
    return {
      output,
      duration: videoInput.duration,
      cameraSwitches,
    };
  } catch (error) {
    await fs.rm(output, { force: true });
    throw error;
  } finally {
    await Promise.all(temporaryFiles.map(file => fs.rm(file, { force: true })));
  }
}

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
  if (clip.sentenceEdits?.length) {
    return renderEditedClip({ clip, sources, primary, speakerFiles, outputDir, output, width, height });
  }
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
