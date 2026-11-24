import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { nanoid } from 'nanoid';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Podcast, Clip, Activity, User, UploadSession } from '../models/index.js';
import { auth, allow } from '../middleware/auth.js';
import { enqueueYoutubeTranscription, enqueueTranscription, enqueueClipSelection, enqueueStorySelection, enqueueOpusClipProject, enqueueRender, mediaQueue, requestMediaJobCancellation } from '../queue.js';
import { normalizeYouTubeUrl } from '../services/youtube.js';
import { applySpeakerCorrections } from '../services/transcript.js';
import { normalizeSentenceEdits } from '../services/clipSentenceEdits.js';
import { normalizeClipScore } from '../services/clipSelector.js';
import { normalizeFolder, normalizeTags } from '../services/projectMetadata.js';
import { getExpectedChunkLength } from '../services/resumableUpload.js';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES, MAX_RESUMABLE_UPLOAD_BYTES, UPLOAD_CHUNK_BYTES } from '../config/limits.js';

const r = Router();
const notificationLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => String(req.user.id),
  message: { error: 'Too many notification polling requests. Try again shortly.' },
});
const uploadChunkLimiter = rateLimit({
  windowMs: 60_000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => String(req.user.id),
  message: { error: 'Upload request limit reached. Try again shortly.' },
});
const root = path.resolve(process.env.MEDIA_ROOT || './server/storage');
fs.mkdirSync(root, { recursive: true });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const validId = id => mongoose.isValidObjectId(id);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function cleanupExpiredUploads() {
  const expired = await UploadSession.find({ expiresAt: { $lte: new Date() } }).select('_id');
  for (const session of expired) {
    await fs.promises.rm(path.join(root, '.upload-sessions', `${session.id}.part`), { force: true });
  }
  if (expired.length) await UploadSession.deleteMany({ _id: { $in: expired.map(session => session._id) } });
}
const uploadCleanupTimer = setInterval(() => {
  cleanupExpiredUploads().catch(error => console.error(JSON.stringify({
    level: 'error',
    operation: 'cleanup_expired_uploads',
    message: error.message,
  })));
}, 60 * 60 * 1000);
uploadCleanupTimer.unref();
setTimeout(() => {
  cleanupExpiredUploads().catch(error => console.error(JSON.stringify({
    level: 'error',
    operation: 'cleanup_expired_uploads',
    message: error.message,
  })));
}, 30_000).unref();
// Keep storage paths private; API responses expose metadata but not filesystem locations.
const publicPodcast = doc => { const obj = doc.toObject ? doc.toObject() : doc; if (obj.sourceFiles) obj.sourceFiles = obj.sourceFiles.map(({ path: _path, ...f }) => f); delete obj.audioPath; return obj; };
const publicClip = doc => {
  const obj = doc.toObject ? doc.toObject() : doc;
  if (obj.score != null) obj.score = normalizeClipScore(obj.score);
  delete obj.renderPath;
  return obj;
};
const escapeXml = value => String(value ?? '').replace(/[<>&"']/g, character => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
})[character]);
const frame = (seconds, fps = 30) => Math.max(0, Math.round(Number(seconds || 0) * fps));
const smpteTimecode = (seconds, fps = 30) => {
  const totalFrames = frame(seconds, fps);
  const hh = Math.floor(totalFrames / (3600 * fps));
  const mm = Math.floor((totalFrames % (3600 * fps)) / (60 * fps));
  const ss = Math.floor((totalFrames % (60 * fps)) / fps);
  const ff = totalFrames % fps;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
};
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(root, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true }); cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${nanoid()}-${path.basename(file.originalname).replace(/[^\w.-]/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (req, file, cb) => /^(audio|video)\//.test(file.mimetype) ? cb(null, true) : cb(Object.assign(new Error('Only audio and video files are allowed'), { status: 400 }))
});
r.get('/upload-limits', auth, (req, res) => res.json({
  maxFiles: MAX_UPLOAD_FILES,
  maxFileBytes: MAX_UPLOAD_BYTES,
  maxResumableFileBytes: MAX_RESUMABLE_UPLOAD_BYTES,
  chunkBytes: UPLOAD_CHUNK_BYTES,
}));
r.post('/:id/uploads', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id).select('_id sourceFiles');
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const originalName = typeof req.body?.name === 'string' ? path.basename(req.body.name).slice(0, 240) : '';
  const size = Number(req.body?.size);
  const mimeType = String(req.body?.mimeType || '');
  const kind = req.body?.kind;
  const speaker = String(req.body?.speaker || '').trim().slice(0, 80);
  if (!originalName || !Number.isSafeInteger(size) || size <= 0 || size > MAX_RESUMABLE_UPLOAD_BYTES) {
    return res.status(400).json({ error: `File name and a file size between 1 byte and ${MAX_RESUMABLE_UPLOAD_BYTES} bytes are required` });
  }
  if (!/^(audio|video)\//i.test(mimeType)) return res.status(400).json({ error: 'Only audio and video files are allowed' });
  if (!['video','audio','mix'].includes(kind)) return res.status(400).json({ error: 'Select a valid source type' });
  if (podcast.sourceFiles.some(file => file.originalName === originalName && file.size === size && file.kind === kind && (file.speaker || '') === speaker)) {
    return res.json({ complete: true, size, chunkBytes: UPLOAD_CHUNK_BYTES });
  }

  let session = await UploadSession.findOne({
    podcast: podcast._id,
    user: req.user.id,
    originalName,
    size,
    mimeType,
    kind,
    speaker,
    expiresAt: { $gt: new Date() },
  }).sort({ updatedAt: -1 });
  if (!session) {
    session = await UploadSession.create({
      podcast: podcast._id,
      user: req.user.id,
      originalName,
      size,
      mimeType,
      kind,
      speaker,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  }
  res.status(201).json({ uploadId: String(session._id), offset: session.offset, size: session.size, chunkBytes: UPLOAD_CHUNK_BYTES });
}));
r.get('/:id/uploads', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const sessions = await UploadSession.find({
    podcast: req.params.id,
    user: req.user.id,
    $expr: { $lt: ['$offset', '$size'] },
    expiresAt: { $gt: new Date() },
  }).select('originalName size mimeType kind speaker offset expiresAt').lean();
  res.json(sessions.map(session => ({ ...session, uploadId: String(session._id) })));
}));
r.get('/:id/uploads/:uploadId', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.uploadId)) return res.status(400).json({ error: 'Invalid upload session id' });
  const session = await UploadSession.findOne({ _id: req.params.uploadId, podcast: req.params.id, user: req.user.id });
  if (!session) return res.status(404).json({ error: 'Upload session not found or expired' });
  res.json({ uploadId: String(session._id), offset: session.offset, size: session.size, chunkBytes: UPLOAD_CHUNK_BYTES });
}));
r.patch('/:id/uploads/:uploadId', auth, allow('admin','editor'), uploadChunkLimiter, wrap(async (req, res, next) => {
  if (!validId(req.params.id) || !validId(req.params.uploadId)) return res.status(400).json({ error: 'Invalid upload session id' });
  const now = new Date();
  const session = await UploadSession.findOneAndUpdate({
    _id: req.params.uploadId,
    podcast: req.params.id,
    user: req.user.id,
    expiresAt: { $gt: now },
    $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }],
  }, { $set: { lockUntil: new Date(now.getTime() + 10 * 60_000) } }, { new: true });
  if (!session) return res.status(409).json({ error: 'Upload session is busy, missing, or expired. Refresh its offset and retry.' });

  let committed = false;
  const partialPath = path.join(root, '.upload-sessions', `${session.id}.part`);
  try {
    const offset = Number(req.headers['upload-offset']);
    const rawContentLength = req.headers['content-length'];
    const contentLength = Number(rawContentLength);
    if (offset !== session.offset) return res.status(409).json({ error: `Upload offset mismatch; expected ${session.offset}` });
    if (session.offset >= session.size) return res.status(409).json({ error: 'All file bytes are already uploaded; complete the session' });
    const expectedLength = getExpectedChunkLength(session.size, session.offset, UPLOAD_CHUNK_BYTES);
    if (rawContentLength !== undefined && (!Number.isSafeInteger(contentLength) || contentLength !== expectedLength)) {
      return res.status(400).json({ error: `Chunk must contain exactly ${expectedLength} bytes` });
    }

    const chunks = [];
    let received = 0;
    for await (const chunk of req) {
      received += chunk.length;
      if (received > UPLOAD_CHUNK_BYTES) return res.status(413).json({ error: 'Upload chunk exceeds the configured chunk size' });
      chunks.push(chunk);
    }
    if (received !== expectedLength) return res.status(400).json({ error: 'Upload chunk ended before all expected bytes arrived' });

    await fs.promises.mkdir(path.dirname(partialPath), { recursive: true });
    try {
      const current = await fs.promises.stat(partialPath);
      if (current.size < session.offset) return res.status(409).json({ error: 'Stored upload is shorter than its saved offset; restart the upload' });
      if (current.size !== session.offset) await fs.promises.truncate(partialPath, session.offset);
    } catch (error) {
      if (error.code !== 'ENOENT' || session.offset !== 0) throw error;
    }
    await fs.promises.appendFile(partialPath, Buffer.concat(chunks, received));
    const nextOffset = session.offset + received;
    const updated = await UploadSession.updateOne(
      { _id: session._id, offset: session.offset, lockUntil: session.lockUntil },
      { $set: { offset: nextOffset, lockUntil: null } }
    );
    if (!updated.matchedCount) return res.status(409).json({ error: 'Upload session changed while saving this chunk; refresh its offset' });
    committed = true;
    res.json({ uploadId: String(session._id), offset: nextOffset, size: session.size });
  } catch (error) {
    next(error);
  } finally {
    if (!committed) {
      await UploadSession.updateOne({ _id: session._id, lockUntil: session.lockUntil }, { $set: { lockUntil: null } }).catch(() => {});
    }
  }
}));
r.post('/:id/uploads/:uploadId/complete', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.uploadId)) return res.status(400).json({ error: 'Invalid upload session id' });
  const now = new Date();
  const session = await UploadSession.findOneAndUpdate({
    _id: req.params.uploadId,
    podcast: req.params.id,
    user: req.user.id,
    expiresAt: { $gt: now },
    $or: [{ lockUntil: null }, { lockUntil: { $lt: now } }],
  }, { $set: { lockUntil: new Date(now.getTime() + 10 * 60_000) } }, { new: true });
  if (!session) return res.status(409).json({ error: 'Upload session is busy, missing, or expired' });
  if (session.offset !== session.size) {
    await UploadSession.updateOne({ _id: session._id }, { $set: { lockUntil: null } });
    return res.status(409).json({ error: `Upload is incomplete; ${session.size - session.offset} bytes remain` });
  }
  const partialPath = path.join(root, '.upload-sessions', `${session.id}.part`);
  const safeName = session.originalName.replace(/[^\w.-]/g, '_').slice(-180) || 'media';
  const targetDir = path.join(root, String(session.podcast));
  const targetPath = path.join(targetDir, `${session.id}-${safeName}`);
  await fs.promises.mkdir(targetDir, { recursive: true });
  let committed = false;
  let moved = false;
  try {
    const podcast = await Podcast.findById(session.podcast);
    if (!podcast) throw new Error('Podcast not found');
    if (!podcast.sourceFiles.some(file => file.path === targetPath)) {
      let stat;
      let partialExists = true;
      try {
        stat = await fs.promises.stat(partialPath);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        partialExists = false;
        stat = await fs.promises.stat(targetPath);
      }
      if (stat.size !== session.size) throw new Error('Stored upload size does not match the completed session');
      if (partialExists) {
        await fs.promises.rename(partialPath, targetPath);
        moved = true;
      }
      podcast.sourceFiles.push({
        path: targetPath,
        kind: session.kind,
        speaker: session.speaker,
        originalName: session.originalName,
        size: session.size,
      });
      await podcast.save();
    }
    committed = true;
    await UploadSession.deleteOne({ _id: session._id });
    try {
      await Activity.create({
        user: req.user.id,
        action: 'source_files_uploaded',
        entityType: 'Podcast',
        entityId: podcast._id,
        details: { count: 1, kind: session.kind, speaker: session.speaker, resumable: true },
      });
    } catch (error) {
      console.error(JSON.stringify({ level: 'error', operation: 'record_resumable_upload', podcastId: podcast.id, message: error.message }));
    }
    res.json(publicPodcast(podcast));
  } catch (error) {
    if (!committed) {
      if (moved) await fs.promises.rename(targetPath, partialPath).catch(() => {});
      await UploadSession.updateOne({ _id: session._id }, { $set: { lockUntil: null } });
    }
    throw error;
  }
}));
r.delete('/:id/uploads/:uploadId', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id) || !validId(req.params.uploadId)) return res.status(400).json({ error: 'Invalid upload session id' });
  const session = await UploadSession.findOneAndDelete({ _id: req.params.uploadId, podcast: req.params.id, user: req.user.id });
  if (!session) return res.status(404).json({ error: 'Upload session not found' });
  await fs.promises.rm(path.join(root, '.upload-sessions', `${session.id}.part`), { force: true });
  res.json({ message: 'Incomplete upload discarded' });
}));
r.get('/', auth, wrap(async (req, res) => {
  const filter = {};
  if (typeof req.query.folder === 'string') filter.folder = req.query.folder;
  if (typeof req.query.tag === 'string' && req.query.tag.trim()) filter.tags = req.query.tag.trim();
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const query = new RegExp(escapeRegex(req.query.q.trim().slice(0, 100)), 'i');
    filter.$or = [{ title: query }, { tags: query }];
  }
  res.json((await Podcast.find(filter).sort({ createdAt: -1 }).select('-transcript -deepgramTranscript -sarvamTranscript -sarvamSegments -segments -opusClipClips -storyMoments')).map(publicPodcast));
}));
r.post('/', auth, allow('admin','editor'), wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 180);
  if (!title) return res.status(400).json({ error: 'Podcast title is required' });
  const p = await Podcast.create({
    title,
    description: req.body.description,
    folder: normalizeFolder(req.body.folder),
    tags: normalizeTags(req.body.tags ?? []),
    createdBy: req.user.id
  });
  await Activity.create({ user: req.user.id, action: 'podcast_created', entityType: 'Podcast', entityId: p._id });
  res.status(201).json(p);
}));
r.post('/youtube', auth, allow('admin','editor'), wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 180);
  const url = normalizeYouTubeUrl(req.body?.url);
  if (!title) return res.status(400).json({ error: 'Podcast title is required' });
  if (!url) return res.status(400).json({ error: 'Enter a valid YouTube video link' });

  const podcast = await Podcast.create({
    title,
    sourceUrl: url,
    folder: normalizeFolder(req.body.folder),
    tags: normalizeTags(req.body.tags ?? []),
    status: 'queued',
    createdBy: req.user.id
  });
  try {
    // Persist the queue id and progress alongside the podcast for dashboard polling.
    const job = await enqueueYoutubeTranscription(podcast.id, req.user.id, url);
    podcast.jobId = job.id;
    podcast.jobType = job.name;
    podcast.jobProgress = 0;
    podcast.jobMessage = 'Waiting to transcribe the YouTube audio stream';
    await podcast.save();
    await Activity.create({ user: req.user.id, action: 'youtube_transcription_queued', entityType: 'Podcast', entityId: podcast._id });
    res.status(202).json({
      message: 'YouTube transcription queued; the source video is downloaded when rendering a clip',
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
  upload.array('files', MAX_UPLOAD_FILES)(req, res, async err => {
    if (err) return next(err);
    try {
      if (!req.files?.length) return res.status(400).json({ error: 'Select at least one audio or video file' });
      const kind = ['video','audio','mix'].includes(req.body.kind) ? req.body.kind : 'video';
      const speaker = String(req.body.speaker || '').trim().slice(0, 80);
      p.sourceFiles.push(...req.files.map(f => ({ path: f.path, kind, speaker, originalName: f.originalname, size: f.size })));
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
  if (['downloading','queued','processing'].includes(p.status) && p.jobId) {
    const currentJob = await mediaQueue.getJob(p.jobId);
    if (currentJob) {
      const state = await currentJob.getState();
      if (['waiting','active','delayed','paused','waiting-children'].includes(state)) {
        return res.status(202).json({
          message: state === 'active'
            ? 'Transcription is already running'
            : 'Transcription is queued. Check that Redis and the media worker are running.',
          podcastId: p.id,
          jobId: currentJob.id,
          state,
        });
      }
    }
  }
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
  if (['downloading','queued','processing'].includes(podcast.status)) {
    return res.status(409).json({ error: 'Podcast processing is already in progress' });
  }
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
  let selectedStoryMoments = [];
  if (Array.isArray(req.body?.storyIndexes)) {
    const storyIndexes = [...new Set(req.body.storyIndexes)]
      .filter(index => Number.isInteger(index) && index >= 0)
      .slice(0, 8);
    if (!storyIndexes.length) {
      return res.status(400).json({ error: 'Select at least one story moment' });
    }
    if (storyIndexes.some(index => index >= (podcast.storyMoments || []).length)) {
      return res.status(400).json({ error: 'A selected story moment is no longer available' });
    }
    selectedStoryMoments = storyIndexes.map(index => {
      const story = podcast.storyMoments[index] || {};
      return {
        start: Number(story.start),
        end: Number(story.end),
        title: String(story.title || ''),
        hook: String(story.summary || story.title || ''),
        reason: String(story.reason || story.summary || story.excerpt || '')
      };
    }).filter(moment => Number.isFinite(moment.start) && Number.isFinite(moment.end) && moment.end > moment.start);
    if (!selectedStoryMoments.length) {
      return res.status(400).json({ error: 'Selected story moments do not have valid timestamps' });
    }
  }
  if (['queued','processing'].includes(podcast.opusClipStatus)) {
    return res.status(409).json({ error: 'OpusClip is already processing this podcast' });
  }
  podcast.opusClipStatus = 'queued';
  podcast.opusClipMessage = 'Waiting for OpusClip worker';
  podcast.opusClipError = undefined;
  podcast.opusClipProjectId = undefined;
  podcast.opusClipOrgId = undefined;
  podcast.opusClipOpenAiMoments = selectedStoryMoments;
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
r.post('/:id/cancel-generation', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const config = {
    stories: {
      statusField: 'storyMomentsStatus',
      messageField: 'storyMomentsMessage',
      jobs: new Set(['select-stories']),
      label: 'Story finding',
    },
    reels: {
      statusField: 'opusClipStatus',
      messageField: 'opusClipMessage',
      jobs: new Set(['opusclip-generate', 'opusclip-poll']),
      label: 'Reel generation',
    },
  }[req.body?.generation];
  if (!config) return res.status(400).json({ error: 'Choose stories or reels to stop' });

  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (!['queued','processing'].includes(podcast[config.statusField])) {
    return res.status(409).json({ error: `${config.label} is not in progress` });
  }

  const jobs = await mediaQueue.getJobs(['waiting','active','delayed','paused'], 0, -1);
  const matchingJobs = jobs.filter(job => (
    config.jobs.has(job.name) && String(job.data?.podcastId) === podcast.id
  ));
  let activeCancellation = false;
  let cancellationRequested = false;
  for (const job of matchingJobs) {
    const cancellation = await requestMediaJobCancellation(job);
    if (cancellation === 'cancelling') {
      activeCancellation = true;
      cancellationRequested = true;
    } else if (cancellation === 'cancelled') {
      cancellationRequested = true;
    }
  }
  if (!cancellationRequested) {
    return res.status(409).json({ error: 'The generation job could not be found; refresh and try again' });
  }

  const message = activeCancellation
    ? 'Cancellation requested. Waiting for the worker to stop.'
    : `${config.label} stopped`;
  const updated = await Podcast.updateOne(
    { _id: podcast._id, [config.statusField]: { $in: ['queued','processing'] } },
    { $set: { [config.statusField]: activeCancellation ? 'processing' : 'cancelled', [config.messageField]: message } }
  );
  if (!updated.matchedCount) {
    return res.status(409).json({ error: 'The generation status changed while stopping; refresh and try again' });
  }
  return res.status(activeCancellation ? 202 : 200).json({
    message: activeCancellation ? `${config.label} stop requested` : message,
    status: activeCancellation ? 'processing' : 'cancelled',
  });
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
    Clip.countDocuments({ createdByAI: true, status: { $in: ['approved', 'rendered', 'published'] } }),
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
r.get('/analytics/backup-status', auth, allow('admin'), wrap(async (req, res) => {
  const statusPath = path.resolve(process.env.BACKUP_ROOT || './backups', 'backup-status.json');
  let status;
  try {
    status = JSON.parse(await fs.promises.readFile(statusPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return res.json({ status: 'never_run', lastVerification: null });
    throw error;
  }
  res.json({
    status: status.status || 'unknown',
    createdAt: status.createdAt || null,
    failedAt: status.failedAt || null,
    backupFolder: status.backupFolder || null,
    databaseArchiveBytes: status.databaseArchiveBytes || null,
    mediaIncluded: Boolean(status.mediaIncluded),
    error: status.error || null,
    lastVerification: status.lastVerification || null,
    lastRestoreTest: status.lastRestoreTest || null,
  });
}));
r.post('/analytics/backup-restore-test', auth, allow('admin'), wrap(async (req, res) => {
  const backupFolder = typeof req.body?.backupFolder === 'string' ? req.body.backupFolder : '';
  const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 500) : '';
  if (req.body?.confirmed !== true || !backupFolder || !notes) {
    return res.status(400).json({ error: 'Confirm a completed restore drill and provide its backup folder and notes' });
  }
  const statusPath = path.resolve(process.env.BACKUP_ROOT || './backups', 'backup-status.json');
  let status;
  try {
    status = JSON.parse(await fs.promises.readFile(statusPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'No backup status has been recorded' });
    throw error;
  }
  if (status.backupFolder !== backupFolder) return res.status(409).json({ error: 'The selected backup is not the latest completed backup' });
  status.lastRestoreTest = { testedAt: new Date().toISOString(), backupFolder, notes, testedBy: String(req.user.id) };
  const temporaryPath = `${statusPath}.${process.pid}.tmp`;
  await fs.promises.writeFile(temporaryPath, JSON.stringify(status, null, 2), 'utf8');
  await fs.promises.rm(statusPath, { force: true });
  await fs.promises.rename(temporaryPath, statusPath);
  try {
    await Activity.create({
      user: req.user.id,
      action: 'backup_restore_test_recorded',
      entityType: 'Backup',
      details: { backupFolder, notes },
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', operation: 'record_restore_test_activity', message: error.message }));
  }
  res.json({ message: 'Restore drill recorded', lastRestoreTest: status.lastRestoreTest });
}));
r.get('/analytics/learning-examples', auth, wrap(async (req, res) => {
  const examples = await Clip.find({ status: { $in: ['approved', 'rendered', 'published'] }, 'performance.views': { $gt: 0 } })
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
  const idsFor = entityType => [...new Set(events
    .filter(event => event.entityType === entityType && validId(event.entityId))
    .map(event => String(event.entityId)))];
  const [podcasts, clips, users] = await Promise.all([
    Podcast.find({ _id: { $in: idsFor('Podcast') } }).select('title').lean(),
    Clip.find({ _id: { $in: idsFor('Clip') } }).select('title podcast').lean(),
    User.find({ _id: { $in: idsFor('User') } }).select('name').lean(),
  ]);
  const clipPodcastIds = [...new Set(clips.map(clip => String(clip.podcast)).filter(validId))];
  const clipPodcasts = await Podcast.find({ _id: { $in: clipPodcastIds } }).select('title').lean();
  const podcastTitles = new Map([...podcasts, ...clipPodcasts].map(podcast => [String(podcast._id), podcast.title]));
  const clipTitles = new Map(clips.map(clip => [String(clip._id), clip]));
  const userNames = new Map(users.map(user => [String(user._id), user.name]));
  res.json(events.map(event => {
    const details = event.details && typeof event.details === 'object' && !Array.isArray(event.details)
      ? { ...event.details }
      : event.details;
    if (details && typeof details === 'object') delete details.renderPath;
    const entityId = String(event.entityId || '');
    let location = event.entityType || 'Workspace';
    if (event.entityType === 'Podcast') {
      location = `Podcast${podcastTitles.has(entityId) ? ` / ${podcastTitles.get(entityId)}` : ''}`;
    } else if (event.entityType === 'Clip') {
      const clip = clipTitles.get(entityId);
      const podcastTitle = clip ? podcastTitles.get(String(clip.podcast)) : null;
      location = `${podcastTitle ? `Podcast / ${podcastTitle} / ` : ''}Clip${clip?.title ? ` / ${clip.title}` : ''}`;
    } else if (event.entityType === 'User') {
      location = `Team${userNames.has(entityId) ? ` / ${userNames.get(entityId)}` : ''}`;
    } else if (event.entityType === 'Backup') {
      location = 'Backup and restore';
    }
    const podcastName = event.entityType === 'Podcast'
      ? podcastTitles.get(entityId)
      : event.entityType === 'Clip'
        ? podcastTitles.get(String(clipTitles.get(entityId)?.podcast || ''))
        : undefined;
    return { ...event, details, location, podcastName };
  }));
}));
r.delete('/analytics/activity', auth, allow('admin'), wrap(async (req, res) => {
  const result = await Activity.deleteMany({});
  res.json({ message: 'Activity history cleared', deletedCount: result.deletedCount });
}));
r.get('/notifications', auth, notificationLimiter, wrap(async (req, res) => {
  const sinceValue = typeof req.query.since === 'string' ? new Date(req.query.since) : null;
  if (!sinceValue || !Number.isFinite(sinceValue.getTime())) {
    return res.status(400).json({ error: 'A valid since timestamp is required' });
  }
  const actions = [
    'transcription_completed',
    'youtube_transcription_completed',
    'clip_suggestions_generated',
    'story_moments_generated',
    'opusclip_reels_generated',
    'clip_rendered',
    'background_job_failed',
  ];
  const events = await Activity.find({ action: { $in: actions }, createdAt: { $gt: sinceValue } })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const podcastIds = events.filter(event => event.entityType === 'Podcast').map(event => event.entityId);
  const clipIds = events.filter(event => event.entityType === 'Clip').map(event => event.entityId);
  const [podcasts, clips] = await Promise.all([
    Podcast.find({ _id: { $in: podcastIds } }).select('title').lean(),
    Clip.find({ _id: { $in: clipIds } }).populate('podcast', 'title').select('title podcast').lean(),
  ]);
  const podcastTitles = new Map(podcasts.map(podcast => [String(podcast._id), podcast.title]));
  const clipDetails = new Map(clips.map(clip => [String(clip._id), clip]));
  const titles = {
    transcription_completed: 'Transcription complete',
    youtube_transcription_completed: 'Transcription complete',
    clip_suggestions_generated: 'Clip suggestions ready',
    story_moments_generated: 'Story moments ready',
    opusclip_reels_generated: 'Generated reels ready',
    clip_rendered: 'Clip render ready',
    background_job_failed: 'Background job failed',
  };
  const failedJobTitles = {
    'transcribe-podcast': 'Transcription failed',
    'transcribe-youtube': 'YouTube transcription failed',
    'import-youtube': 'YouTube import failed',
    'select-clips': 'Clip suggestions failed',
    'select-stories': 'Story moments failed',
    'render-clip': 'Clip render failed',
    'opusclip-generate': 'Reel generation failed',
  };
  const retryableJobs = new Set(['transcribe-podcast', 'transcribe-youtube', 'import-youtube', 'select-clips', 'select-stories', 'render-clip', 'opusclip-generate']);
  const notifications = events.map(event => {
    const clip = event.entityType === 'Clip' ? clipDetails.get(String(event.entityId)) : null;
    const podcastTitle = event.entityType === 'Podcast'
      ? podcastTitles.get(String(event.entityId))
      : clip?.podcast?.title;
    const details = event.details || {};
    const target = podcastTitle || clip?.title || 'Project';
    return {
      id: String(event._id),
      title: event.action === 'background_job_failed'
        ? failedJobTitles[details.jobName] || titles.background_job_failed
        : titles[event.action] || 'Background job update',
      message: details.message
        ? (details.message.startsWith(`${target}:`) ? details.message : `${target}: ${details.message}`)
        : `${target}${clip?.title && podcastTitle ? ` · ${clip.title}` : ''}`,
      createdAt: event.createdAt,
      jobName: details.jobName || null,
      retryable: event.action === 'background_job_failed' && retryableJobs.has(details.jobName),
    };
  });
  if (req.user.role === 'admin') {
    const statusPath = path.resolve(process.env.BACKUP_ROOT || './backups', 'backup-status.json');
    try {
      const backupStatus = JSON.parse(await fs.promises.readFile(statusPath, 'utf8'));
      notifications.push(...(backupStatus.history || []).filter(event => new Date(event.createdAt) > sinceValue).map(event => ({
        id: event.id,
        title: event.status === 'success' ? 'Backup completed' : 'Backup failed',
        message: event.status === 'success'
          ? 'Scheduled backup finished successfully.'
          : `Scheduled backup failed: ${event.error || 'Check backup process logs.'}`,
        createdAt: event.createdAt,
        retryable: false,
      })));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  res.json(notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 50));
}));
r.post('/notifications/:activityId/retry', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.activityId)) return res.status(400).json({ error: 'Invalid notification id' });
  const event = await Activity.findOne({ _id: req.params.activityId, action: 'background_job_failed' }).lean();
  if (!event) return res.status(404).json({ error: 'Failed job notification not found' });
  const jobName = event.details?.jobName;
  const retryableJobs = new Set(['transcribe-podcast', 'transcribe-youtube', 'import-youtube', 'select-clips', 'select-stories', 'render-clip', 'opusclip-generate']);
  if (!retryableJobs.has(jobName)) return res.status(400).json({ error: 'This job type cannot be retried from notifications' });

  let job;
  if (jobName === 'render-clip') {
    const clip = await Clip.findById(event.entityId);
    if (!clip || clip.renderStatus !== 'failed') return res.status(409).json({ error: 'Clip is no longer in a retryable state' });
    const podcast = await Podcast.findById(clip.podcast);
    if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
    job = await enqueueRender(clip.id, req.user.id, clip.renderSettings || {});
    clip.renderJobId = job.id;
    clip.renderStatus = 'queued';
    clip.renderProgress = 0;
    clip.renderError = undefined;
    await clip.save();
  } else {
    const podcast = await Podcast.findById(event.entityId);
    if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
    if (jobName === 'select-stories') {
      if (podcast.storyMomentsStatus !== 'failed' || !podcast.transcript || !podcast.duration) {
        return res.status(409).json({ error: 'Story selection is no longer in a retryable state' });
      }
      job = await enqueueStorySelection(podcast.id, req.user.id);
      podcast.storyMomentsStatus = 'queued';
      podcast.storyMomentsMessage = 'Story selection queued for retry';
      podcast.storyMomentsError = undefined;
    } else if (jobName === 'select-clips') {
      if (podcast.status !== 'transcribed' || podcast.jobType !== 'select-clips' || Number(podcast.jobProgress) >= 100) {
        return res.status(409).json({ error: 'Clip selection is no longer in a retryable state' });
      }
      job = await enqueueClipSelection(podcast.id, req.user.id);
      podcast.status = 'processing';
      podcast.jobProgress = 0;
      podcast.jobMessage = 'Retrying clip selection';
      podcast.error = undefined;
    } else if (jobName === 'transcribe-podcast') {
      if (podcast.status !== 'failed' || !podcast.sourceFiles?.length) return res.status(409).json({ error: 'Transcription is no longer in a retryable state' });
      job = await enqueueTranscription(podcast.id, req.user.id);
      podcast.status = 'queued';
      podcast.error = undefined;
    } else if (jobName === 'transcribe-youtube' || jobName === 'import-youtube') {
      if (podcast.status !== 'failed' || !podcast.sourceUrl) return res.status(409).json({ error: 'YouTube import is no longer in a retryable state' });
      job = await enqueueYoutubeTranscription(podcast.id, req.user.id, podcast.sourceUrl);
      podcast.status = 'queued';
      podcast.error = undefined;
    } else {
      if (podcast.opusClipStatus !== 'failed' || !podcast.transcript || !podcast.sourceUrl && !podcast.sourceFiles?.some(file => file.kind === 'video' && file.path)) {
        return res.status(409).json({ error: 'Reel generation is no longer in a retryable state' });
      }
      job = await enqueueOpusClipProject(podcast.id, req.user.id);
      podcast.opusClipStatus = 'queued';
      podcast.opusClipMessage = 'Reel generation queued for retry';
      podcast.opusClipError = undefined;
    }
    if (['transcribe-podcast', 'transcribe-youtube', 'import-youtube', 'select-clips'].includes(jobName)) {
      podcast.jobId = job.id;
      podcast.jobType = job.name;
      podcast.jobProgress = 0;
    }
    await podcast.save();
  }
  await Activity.create({
    user: req.user.id,
    action: 'background_job_retried',
    entityType: event.entityType,
    entityId: event.entityId,
    details: { jobName, jobId: job.id },
  });
  res.status(202).json({ message: 'Job retry queued', jobId: job.id, jobName });
}));
r.patch('/:id', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const changed = [];
  if (req.body?.folder !== undefined) {
    podcast.folder = normalizeFolder(req.body.folder);
    changed.push('folder');
  }
  if (req.body?.tags !== undefined) {
    podcast.tags = normalizeTags(req.body.tags);
    changed.push('tags');
  }
  if (!changed.length) return res.status(400).json({ error: 'Provide folder or tags to update' });
  await podcast.save();
  await Activity.create({ user: req.user.id, action: 'podcast_organization_updated', entityType: 'Podcast', entityId: podcast._id, details: { changed } });
  res.json(publicPodcast(podcast));
}));
r.post('/:id/source-preview', auth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id).select('sourceFiles');
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const source = podcast.sourceFiles.find(file => file.kind === 'video' && file.path);
  if (!source) return res.status(404).json({ error: 'No uploaded video source is available to preview' });
  const previewToken = jwt.sign(
    { purpose: 'clip-source-preview', podcastId: podcast.id, userId: req.user.id },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  res.json({ url: `/api/podcasts/${podcast.id}/source?previewToken=${encodeURIComponent(previewToken)}` });
}));
r.get('/:id/source', wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  let claims;
  try {
    claims = jwt.verify(String(req.query.previewToken || ''), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Source preview link is invalid or expired' });
  }
  if (claims.purpose !== 'clip-source-preview' || claims.podcastId !== req.params.id) {
    return res.status(403).json({ error: 'Source preview link is not valid for this podcast' });
  }
  const user = await User.findById(claims.userId).select('_id');
  if (!user) return res.status(401).json({ error: 'User not found' });
  const podcast = await Podcast.findById(req.params.id).select('sourceFiles');
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const source = podcast.sourceFiles.find(file => file.kind === 'video' && file.path);
  if (!source) return res.status(404).json({ error: 'No uploaded video source is available to preview' });
  const resolved = path.resolve(source.path);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!resolved.startsWith(rootPrefix)) return res.status(403).json({ error: 'Invalid media source path' });
  res.set('Cache-Control', 'private, no-store');
  await Activity.create({ user: user._id, action: 'source_preview_accessed', entityType: 'Podcast', entityId: podcast._id });
  res.type(path.extname(resolved)).sendFile(resolved, err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'Source media file not found' });
  });
}));
r.get('/:id/youtube-source', auth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id).select('sourceUrl title');
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (!podcast.sourceUrl) return res.status(404).json({ error: 'This podcast does not have a YouTube source' });

  const resolved = path.resolve(root, podcast.id, 'youtube-source.mp4');
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!resolved.startsWith(rootPrefix)) return res.status(403).json({ error: 'Invalid YouTube source path' });
  try {
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile() || stat.size === 0) return res.status(404).json({ error: 'Render a clip before saving the YouTube source video' });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Render a clip before saving the YouTube source video' });
    throw error;
  }
  res.set('Cache-Control', 'private, no-store');
  await Activity.create({ user: req.user.id, action: 'youtube_source_accessed', entityType: 'Podcast', entityId: podcast._id });
  res.type('mp4').sendFile(resolved, error => {
    if (error && !res.headersSent) res.status(404).json({ error: 'YouTube source video not found' });
  });
}));
r.get('/:id', auth, wrap(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' }); const p = await Podcast.findById(req.params.id); if (!p) return res.status(404).json({ error: 'Not found' }); res.json(publicPodcast(p)); }));
r.get('/:id/clips', auth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  res.json((await Clip.find({ podcast: req.params.id }).populate('assignedTo', 'name email role').sort({ score: -1 })).map(publicClip));
}));
r.patch('/clips/:clipId', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.clipId)) return res.status(400).json({ error: 'Invalid clip id' });
  const allowed = ['start','end','hook','title','caption','status','assignedTo','editorNotes','cameraSegments','captionSegments','performance','sentenceEdits'];
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
  if (update.assignedTo !== undefined) {
    if (update.assignedTo === null || update.assignedTo === '') update.assignedTo = null;
    else {
      if (!validId(update.assignedTo)) return res.status(400).json({ error: 'Invalid editor assignment' });
      const assignee = await User.findById(update.assignedTo).select('role');
      if (!assignee || !['admin','editor'].includes(assignee.role)) return res.status(400).json({ error: 'Clips can only be assigned to an active admin or editor' });
    }
  }
  if (update.performance) {
    update.performance = {
      views: update.performance.views ?? existing.performance?.views ?? 0,
      watchTime: update.performance.watchTime ?? existing.performance?.watchTime ?? 0
    };
  }
  const start = Number(update.start ?? existing.start), end = Number(update.end ?? existing.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || (podcast.duration && end > podcast.duration + 0.25)) return res.status(400).json({ error: 'Trim must be within the source duration and end must be greater than start' });
  const trimChanged = start !== Number(existing.start) || end !== Number(existing.end);
  if (update.sentenceEdits !== undefined) {
    try {
      update.sentenceEdits = normalizeSentenceEdits(update.sentenceEdits, start, end);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  } else if (trimChanged && existing.sentenceEdits?.length) {
    try {
      normalizeSentenceEdits(existing.sentenceEdits, start, end);
    } catch {
      return res.status(409).json({ error: 'Restore or update sentence edits before changing the clip trim' });
    }
  }
  if (update.status && !['suggested','approved','rejected','rendered','published'].includes(update.status)) return res.status(400).json({ error: 'Invalid clip status' });
  if (existing.status === 'published' && update.status && update.status !== 'published') {
    return res.status(409).json({ error: 'Published clips cannot return to an earlier workflow stage' });
  }
  if (update.status === 'published' && !['approved','rendered','published'].includes(existing.status)) {
    return res.status(409).json({ error: 'Approve a clip before publishing it' });
  }
  if (update.cameraSegments && (!Array.isArray(update.cameraSegments) || update.cameraSegments.some(s => !Number.isFinite(Number(s.start)) || !Number.isFinite(Number(s.end)) || Number(s.start) < 0 || Number(s.end) <= Number(s.start) || Number(s.end) > end-start+0.25))) return res.status(400).json({ error: 'Camera segments must use valid clip-relative time ranges' });
  if (update.cameraSegments && update.cameraSegments.some(s => !podcast.sourceFiles.some(f => f.speaker === s.speaker && f.kind === 'video'))) return res.status(400).json({ error: 'Each camera segment speaker must match an uploaded video camera speaker key' });
  const previousSentenceEdits = (existing.sentenceEdits || []).map(({ sentenceId, start: itemStart, end: itemEnd }) => ({
    ...(sentenceId ? { sentenceId } : {}),
    start: Number(itemStart),
    end: Number(itemEnd),
  }));
  const sentenceEditsChanged = update.sentenceEdits !== undefined
    && JSON.stringify(previousSentenceEdits) !== JSON.stringify(update.sentenceEdits);
  const renderNeedsReset = sentenceEditsChanged || trimChanged;
  if (renderNeedsReset) {
    if (['queued','processing'].includes(existing.renderStatus)) {
      return res.status(409).json({ error: 'Wait for the current render to finish before changing clip edits' });
    }
    existing.renderPath = undefined;
    existing.renderJobId = undefined;
    existing.renderStatus = 'idle';
    existing.renderProgress = 0;
    existing.renderError = undefined;
    if (existing.status === 'rendered') existing.status = 'approved';
  }
  Object.assign(existing, update); await existing.save();
  await Activity.create({ user: req.user.id, action: sentenceEditsChanged ? 'clip_sentences_edited' : update.status ? `clip_${update.status}` : update.assignedTo !== undefined ? 'clip_assigned' : 'clip_updated', entityType: 'Clip', entityId: existing.id, details: update });
  await existing.populate('assignedTo', 'name email role');
  res.json(publicClip(existing));
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

  const uploadSessions = await UploadSession.find({ podcast: podcast._id }).select('_id lockUntil');
  if (uploadSessions.some(session => session.lockUntil && session.lockUntil > new Date())) {
    return res.status(409).json({ error: 'A source upload is still active. Wait for it to finish before deleting this podcast.' });
  }
  for (const session of uploadSessions) {
    await fs.promises.rm(path.join(root, '.upload-sessions', `${session.id}.part`), { force: true });
  }
  await UploadSession.deleteMany({ podcast: podcast._id });

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
r.get('/:id/export-project', auth, wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const clips = await Clip.find({ podcast: podcast._id }).sort({ start: 1, createdAt: 1 });
  const format = String(req.query.format || 'xml').toLowerCase();
  if (!['xml', 'edl', 'json'].includes(format)) {
    return res.status(400).json({ error: 'Project export format must be xml, edl, or json' });
  }

  const source = (podcast.sourceFiles || []).find(file => file.kind === 'video')
    || (podcast.sourceFiles || []).find(file => file.kind === 'mix')
    || (podcast.sourceFiles || []).find(file => file.kind === 'audio')
    || (podcast.sourceFiles || []).find(file => file.path);
  if (!clips.length) return res.status(400).json({ error: 'No reel clips are available to export' });
  if (!source?.path) return res.status(400).json({ error: 'No source media is available for this project export' });

  const resolvedSource = path.resolve(source.path);
  const rootPrefix = path.resolve(root).endsWith(path.sep) ? path.resolve(root) : `${path.resolve(root)}${path.sep}`;
  if (!resolvedSource.startsWith(rootPrefix)) return res.status(403).json({ error: 'Invalid source media path' });
  const filenameBase = String(podcast.title || 'ClipFinder project').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'ClipFinder project';
  const fps = 30;
  const durationSeconds = clips.reduce((total, clip) => total + Math.max(0, Number(clip.end || 0) - Number(clip.start || 0)), 0);

  if (format === 'json') {
    const manifest = {
      name: podcast.title,
      fps,
      source: {
        name: source.originalName || path.basename(resolvedSource),
        path: resolvedSource,
      },
      clips: clips.map(clip => ({
        id: String(clip._id),
        title: clip.title || clip.hook || `Reel`,
        startSeconds: Number(clip.start || 0),
        endSeconds: Number(clip.end || 0),
        caption: clip.caption || '',
        cameraSegments: clip.cameraSegments || [],
        sentenceEdits: clip.sentenceEdits || [],
        renderSettings: clip.renderSettings || {},
      })),
    };
    res.attachment(`${filenameBase}-premiere-manifest.json`);
    res.type('application/json').send(JSON.stringify(manifest, null, 2));
    return;
  }

  if (format === 'edl') {
    let timelineStart = 0;
    const lines = [
      'TITLE: ' + filenameBase,
      'FCM: NON-DROP FRAME',
      '',
    ];
    clips.forEach((clip, index) => {
      const start = Number(clip.start || 0);
      const end = Number(clip.end || 0);
      const timelineEnd = timelineStart + Math.max(0, end - start);
      lines.push(
        `${String(index + 1).padStart(3, '0')}  AX       V     C        ${smpteTimecode(start, fps)} ${smpteTimecode(end, fps)} ${smpteTimecode(timelineStart, fps)} ${smpteTimecode(timelineEnd, fps)}`,
        `* FROM CLIP NAME: ${clip.title || clip.hook || `Reel ${index + 1}`}`,
        `* SOURCE FILE: ${source.originalName || path.basename(resolvedSource)}`,
      );
      timelineStart = timelineEnd;
    });
    res.attachment(`${filenameBase}.edl`);
    res.type('text/plain').send(lines.join('\n'));
    return;
  }

  const sourceName = source.originalName || path.basename(resolvedSource);
  const sourceFrames = frame(podcast.duration || durationSeconds, fps);
  let timelineFrames = 0;
  const clipItems = clips.map((clip, index) => {
    const inPoint = frame(clip.start, fps);
    const outPoint = frame(clip.end, fps);
    const start = timelineFrames;
    const duration = Math.max(1, outPoint - inPoint);
    timelineFrames += duration;
    return `
        <clipitem id="clipitem-${index + 1}">
          <name>${escapeXml(clip.title || clip.hook || `Reel ${index + 1}`)}</name>
          <duration>${duration}</duration>
          <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
          <in>${inPoint}</in>
          <out>${outPoint}</out>
          <start>${start}</start>
          <end>${start + duration}</end>
          <file id="file-1"/>
          <link><linkclipref>clipitem-${index + 1}</linkclipref><mediatype>video</mediatype><mediasubtype>2</mediasubtype></link>
        </clipitem>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <project>
    <name>${escapeXml(podcast.title || 'ClipFinder Project')}</name>
    <children>
      <sequence id="sequence-1">
        <name>${escapeXml(podcast.title || 'ClipFinder Sequence')}</name>
        <duration>${timelineFrames}</duration>
        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
        <media>
          <video>
            <format><samplecharacteristics><rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate><width>1080</width><height>1920</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>
            <track>${clipItems}
            </track>
          </video>
          <audio>
            <format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
            <track />
          </audio>
        </media>
      </sequence>
      <clip id="masterclip-1">
        <name>${escapeXml(sourceName)}</name>
        <duration>${sourceFrames}</duration>
        <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
        <media>
          <video><track><clipitem><file id="file-1">
            <name>${escapeXml(sourceName)}</name>
            <pathurl>${escapeXml(pathToFileURL(resolvedSource).href)}</pathurl>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <duration>${sourceFrames}</duration>
            <media><video><samplecharacteristics><width>1080</width><height>1920</height></samplecharacteristics></video></media>
          </file></clipitem></track></video>
        </media>
      </clip>
    </children>
  </project>
</xmeml>
`;
  res.attachment(`${filenameBase}-premiere.xml`);
  res.type('application/xml').send(xml);
}));
r.post('/clips/:clipId/render', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.clipId)) return res.status(400).json({ error: 'Invalid clip id' });
  const clip = await Clip.findById(req.params.clipId); if (!clip) return res.status(404).json({ error: 'Clip not found' });
  const podcast = await Podcast.findById(clip.podcast); if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  const aspectRatio = req.body?.aspectRatio ?? '9:16';
  if (!['9:16', '1:1', '16:9'].includes(aspectRatio)) return res.status(400).json({ error: 'Aspect ratio must be 9:16, 1:1, or 16:9' });
  const outputFormat = req.body?.outputFormat ?? 'mp4';
  if (!['mp4', 'mov'].includes(outputFormat)) return res.status(400).json({ error: 'Output format must be mp4 or mov' });
  const settings = {
    brandText: String(req.body?.brandText ?? '').trim().slice(0,80),
    fontName: String(req.body?.fontName || 'Arial').replace(/[^\w -]/g,'').slice(0,40),
    primaryColour: req.body?.primaryColour || '&H00FFFFFF',
    accentColour: req.body?.accentColour || '&H00419BC7',
    outlineColour: req.body?.outlineColour || '&H00000000',
    aspectRatio,
    outputFormat,
  };
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
  res.type(path.extname(resolved)).sendFile(resolved, err => { if (err && !res.headersSent) res.status(404).json({ error: 'Rendered file not found' }); });
}));
r.delete('/clips/:clipId/render', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.clipId)) return res.status(400).json({ error: 'Invalid clip id' });
  const clip = await Clip.findById(req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  if (['queued','processing'].includes(clip.renderStatus)) {
    return res.status(409).json({ error: 'Wait for rendering to finish before deleting this clip render' });
  }
  if (!clip.renderPath && !['failed','completed'].includes(clip.renderStatus)) {
    return res.status(404).json({ error: 'No render result to delete' });
  }

  const rootPath = path.resolve(root);
  let fileRemoved = false;
  if (clip.renderPath) {
    const resolved = path.resolve(clip.renderPath);
    if (!resolved.startsWith(`${rootPath}${path.sep}`)) return res.status(403).json({ error: 'Invalid render path' });
    try {
      const realRoot = await fs.promises.realpath(rootPath);
      const realRenderPath = await fs.promises.realpath(resolved);
      if (!realRenderPath.startsWith(`${realRoot}${path.sep}`)) {
        return res.status(403).json({ error: 'Invalid render path' });
      }
      const stat = await fs.promises.stat(realRenderPath);
      if (!stat.isFile()) return res.status(409).json({ error: 'Rendered media path is not a file' });
      await fs.promises.unlink(realRenderPath);
      fileRemoved = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  const renderVersion = clip.renderVersion;
  clip.renderPath = undefined;
  clip.renderJobId = undefined;
  clip.renderStatus = 'idle';
  clip.renderProgress = 0;
  clip.renderError = undefined;
  if (clip.status === 'rendered') clip.status = 'approved';
  await clip.save();
  await Activity.create({
    user: req.user.id,
    action: 'render_deleted',
    entityType: 'Clip',
    entityId: clip._id,
    details: { renderVersion, fileRemoved },
  });
  res.json({
    message: fileRemoved ? 'Rendered video deleted' : 'Failed render cleared',
    clip: publicClip(clip),
  });
}));
r.get('/:id/transcript', auth, wrap(async (req, res) => { if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' }); const p = await Podcast.findById(req.params.id).select('transcript segments language'); if (!p) return res.status(404).json({ error: 'Not found' }); res.json(p); }));
r.patch('/:id/transcript', auth, allow('admin','editor'), wrap(async (req, res) => {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'Invalid podcast id' });
  const podcast = await Podcast.findById(req.params.id);
  if (!podcast) return res.status(404).json({ error: 'Podcast not found' });
  if (['downloading','queued','processing'].includes(podcast.status)) {
    return res.status(409).json({ error: 'Wait for podcast processing to finish before editing the transcript' });
  }
  if (req.body?.transcript !== undefined && !Array.isArray(req.body?.segments)) {
    if (typeof req.body.transcript !== 'string' || req.body.transcript.length > 2_000_000) {
      return res.status(400).json({ error: 'Transcript text must be a string no longer than 2 MB' });
    }
    const transcript = req.body.transcript.trim();
    if (!transcript) return res.status(400).json({ error: 'Transcript text cannot be empty' });
    podcast.transcript = transcript;
    if (podcast.status === 'clips_ready') podcast.status = 'transcribed';
    podcast.jobMessage = 'Transcript edited. Regenerate clip suggestions to use the changes.';
    await podcast.save();
    await Activity.create({ user: req.user.id, action: 'transcript_text_edited', entityType: 'Podcast', entityId: podcast._id });
    return res.json(publicPodcast(podcast));
  }
  if (Array.isArray(req.body?.segments)) {
    const input = req.body.segments;
    if (!input.length || input.length > 10000) {
      return res.status(400).json({ error: 'Provide between 1 and 10,000 transcript lines' });
    }
    const segments = [];
    for (const item of input) {
      const start = Number(item?.start);
      const end = Number(item?.end);
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      const speaker = item?.speaker ?? null;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start
        || (podcast.duration && end > podcast.duration + 0.25)) {
        return res.status(400).json({ error: 'Transcript line timings must be within the source duration' });
      }
      if (!text || text.length > 4000) return res.status(400).json({ error: 'Transcript lines must contain 1–4,000 characters' });
      if (!(speaker === null || (typeof speaker === 'number' && Number.isFinite(speaker) && speaker >= 0)
        || (typeof speaker === 'string' && speaker.trim().length > 0 && speaker.length <= 80))) {
        return res.status(400).json({ error: 'Speaker must be a detected speaker label or null' });
      }
      segments.push({ start, end, text, speaker });
    }
    segments.sort((a, b) => a.start - b.start);
    podcast.segments = segments;
    podcast.transcript = segments.map(segment => segment.text).join(' ');
    if (podcast.status === 'clips_ready') podcast.status = 'transcribed';
    podcast.jobMessage = 'Transcript edited. Regenerate clip suggestions to use the changes.';
    await podcast.save();
    await Activity.create({
      user: req.user.id,
      action: 'transcript_edited',
      entityType: 'Podcast',
      entityId: podcast._id,
      details: { lineCount: segments.length }
    });
    return res.json(publicPodcast(podcast));
  }
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
