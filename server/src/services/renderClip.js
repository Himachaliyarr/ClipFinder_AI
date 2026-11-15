import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nanoid } from 'nanoid';

const run = (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); if (stderr.length > 12000) stderr = stderr.slice(-12000); });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${stderr}`)));
});
const esc = s => String(s ?? '').slice(0, 4000).replace(/[{}]/g, '').replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/\r?\n/g, '\\N');
const assColour = (value, fallback) => /^&H[0-9A-Fa-f]{8}$/.test(String(value || '')) ? value : fallback;
const videoEncoder = process.env.FFMPEG_VIDEO_ENCODER || (process.platform === 'darwin' ? 'h264_videotoolbox' : 'libx264');
if (!['libx264', 'h264_videotoolbox'].includes(videoEncoder)) throw new Error('FFMPEG_VIDEO_ENCODER must be libx264 or h264_videotoolbox');
const videoCodecArgs = videoEncoder === 'libx264'
  ? ['-c:v', videoEncoder, '-preset', process.env.FFMPEG_PRESET || 'veryfast', '-crf', '20']
  : ['-c:v', videoEncoder, '-b:v', process.env.FFMPEG_VIDEO_BITRATE || '8M'];
const assFilterPath = value => String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
const assTime = seconds => {
  const cs = Math.max(0, Math.round(seconds * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2,'0')}:${String(Math.floor(cs / 100) % 60).padStart(2,'0')}.${String(cs % 100).padStart(2,'0')}`;
};

function buildAss(clip, settings, outPath) {
  const width = 1080, height = 1920;
  const font = String(settings.fontName || 'Arial').replace(/[{},]/g, '');
  const primary = assColour(settings.primaryColour, '&H00FFFFFF');
  const outline = assColour(settings.outlineColour, '&H00000000');
  const accent = assColour(settings.accentColour, '&H00419BC7');
  const lines = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 2',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Brand,${font},58,${primary},${accent},${outline},&H80000000,-1,0,1,4,2,2,70,70,230,1`,
    `Style: Hook,${font},48,${accent},${primary},${outline},&H80000000,-1,0,1,3,1,8,70,70,120,1`,
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  const segments = Array.isArray(clip.captionSegments) && clip.captionSegments.length
    ? clip.captionSegments
    : [{ start: 0, end: Math.max(0.5, clip.end - clip.start), text: clip.caption || clip.hook || clip.title }];
  if (clip.hook) lines.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(3, clip.end-clip.start))},Hook,,0,0,0,,${esc(clip.hook)}`);
  for (const seg of segments) {
    const start = Math.max(0, Number(seg.start) || 0), end = Math.max(start + 0.2, Number(seg.end) || start + 2);
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Brand,,0,0,0,,${esc(seg.text)}`);
  }
  if (settings.brandText) lines.push(`Dialogue: 2,${assTime(0)},${assTime(Math.max(1, clip.end-clip.start))},Hook,,0,0,45,,${esc(settings.brandText)}`);
  return fs.writeFile(outPath, lines.join('\n'), 'utf8');
}

/**
 * Render a vertical short. cameraSegments use clip-relative seconds and a `speaker`
 * value matching sourceFiles[].speaker. The editor may provide a manual camera map;
 * otherwise the primary source is used for the whole clip.
 */
export async function renderClip({ clip, podcast, settings = {} }) {
  const mediaRoot = path.resolve(process.env.MEDIA_ROOT || './server/storage');
  const outputDir = path.join(mediaRoot, String(podcast._id), 'renders');
  await fs.mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, `${clip._id}-${Date.now()}-${nanoid(5)}.mp4`);
  const ass = path.join(outputDir, `${clip._id}-${nanoid(5)}.ass`);
  const sources = podcast.sourceFiles || [];
  if (!sources.length) throw new Error('Podcast has no source media');
  const start = Math.max(0, Number(clip.start) || 0), end = Number(clip.end);
  if (!Number.isFinite(end) || end <= start) throw new Error('Clip end must be greater than start');
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
  await buildAss(clip, settings, ass);

  // Create synchronized camera segments, normalize them, then concatenate. Each input
  // is independently seeked to the podcast time range so multi-camera files stay aligned.
  const parts = [];
  try {
    for (let i = 0; i < plan.length; i++) {
      const seg = plan[i];
      const part = path.join(outputDir, `${clip._id}-${nanoid(6)}-${i}.mp4`);
      const args = ['-y', '-ss', String(start + seg.start), '-i', seg.file, '-t', String(seg.end-seg.start),
        '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30',
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
      '-vf', `ass='${assFilterPath(ass)}'`,
      '-map','0:v:0','-map','1:a:0?',...videoCodecArgs,
      '-c:a','aac','-b:a','160k','-shortest','-movflags','+faststart',output];
    await run(process.env.FFMPEG_PATH || 'ffmpeg', args);
    return { output, duration, cameraSwitches: Math.max(0, plan.length - 1) };
  } finally {
    await fs.unlink(ass).catch(()=>{});
    await Promise.all(parts.map(p => fs.unlink(p).catch(()=>{})));
  }
}
