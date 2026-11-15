import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import mongoose from 'mongoose';
import { Podcast, Clip, Activity } from '../models/index.js';
import { auth, allow } from '../middleware/auth.js';
import { enqueueYoutubeTranscription, enqueueTranscription, enqueueClipSelection, enqueueStorySelection, enqueueOpusClipProject, enqueueRender, mediaQueue, requestMediaJobCancellation } from '../queue.js';
import { normalizeYouTubeUrl } from '../services/youtube.js';
import { applySpeakerCorrections } from '../services/transcript.js';

const r = Router();
const root = path.resolve(process.env.MEDIA_ROOT || './server/storage');
fs.mkdirSync(root, { recursive: true });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const validId = id => mongoose.isValidObjectId(id);
const publicPodcast = doc => { const obj = doc.toObject ? doc.toObject() : doc; if (obj.sourceFiles) obj.sourceFiles = obj.sourceFiles.map(({ path: _path, ...f }) => f); delete obj.audioPath; return obj; };
const publicClip = doc => { const obj = doc.toObject ? doc.toObject() : doc; delete obj.renderPath; return obj; };
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(root, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true }); cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${nanoid()}-${path.basename(file.originalname).replace(/[^\w.-]/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024 * 1024), files: 12 },
  fileFilter: (req, file, cb) => /^(audio|video)\//.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error('Only audio and video files are allowed'), { status: 400 }))
});
r.get('/', auth, wrap(async (req, res) => res.json((await Podcast.find().sort({ createdAt: -1 }).select('-transcript -deepgramTranscript -sarvamTranscript -sarvamSegments -segments -opusClipClips -storyMoments')).map(publicPodcast))));
r.post('/', auth, allow('admin','editor'), wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 180);
  if (!title) return res.status(400).json({ error: 'Podcast title is required' });
  const p = await Podcast.create({ title, description: req.body.description, createdBy: req.user.id });
  await Activity.create({ user: req.user.id, action: 'podcast_created', entityType: 'Podcast', entityId: p._id });
  res.status(201).json(p);
}));
r.post('/youtube', auth, allow('admin','editor'), wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 180);
  const url = normalizeYouTubeUrl(req.body?.url);
  if (!title) return res.status(400).json({ error: 'Podcast title is required' });
  if (!url) return res.status(400).json({ error: 'Enter a valid YouTube video link' });

  const podcast = await Podcast.create({ title, sourceUrl: url, status: 'queued', createdBy: req.user.id });
  try {
    const job = await enqueueYoutubeTranscription(podcast.id, req.user.id, url);
    podcast.jobId = job.id;
    podcast.jobType = job.name;
    podcast.jobProgress = 0;
    podcast.jobMessage = 'Waiting to transcribe the YouTube audio stream';
    await podcast.save();
    await Activity.create({ user: req.user.id, action: 'youtube_transcription_queued', entityType: 'Podcast', entityId: podcast._id });
    res.status(202).json({
      message: 'YouTube transcription queued; media will not be saved locally',
      podcast: publicPodcast(podcast),
      jobId: job.id,
    });
  } catch (error) {
    podcast.status = 'failed';
    podcast.error = error.message.slice(0, 2000);
    await podcast.save();
    throw error;
  }
}));
r.post('/:id/files', auth, allow('admin','editor'), wrap(async (req, res, next) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const p = await Podcast.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Podcast not found' });
  upload.array('files', 12)(req, res, async err => {
    if (err) return next(err);
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'Select at least one audio or video file' });
      const kind = ['video','audio','mix'].includes(req.body.kind) ? req.body.kind : 'video';
      const speaker = String(req.body.speaker || '').trim().slice(0, 80);
      p.sourceFiles.push(...req.files.map(f => ({ path: f.path, kind, speaker, originalName: f.originalname })));
      await p.save();
      await Activity.create({ user: req.user.id, action: 'source_files_uploaded', entityType: 'Podcast', entityId: p._id, details: { count: req.files.length, kind, speaker } });
      res.json(publicPodcast(p));
    } catch (e) { next(e); }
  });
}));
r.post('/:id/transcribe', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const p = await Podcast.findById(req.params.id);
  if (!p) return res.status(404).json({ error: 'Podcast not found' });
  if (!p.sourceFiles.length) return res.status(400).json({ error: 'Upload media first' });
  p.status = 'queued'; p.error = undefined; await p.save();
  try {
    const job = await enqueueTranscription(p.id, req.user.id);
    p.jobId = job.id;
    p.jobType = job.name;
    p.jobProgress = 0;
    p.jobMessage = 'Waiting for a worker to transcribe the audio';
    await p.save();
    res.status(202).json({ message: 'Transcription queued', podcastId: p.id, jobId: job.id });
  }
  catch (e) { p.status = 'failed'; p.error = e.message; await p.save(); throw e; }
}));
r.post('/:id/select-clips', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (!podcast.transcript || !podcast.duration) return res.status(400).json({ error: 'Transcribe the podcast before generating clip suggestions' });
  const job = await enqueueClipSelection(podcast.id, req.user.id);
  podcast.status = 'processing';
  podcast.error = undefined;
  podcast.jobId = job.id;
  podcast.jobType = job.name;
  podcast.jobProgress = 0;
  podcast.jobMessage = 'Waiting to generate AI reel suggestions from the transcript';
  await podcast.save();
  res.status(202).json({ message: 'AI clip suggestion job queued', podcastId: podcast.id, jobId: job.id });
}));
r.post('/:id/select-stories', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  if (!process.env.LLM_API_KEY) return res.status(503).json({ error: 'Story selection is temporarily unavailable. Please contact an administrator.' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (!podcast.transcript || !podcast.duration) return res.status(400).json({ error: 'Transcribe the podcast before generating story moments' });
  if (['queued','processing'].includes(podcast.storyMomentsStatus)) return res.status(409).json({ error: 'Story moment generation is already in progress' });
  podcast.storyMomentsStatus = 'queued';
  podcast.storyMomentsMessage = 'Story selection queued';
  podcast.storyMomentsError = undefined;
  await podcast.save();
  try {
    const job = await enqueueStorySelection(podcast.id, req.user.id);
    res.status(202).json({ message: 'Story selection queued', podcastId: podcast.id, jobId: job.id });
  } catch (error) {
    podcast.storyMomentsStatus = 'failed';
    podcast.storyMomentsMessage = 'Could not queue story moment selection';
    podcast.storyMomentsError = error.message.slice(0, 2000);
    await podcast.save();
    throw error;
  }
}));
r.post('/:id/opusclip', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  if (!process.env.OPUSCLIP_API_KEY) return res.status(503).json({ error: 'Reel generation is temporarily unavailable. Please contact an administrator.' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (!podcast.sourceUrl && !podcast.sourceFiles?.some(file => file.kind === 'video' && file.path)) {
    return res.status(400).json({ error: 'OpusClip requires a YouTube source URL or an uploaded video file' });
  }
  if (!podcast.transcript || !podcast.duration) {
    return res.status(400).json({ error: 'Transcribe the podcast before starting reel generation' });
  }
  if (['queued','processing'].includes(podcast.opusClipStatus)) {
    return res.status(409).json({ error: 'OpusClip is already processing this podcast' });
  }
  podcast.opusClipStatus = 'queued';
  podcast.opusClipMessage = 'Waiting for OpusClip worker';
  podcast.opusClipError = undefined;
  podcast.opusClipProjectId = undefined;
  podcast.opusClipOrgId = undefined;
  podcast.opusClipOpenAiMoments = [];
  podcast.opusClipClips = [];
  await podcast.save();
  let job;
  try {
    job = await enqueueOpusClipProject(podcast.id, req.user.id);
  } catch (error) {
    podcast.opusClipStatus = 'failed';
    podcast.opusClipMessage = 'Could not queue OpusClip generation';
    podcast.opusClipError = error.message.slice(0, 2000);
    await podcast.save();
    throw error;
  }
  res.status(202).json({ message: 'Reel generation queued', podcastId: podcast.id, jobId: job.id });
}));
r.get('/jobs/:jobId', auth, wrap(async (req, res) => {
  const job = await mediaQueue.getJob(req.params.jobId); if (!job) return res.status(404).json({ error: 'Job not found' });
  const state = await job.getState(); res.json({ id: job.id, name: job.name, state, progress: job.progress, failedReason: job.failedReason || null, returnvalue: job.returnvalue || null });
}));
r.post('/:id/cancel', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (!['downloading','queued','processing'].includes(podcast.status) || !podcast.jobId) {
    return res.status(409).json({ error: 'This podcast has no active processing job to stop' });
  }
  const job = await mediaQueue.getJob(podcast.jobId);
  if (!job || !['import-youtube','transcribe-youtube','transcribe-podcast','select-clips'].includes(job.name) || String(job.data?.podcastId) !== podcast.id) {
    return res.status(409).json({ error: 'The current processing job could not be found; refresh the podcast status and try again' });
  }
  const cancellation = await requestMediaJobCancellation(job);
  if (cancellation === 'cancelled') {
    const updated = await Podcast.updateOne(
      { _id: podcast._id, jobId: job.id, status: { $in: ['downloading','queued','processing'] } },
      { $set: { status: 'cancelled', jobMessage: 'Processing cancelled' }, $unset: { error: 1 } }
    );
    if (!updated.matchedCount) return res.status(409).json({ error: 'The podcast job changed while stopping; refresh and try again' });
    return res.json({ message: 'Processing stopped', status: 'cancelled' });
  }
  if (cancellation === 'cancelling') {
    const updated = await Podcast.updateOne(
      { _id: podcast._id, jobId: job.id, status: { $in: ['downloading','queued','processing'] } },
      { $set: { jobMessage: 'Cancellation requested. Waiting for the worker to stop.' } }
    );
    if (!updated.matchedCount) return res.status(409).json({ error: 'The podcast job changed while stopping; refresh and try again' });
    return res.status(202).json({ message: 'Stop requested. The current processing step is being cancelled.', status: podcast.status });
  }
  return res.status(409).json({ error: `This job is ${cancellation} and cannot be stopped` });
}));
r.post('/:id/restart', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const jobType = podcast.jobType || (
    podcast.sourceUrl && !podcast.sourceFiles?.length
      ? 'import-youtube'
      : podcast.transcript && podcast.duration
        ? 'select-clips'
        : podcast.sourceFiles?.length
          ? 'transcribe-podcast'
          : null
  );
  const retryingClipSelection = jobType === 'select-clips'
    && podcast.status === 'transcribed'
    && Number(podcast.jobProgress) < 100;
  if (!['failed','cancelled'].includes(podcast.status) && !retryingClipSelection) {
    return res.status(409).json({ error: 'Only stopped or failed podcast jobs can be restarted' });
  }
  if (!['import-youtube','transcribe-youtube','transcribe-podcast','select-clips'].includes(jobType)) {
    return res.status(409).json({ error: 'The previous job type is unavailable; start processing from the podcast details instead' });
  }
  if ((jobType === 'import-youtube' || jobType === 'transcribe-youtube') && !podcast.sourceUrl) {
    return res.status(400).json({ error: 'The YouTube source URL is missing' });
  }
  if (jobType === 'transcribe-podcast' && !podcast.sourceFiles?.length) {
    return res.status(400).json({ error: 'Upload a source file before restarting transcription' });
  }
  if (jobType === 'select-clips' && (!podcast.transcript || !podcast.duration)) {
    return res.status(400).json({ error: 'A transcript is required before restarting clip selection' });
  }

  const previousStatus = podcast.status;
  const previousJobId = podcast.jobId || null;
  const startingStatus = jobType === 'import-youtube' || jobType === 'transcribe-youtube' || jobType === 'transcribe-podcast' ? 'queued' : 'processing';
  const claimed = await Podcast.updateOne(
    { _id: podcast._id, status: previousStatus, jobId: previousJobId },
    {
      $set: { status: startingStatus, jobType, jobProgress: 0, jobMessage: 'Restarting processing' },
      $unset: { error: 1 }
    }
  );
  if (!claimed.matchedCount) return res.status(409).json({ error: 'The podcast status changed; refresh and try again' });
  let job;
  try {
    job = jobType === 'import-youtube' || jobType === 'transcribe-youtube'
      ? await enqueueYoutubeTranscription(podcast.id, req.user.id, podcast.sourceUrl)
      : jobType === 'transcribe-podcast'
        ? await enqueueTranscription(podcast.id, req.user.id)
        : await enqueueClipSelection(podcast.id, req.user.id);
  } catch (error) {
    await Podcast.updateOne(
      { _id: podcast._id, status: startingStatus, jobId: previousJobId },
      { $set: { status: 'failed', error: error.message.slice(0, 2000), jobMessage: 'Could not restart processing' } }
    );
    throw error;
  }
  await Podcast.updateOne(
    { _id: podcast._id, jobId: previousJobId, status: startingStatus },
    { $set: { jobId: job.id, jobType: job.name } }
  );
  return res.status(202).json({ message: 'Podcast processing restarted', podcastId: podcast.id });
}));
r.get('/analytics/summary', auth, wrap(async (req, res) => {
  const [podcastCount, clipCount, approvedCount, aggregate] = await Promise.all([
    Podcast.countDocuments(),
    Clip.countDocuments({ createdByAI: true }),
    Clip.countDocuments({ createdByAI: true, status: { $in: ['approved', 'rendered'] } }),
    Clip.aggregate([{ $group: { _id: null, totalViews: { $sum: { $ifNull: ['$performance.views', 0] } }, averageWatchTime: { $avg: '$performance.watchTime' } } }])
  ]);
  const metrics = aggregate[0] || {};
  res.json({
    podcastCount,
    clipCount,
    approvedCount,
    approvalRate: clipCount ? Math.round((approvedCount / clipCount) * 100) : 0,
    totalViews: metrics.totalViews || 0,
    averageWatchTime: Math.round(metrics.averageWatchTime || 0)
  });
}));
r.get('/analytics/learning-examples', auth, wrap(async (req, res) => {
  const examples = await Clip.find({ status: { $in: ['approved', 'rendered'] }, 'performance.views': { $gt: 0 } })
    .sort({ 'performance.views': -1, updatedAt: -1 })
    .limit(20)
    .select('title hook caption reason score performance status')
    .lean();
  res.json(examples);
}));
r.get('/analytics/activity', auth, allow('admin'), wrap(async (req, res) => {
  const events = await Activity.find()
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('user', 'name email')
    .lean();
  res.json(events.map(event => {
    const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details)
      ? { ...event.details }
      : event.details;
    if (details && typeof details === 'object') delete details.renderPath;
    return { ...event, details };
  }));
}));
r.get('/:id', auth, wrap(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' }); const p = await Podcast.findById(req.params.id); if (!p) return res.status(404).json({ error: 'Not found' }); res.json(publicPodcast(p)); }));
r.get('/:id/clips', auth, wrap(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' }); res.json((await Clip.find({ podcast: req.params.id }).sort({ score: -1 })).map(publicClip)); }));
r.patch('/clips/:clipId', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.clipId)) return res.status(400).json({ error: 'Invalid clip id' });
  const allowed = ['start','end','hook','title','caption','status','editorNotes','cameraSegments','captionSegments','performance'];
  const update = {}; for (const k of allowed) if (req.body?.[k] !== undefined) update[k] = req.body[k];
  if (update.performance !== undefined) {
    if (!update.performance || typeof update.performance !== 'object' || Array.isArray(update.performance)) return res.status(400).json({ error: 'Performance must include views or watch time' });
    for (const key of ['views','watchTime']) {
      if (update.performance[key] === undefined) continue;
      const value = Number(update.performance[key]);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: 'Performance views and watch time must be non-negative numbers' });
      update.performance[key] = value;
    }
    if (!Object.keys(update.performance).some(key => ['views','watchTime'].includes(key))) return res.status(400).json({ error: 'Performance must include views or watch time' });
  }
  const existing = await Clip.findById(req.params.clipId); if (!existing) return res.status(404).json({ error: 'Clip not found' });
  const podcast = await Podcast.findById(existing.podcast); if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (update.performance) {
    update.performance = {
      views: update.performance.views ?? existing.performance?.views ?? 0,
      watchTime: update.performance.watchTime ?? existing.performance?.watchTime ?? 0
    };
  }
  const start = Number(update.start ?? existing.start), end = Number(update.end ?? existing.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || (podcast.duration && end > podcast.duration + 0.25)) return res.status(400).json({ error: 'Trim must be within the source duration and end must be greater than start' });
  if (update.status && !['suggested','approved','rejected','rendered'].includes(update.status)) return res.status(400).json({ error: 'Invalid clip status' });
  if (update.cameraSegments && (!Array.isArray(update.cameraSegments) || update.cameraSegments.some(s => !Number.isFinite(Number(s.start)) || !Number.isFinite(Number(s.end)) || Number(s.start) < 0 || Number(s.end) <= Number(s.start) || Number(s.end) > end-start+0.25))) return res.status(400).json({ error: 'Camera segments must use valid clip-relative time ranges' });
  if (update.cameraSegments && update.cameraSegments.some(s => !podcast.sourceFiles.some(f => f.speaker === s.speaker && f.kind === 'video'))) return res.status(400).json({ error: 'Each camera segment speaker must match an uploaded video camera speaker key' });
  Object.assign(existing, update); await existing.save();
  await Activity.create({ user: req.user.id, action: 'clip_updated', entityType: 'Clip', entityId: existing.id, details: update }); res.json(publicClip(existing));
}));
r.delete('/:id', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });

  const clips = await Clip.find({ podcast: podcast._id }).select('_id renderStatus').lean();
  const podcastJobActive = ['downloading','queued','processing'].includes(podcast.status);
  const storyJobActive = ['queued','processing'].includes(podcast.storyMomentsStatus);
  const reelJobActive = ['queued','processing'].includes(podcast.opusClipStatus);
  const renderJobActive = clips.some(clip => ['queued','processing'].includes(clip.renderStatus));
  if (podcastJobActive || storyJobActive || reelJobActive || renderJobActive) {
    return res.status(409).json({ error: 'This podcast is still processing. Wait for its jobs to finish before deleting it.' });
  }

  const podcastDir = path.resolve(root, podcast.id);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!podcastDir.startsWith(rootPrefix)) throw new Error('Podcast media directory is outside configured storage');
  await fs.promises.rm(podcastDir, { recursive: true, force: true });

  const clipIds = clips.map(clip => clip._id);
  const activityFilters = [{ entityType: 'Podcast', entityId: podcast._id }];
  if (clipIds.length) activityFilters.push({ entityType: 'Clip', entityId: { $in: clipIds } });
  await Activity.deleteMany({ $or: activityFilters });
  await Clip.deleteMany({ podcast: podcast._id });
  await Podcast.deleteOne({ _id: podcast._id });
  res.json({ message: 'Podcast and associated history deleted', podcastId: podcast.id });
}));
r.post('/clips/:clipId/render', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.clipId)) return res.status(400).json({ error: 'Invalid clip id' });
  const clip = await Clip.findById(req.params.clipId); if (!clip) return res.status(404).json({ error: 'Clip not found' });
  const podcast = await Podcast.findById(clip.podcast); if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const settings = { brandText: String(req.body?.brandText || 'VANDE DIGITAL').slice(0,80), fontName: String(req.body?.fontName || 'Arial').replace(/[^\w -]/g,'').slice(0,40), primaryColour: req.body?.primaryColour || '&H00FFFFFF', accentColour: req.body?.accentColour || '&H00419BC7', outlineColour: req.body?.outlineColour || '&H00000000' };
  const job = await enqueueRender(clip.id, req.user.id, settings);
  clip.renderJobId = job.id;
  clip.renderStatus = 'queued';
  clip.renderProgress = 0;
  clip.renderError = undefined;
  await clip.save();
  res.status(202).json({ message: 'Render queued', jobId: job.id, clipId: clip.id });
}));
r.get('/clips/:clipId/render', auth, wrap(async (req, res) => {
  if (!validId(req.params.clipId)) return res.status(400).json({ error: 'Invalid clip id' });
  const clip = await Clip.findById(req.params.clipId); if (!clip?.renderPath) return res.status(404).json({ error: 'No rendered version available' });
  const resolved = path.resolve(clip.renderPath); if (!resolved.startsWith(path.resolve(root) + path.sep)) return res.status(403).json({ error: 'Invalid render path' });
  await Activity.create({ user: req.user.id, action: 'render_accessed', entityType: 'Clip', entityId: clip._id, details: { renderVersion: clip.renderVersion } });
  res.type('mp4').sendFile(resolved, err => { if (err && !res.headersSent) res.status(404).json({ error: 'Rendered file not found' }); });
}));
r.get('/:id/transcript', auth, wrap(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' }); const p = await Podcast.findById(req.params.id).select('transcript segments language'); if (!p) return res.status(404).json({ error: 'Not found' }); res.json(p); }));
r.patch('/:id/transcript', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const input = req.body?.speakerCorrections;
  if (!Array.isArray(input) || !input.length || input.length > 10000) {
    return res.status(400).json({ error: 'Provide speaker corrections for transcript lines' });
  }
  const corrections = [];
  for (const item of input) {
    const start = Number(item?.start);
    const end = Number(item?.end);
    const speaker = item?.speaker;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start
      || (podcast.duration && end > podcast.duration + 0.25)) {
      return res.status(400).json({ error: 'Speaker correction ranges must be within the transcript duration' });
    }
    if (!(speaker === null || (typeof speaker === 'number' && Number.isFinite(speaker) && speaker >= 0)
      || (typeof speaker === 'string' && speaker.trim().length > 0 && speaker.length <= 80))) {
      return res.status(400).json({ error: 'Speaker must be a detected speaker label or null' });
    }
    corrections.push({ start, end, speaker });
  }
  podcast.segments = applySpeakerCorrections(podcast.segments || [], corrections);
  await podcast.save();
  await Activity.create({
    user: req.user.id,
    action: 'transcript_speakers_corrected',
    entityType: 'Podcast',
    entityId: podcast._id,
    details: { correctionCount: corrections.length }
  });
  res.json(publicPodcast(podcast));
}));
export default r;
