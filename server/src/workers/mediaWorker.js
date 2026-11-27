import path from 'node:path';
import fs from 'node:fs/promises';
import { Worker } from 'bullmq';
import { connectDB } from '../config/db.js';
import { Podcast, Clip, Activity } from '../models/index.js';
import { connection, enqueueTranscription, enqueueOpusClipPoll, mediaJobCancellationKey, mediaQueueName, requestMediaJobCancellation } from '../queue.js';
import { transcribeLongAudio, transcribeYouTubeAudioStream } from '../services/deepgram.js';
import { selectClips } from '../services/clipSelector.js';
import { selectStories } from '../services/storySelector.js';
import { renderClip } from '../services/renderClip.js';
import { createOpusClipProject, getOpusClipProjectClips } from '../services/opusClip.js';
import { getYouTubeAudioUrl } from '../services/youtube.js';
import { spawn } from 'node:child_process';
import { config } from '../config/settings.js';

class JobCancelledError extends Error {
  constructor() {
    super('Processing cancelled by user');
    this.name = 'JobCancelledError';
    this.code = 'JOB_CANCELLED';
  }
}
function assertJobRunning(signal) {
  // Check cancellation between non-abortable steps as well as passing the signal to child processes.
  if (signal?.aborted) throw signal.reason || new JobCancelledError();
}
const run = (bin,args,signal) => new Promise((resolve,reject)=>{
  const p=spawn(bin,args,{stdio:['ignore','ignore','pipe'],...(signal ? {signal} : {})});let err='';
  p.stderr.on('data',d=>{err+=d.toString();if(err.length>10000)err=err.slice(-10000)});
  p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error(`${bin} exited ${c}: ${err}`)));
});


async function detectSpeakerTimeline(podcast, workDir, signal) {
  const micTracks = (podcast.sourceFiles || []).filter(f => f.kind === 'audio' && f.speaker);
  const cameraKeys = new Set((podcast.sourceFiles || []).filter(f => f.kind === 'video' && f.speaker).map(f => f.speaker));
  const usable = micTracks.filter(f => cameraKeys.has(f.speaker));
  // Speaker switching needs both a labeled mic and a matching camera for at least two people.
  if (usable.length < 2) return [];
  const wavDir = path.join(workDir, 'speaker-analysis');
  await fs.mkdir(wavDir, { recursive: true });
  const wavs = [];
  for (let i = 0; i < usable.length; i++) {
    const wav = path.join(wavDir, `mic-${i}.wav`);
    await run(config.ffmpegPath, ['-y','-i',usable[i].path,'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav], signal);
    wavs.push(wav);
  }
  const output = path.join(wavDir, 'speaker-timeline.json');
  const args = [path.resolve('worker/speaker_detection.py'), '--tracks', ...wavs, '--names', ...usable.map(f => f.speaker), '--window', '1', '--out', output];
  await run(config.pythonPath, args, signal);
  return JSON.parse(await fs.readFile(output, 'utf8'));
}
function cameraSegmentsForClip(timeline, clip) {
  return timeline.filter(s => s.speaker !== 'UNKNOWN' && s.end > clip.start && s.start < clip.end)
    .map(s => ({ start: Math.max(0, s.start - clip.start), end: Math.min(clip.end, s.end) - clip.start, speaker: s.speaker }))
    .filter(s => s.end > s.start);
}

async function generateClipSuggestions({ podcast, job, transcript, duration, segments, workDir, action, language, signal }) {
  assertJobRunning(signal);
  await updatePodcastProgress(podcast, job, 'processing', 75, 'Transcript ready; selecting clips', signal);
  const examples=await Clip.find({status:{ $in:['approved','rendered'] }})
    .sort({'performance.views':-1,updatedAt:-1})
    .limit(20)
    .select('title hook caption reason performance')
    .lean();
  let selected;
  let selectionError;
  try {
    selected=await selectClips(transcript,duration,examples,segments,signal);
    assertJobRunning(signal);
  } catch (error) {
    assertJobRunning(signal);
    // Keep the completed transcript usable even when the optional AI clip-selection call fails.
    selectionError=error;
    selected={clips:[],warning:`AI reel suggestions failed: ${error.message}`};
    console.error('AI reel suggestion request failed; transcript remains available:', error.message);
  }
  if(selected.clips?.length){
    let speakerTimeline=[];
    try { speakerTimeline=await detectSpeakerTimeline(podcast,workDir,signal); }
    catch (e) {
      assertJobRunning(signal);
      console.warn('Automatic speaker camera detection skipped:',e.message);
    }
    assertJobRunning(signal);
    await Clip.deleteMany({podcast:podcast._id,status:'suggested'});
    await Clip.insertMany(selected.clips.map(c=>({...c,cameraSegments:cameraSegmentsForClip(speakerTimeline,c),podcast:podcast._id})));
  }
  const finalStatus=selected.clips?.length?'clips_ready':'transcribed';
  const finalMessage=selectionError
    ? `Transcript saved; reel suggestions failed: ${selectionError.message}`
    : selected.warning || (selected.clips?.length ? 'Clip suggestions ready for review' : 'Transcript saved, but no valid clip suggestions were returned');
  assertJobRunning(signal);
  const podcastUpdate={
    $set: { status: finalStatus, jobId: job.id, jobType: job.name, jobProgress: 100, jobMessage: finalMessage }
  };
  if(selectionError) podcastUpdate.$set.error=finalMessage.slice(0,2000);
  else podcastUpdate.$unset={error:1};
  await Podcast.findByIdAndUpdate(podcast._id, podcastUpdate);
  await job.updateProgress({ percent: 100, message: finalMessage });
  await Activity.create({
    user:job.data.userId,
    action,
    entityType:'Podcast',
    entityId:podcast._id,
    details:{language:language||podcast.language,segments:segments.length,clipCount:selected.clips?.length||0}
  });
  return { podcastId: podcast.id, clipCount: selected.clips?.length||0 };
}

async function updatePodcastProgress(podcast, job, status, progress, message, signal) {
  assertJobRunning(signal);
  await Podcast.findByIdAndUpdate(podcast._id, {
    $set: { status, jobId: job.id, jobType: job.name, jobProgress: progress, jobMessage: message }
  });
  await job.updateProgress({ percent: progress, message });
}

await connectDB();
async function processMediaJob(job, signal) {
  assertJobRunning(signal);
  if (job.name === 'import-youtube' || job.name === 'transcribe-youtube') {
    const podcast = await Podcast.findById(job.data.podcastId);
    if (!podcast) throw new Error('Podcast not found');
    await Podcast.findByIdAndUpdate(podcast._id, { $unset: { error: 1 } });
    await updatePodcastProgress(podcast, job, 'processing', 5, 'Resolving YouTube audio stream', signal);
    const audioUrl = await getYouTubeAudioUrl(job.data.url, signal);
    assertJobRunning(signal);
    await updatePodcastProgress(podcast, job, 'processing', 15, 'Checking the YouTube audio stream', signal);
    const result = await transcribeYouTubeAudioStream(audioUrl, signal, ({ progress, message }) => (
      updatePodcastProgress(podcast, job, 'processing', progress, message, signal)
    ));
    assertJobRunning(signal);
    if (!result.transcript) throw new Error(`${result.providers.join(' and ')} returned an empty transcript`);
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: {
        transcript: result.transcript,
        deepgramTranscript: result.deepgramTranscript,
        sarvamTranscript: result.sarvamTranscript,
        sarvamSegments: result.sarvamSegments,
        segments: result.segments,
        duration: result.duration,
        language: result.language,
        timingNote: result.timingNote,
        status: 'transcribed',
        jobId: job.id,
        jobType: job.name,
        jobProgress: 100,
        jobMessage: 'Transcript complete; the source video is downloaded when rendering a clip'
      },
      $unset: { error: 1 }
    });
    await Activity.create({
      user: job.data.userId,
      action: 'youtube_transcription_completed',
      entityType: 'Podcast',
      entityId: podcast._id,
      details: { language: result.language, segments: result.segments.length, providers: result.providers }
    });
    await job.updateProgress({ percent: 100, message: 'YouTube transcript complete' });
    return { podcastId: podcast.id, providers: result.providers };
  }
  if (job.name === 'select-clips') {
    const podcast = await Podcast.findById(job.data.podcastId);
    if (!podcast) throw new Error('Podcast not found');
    if (!podcast.transcript || !podcast.duration) throw new Error('Podcast needs a saved transcript before clip suggestions can be generated');
    const workDir=podcast.sourceFiles?.[0]?.path
      ? path.dirname(podcast.sourceFiles[0].path)
      : path.join(config.mediaRoot,podcast.id);
    await Podcast.findByIdAndUpdate(podcast._id,{ $unset:{error:1} });
    await updatePodcastProgress(podcast,job,'processing',10,'Generating AI reel suggestions from saved transcript',signal);
    return generateClipSuggestions({
      podcast,
      job,
      transcript:podcast.transcript,
      duration:podcast.duration,
      segments:podcast.segments||[],
      workDir,
      action:'clip_suggestions_generated',
      language:podcast.language,
      signal
    });
  }
  if (job.name === 'select-stories') {
    const podcast = await Podcast.findById(job.data.podcastId);
    if (!podcast) throw new Error('Podcast not found');
    if (!podcast.transcript || !podcast.duration) throw new Error('Podcast needs a saved transcript before story selection');
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: { storyMomentsStatus: 'processing', storyMomentsMessage: 'Finding story moments', storyMomentsJobId: job.id },
      $unset: { storyMomentsError: 1 }
    });
    const selected = await selectStories(podcast.transcript, podcast.duration, podcast.segments || [], signal);
    assertJobRunning(signal);
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: {
        storyMoments: selected.stories,
        storyMomentsStatus: 'completed',
        storyMomentsMessage: `${selected.stories.length} story moments ready`
      },
      $unset: { storyMomentsError: 1, storyMomentsJobId: 1 }
    });
    await Activity.create({
      user: job.data.userId,
      action: 'story_moments_generated',
      entityType: 'Podcast',
      entityId: podcast._id,
      details: { storyCount: selected.stories.length }
    });
    return { podcastId: podcast.id, storyCount: selected.stories.length };
  }
  if (job.name === 'transcribe-podcast') {
    const podcast = await Podcast.findById(job.data.podcastId);
    if (!podcast) throw new Error('Podcast not found');
    await Podcast.findByIdAndUpdate(podcast._id, { $unset: { error: 1 } });
    await updatePodcastProgress(podcast, job, 'processing', 5, 'Preparing audio', signal);
    const audio = podcast.sourceFiles.find(f=>f.kind==='mix') || podcast.sourceFiles.find(f=>f.kind==='video') || podcast.sourceFiles.find(f=>f.kind==='audio') || podcast.sourceFiles[0];
    if (!audio) throw new Error('Podcast has no source audio');
    let audioPath = audio.path;
    if (audio.kind !== 'audio') {
      await updatePodcastProgress(podcast, job, 'processing', 10, 'Extracting audio from source media', signal);
      audioPath = path.join(path.dirname(audio.path),'worker-audio.mp3');
      await run(config.ffmpegPath,['-y','-i',audio.path,'-vn','-ac','1','-ar','16000','-b:a','64k',audioPath],signal);
    }
    await updatePodcastProgress(podcast, job, 'processing', 15, 'Preparing audio chunks for transcription', signal);
    const result = await transcribeLongAudio(
      audioPath,
      path.dirname(audio.path),
      signal,
      ({ progress, message }) => updatePodcastProgress(podcast, job, 'processing', progress, message, signal),
    );
    assertJobRunning(signal);
    const transcriptionMessage = 'Transcription complete. Generate reel suggestions when ready.';
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: {
        transcript: result.transcript,
        deepgramTranscript: result.deepgramTranscript,
        sarvamTranscript: result.sarvamTranscript,
        sarvamSegments: result.sarvamSegments,
        segments: result.segments,
        duration: result.duration,
        language: result.language,
        timingNote: result.timingNote,
        status: 'transcribed',
        jobId: job.id,
        jobType: job.name,
        jobProgress: 100,
        jobMessage: transcriptionMessage,
        storyMoments: [],
        storyMomentsStatus: 'idle',
        storyMomentsMessage: 'Click Find story moments to generate story cards.',
      },
      $unset: { storyMomentsError: 1, storyMomentsJobId: 1 }
    });
    await job.updateProgress({ percent: 100, message: transcriptionMessage });
    await Activity.create({
      user: job.data.userId,
      action: 'transcription_completed',
      entityType: 'Podcast',
      entityId: podcast._id,
      details: { language: result.language, segments: result.segments.length }
    });
    return { podcastId: podcast.id };
  }
  if (job.name === 'opusclip-generate') {
    const podcast = await Podcast.findById(job.data.podcastId);
    if (!podcast) throw new Error('Podcast not found');
    if (!podcast.transcript || !podcast.duration) throw new Error('Transcribe the podcast before combined reel generation');
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: { opusClipStatus: 'processing', opusClipMessage: 'Preparing reel moments for OpusClip', opusClipJobId: job.id },
      $unset: { opusClipError: 1 }
    });

    let openAiMoments = (podcast.opusClipOpenAiMoments || [])
      .map(moment => ({
        start: Number(moment.start),
        end: Number(moment.end),
        title: moment.title || '',
        hook: moment.hook || '',
        reason: moment.reason || ''
      }))
      .filter(moment => Number.isFinite(moment.start) && Number.isFinite(moment.end) && moment.end > moment.start)
      .slice(0, 8);

    if (!openAiMoments.length) {
      let moments = await Clip.find({
        podcast: podcast._id,
        status: { $in: ['suggested', 'approved', 'rendered', 'published'] }
      })
        .sort({ score: -1, updatedAt: -1 })
        .limit(8)
        .select('start end title hook caption reason')
        .lean();

      if (!moments.length) {
        const examples = await Clip.find({
          podcast: { $ne: podcast._id },
          status: { $in: ['approved', 'rendered', 'published'] }
        })
          .sort({ 'performance.views': -1, updatedAt: -1 })
          .limit(20)
          .select('title hook caption reason performance')
          .lean();
        const selection = await selectClips(podcast.transcript, podcast.duration, examples, podcast.segments || [], signal);
        assertJobRunning(signal);
        if (!selection.clips?.length) {
          throw new Error(selection.warning || 'No reel moments were selected for OpusClip');
        }
        moments = selection.clips.slice(0, 8);
        await Clip.insertMany(moments.map(moment => ({ ...moment, podcast: podcast._id })));
        assertJobRunning(signal);
      }

      openAiMoments = moments.map(moment => ({
        start: Number(moment.start),
        end: Number(moment.end),
        title: moment.title || '',
        hook: moment.hook || '',
        reason: moment.reason || moment.caption || ''
      }));
    }
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: {
        opusClipOpenAiMoments: openAiMoments,
        opusClipMessage: 'Sending selected moments to OpusClip'
      }
    });

    assertJobRunning(signal);
    const project = await createOpusClipProject(podcast, openAiMoments, signal);
    assertJobRunning(signal);
    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: {
        opusClipProjectId: project.projectId,
        opusClipOrgId: project.orgId,
        opusClipStatus: 'processing',
        opusClipMessage: 'OpusClip is generating your reels'
      }
    });
    const pollJob = await enqueueOpusClipPoll(podcast.id, job.data.userId);
    await Podcast.findByIdAndUpdate(podcast._id, { $set: { opusClipJobId: pollJob.id } });
    try {
      assertJobRunning(signal);
    } catch (error) {
      await requestMediaJobCancellation(pollJob);
      throw error;
    }
    return { podcastId: podcast.id, opusClipProjectId: project.projectId };
  }
  if (job.name === 'opusclip-poll') {
    const podcast = await Podcast.findById(job.data.podcastId);
    if (!podcast) throw new Error('Podcast not found');
    if (!podcast.opusClipProjectId) throw new Error('OpusClip project ID is missing');
    const clips = await getOpusClipProjectClips(podcast.opusClipProjectId, podcast.opusClipOrgId, signal);
    assertJobRunning(signal);
    if (clips.length) {
      await Podcast.findByIdAndUpdate(podcast._id, {
        $set: {
          opusClipClips: clips,
          opusClipStatus: 'completed',
          opusClipMessage: `${clips.length} OpusClip reels ready`,
          opusClipError: null
        },
        $unset: { opusClipJobId: 1 }
      });
      await Activity.create({
        user: job.data.userId,
        action: 'opusclip_reels_generated',
        entityType: 'Podcast',
        entityId: podcast._id,
        details: { opusClipProjectId: podcast.opusClipProjectId, clipCount: clips.length }
      });
      await job.updateProgress({ percent: 100, message: 'OpusClip reels ready' });
      return { podcastId: podcast.id, clipCount: clips.length };
    }

    const attempt = Number(job.data.attempt) || 0;
    if (attempt >= 45) {
      const message = 'OpusClip did not return any reels after 15 minutes';
      await Podcast.findByIdAndUpdate(podcast._id, {
        $set: { opusClipStatus: 'failed', opusClipMessage: message, opusClipError: message },
        $unset: { opusClipJobId: 1 }
      });
      return { podcastId: podcast.id, clipCount: 0, timedOut: true };
    }

    await Podcast.findByIdAndUpdate(podcast._id, {
      $set: { opusClipStatus: 'processing', opusClipMessage: 'OpusClip is generating reels' }
    });
    const pollJob = await enqueueOpusClipPoll(podcast.id, job.data.userId, attempt + 1);
    await Podcast.findByIdAndUpdate(podcast._id, { $set: { opusClipJobId: pollJob.id } });
    try {
      assertJobRunning(signal);
    } catch (error) {
      await requestMediaJobCancellation(pollJob);
      throw error;
    }
    await job.updateProgress({ percent: Math.min(95, Math.round((attempt / 45) * 100)), message: 'Waiting for OpusClip reels' });
    return { podcastId: podcast.id, pending: true };
  }
  if (job.name === 'render-clip') {
    const clip=await Clip.findById(job.data.clipId);
    if(!clip) throw new Error('Clip not found');
    const podcast=await Podcast.findById(clip.podcast);
    if(!podcast) throw new Error('Podcast not found');
    clip.renderJobId=job.id;
    clip.renderStatus='processing';
    clip.renderProgress=0;
    clip.renderError=undefined;
    await clip.save();
    await job.updateProgress({ percent: 0, message: 'Preparing video render' });
    const reportRenderProgress = async percent => {
      const progress = Math.min(99, Math.max(0, Math.floor(percent)));
      if (progress <= clip.renderProgress) return;
      clip.renderProgress = progress;
      await Clip.updateOne(
        { _id: clip._id, renderJobId: job.id, renderStatus: 'processing' },
        { $set: { renderProgress: progress } },
      );
      await job.updateProgress({ percent: progress, message: `Rendering clip · ${progress}%` });
    };
    const result=await renderClip({
      clip,
      podcast,
      settings:job.data.settings||{},
      signal,
      onProgress:reportRenderProgress,
    });
    clip.renderPath=result.output;
    clip.renderVersion=(clip.renderVersion||0)+1;
    clip.renderSettings=job.data.settings||{};
    clip.renderStatus='completed';
    clip.renderProgress=100;
    clip.renderError=undefined;
    await clip.save();
    await job.updateProgress({ percent: 100, message: 'Render ready to preview or download' });
    await Activity.create({user:job.data.userId,action:'clip_rendered',entityType:'Clip',entityId:clip._id,details:{renderPath:result.output,renderVersion:clip.renderVersion,cameraSwitches:result.cameraSwitches}});
    return {clipId:clip.id,renderVersion:clip.renderVersion};
  }
  throw new Error(`Unknown job type: ${job.name}`);
}

const worker = new Worker(mediaQueueName, async job => {
  const controller = new AbortController();
  const cancelKey = mediaJobCancellationKey(job.id);
  let checkingCancellation = false;
  const cancellationPoll = setInterval(() => {
    if (checkingCancellation) return;
    checkingCancellation = true;
    connection.get(cancelKey)
      .then(requested => {
        if (requested && !controller.signal.aborted) controller.abort(new JobCancelledError());
      })
      .catch(error => console.error(`Could not check cancellation for job ${job.id}:`, error))
      .finally(() => { checkingCancellation = false; });
  }, 500);
  cancellationPoll.unref();
  try {
    if (await connection.get(cancelKey)) controller.abort(new JobCancelledError());
    return await processMediaJob(job, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      await job.discard();
      throw controller.signal.reason || new JobCancelledError();
    }
    throw error;
  } finally {
    clearInterval(cancellationPoll);
    await connection.del(cancelKey).catch(error => console.error(`Could not clear cancellation for job ${job.id}:`, error));
  }
},{connection,concurrency:config.workerConcurrency,lockDuration:1000*60*15});
worker.on('completed',job=>console.log(`Job ${job.id} (${job.name}) completed`));
worker.on('failed', async (job, err) => {
  console.error(`Job ${job?.id} (${job?.name}) failed:`, err.message);
  try {
    if (err?.code === 'JOB_CANCELLED' && ['transcribe-podcast','import-youtube','transcribe-youtube','select-clips'].includes(job?.name)) {
      await Podcast.findByIdAndUpdate(job.data.podcastId, {
        $set: {
          status: 'cancelled',
          jobId: job.id,
          jobType: job.name,
          jobMessage: 'Processing cancelled'
        },
        $unset: { error: 1 }
      });
      return;
    }
    if (err?.code === 'JOB_CANCELLED' && job?.name === 'select-stories') {
      await Podcast.findByIdAndUpdate(job.data.podcastId, {
        $set: { storyMomentsStatus: 'cancelled', storyMomentsMessage: 'Story finding stopped' },
        $unset: { storyMomentsJobId: 1 }
      });
      return;
    }
    if (err?.code === 'JOB_CANCELLED' && ['opusclip-generate','opusclip-poll'].includes(job?.name)) {
      await Podcast.findByIdAndUpdate(job.data.podcastId, {
        $set: { opusClipStatus: 'cancelled', opusClipMessage: 'Reel generation stopped' },
        $unset: { opusClipJobId: 1 }
      });
      return;
    }
    if (job?.name === 'transcribe-podcast' || job?.name === 'import-youtube' || job?.name === 'transcribe-youtube' || job?.name === 'select-clips') {
      const retrying = job.attemptsMade < (job.opts.attempts || 1);
      const update = {
        $set: {
          status: retrying ? 'processing' : job.name === 'select-clips' ? 'transcribed' : 'failed',
          jobId: job.id,
          jobType: job.name,
          jobMessage: retrying ? `Retrying after error: ${err.message.slice(0, 450)}` : err.message.slice(0, 500)
        }
      };
      if (retrying) update.$unset = { error: 1 };
      else update.$set.error = err.message.slice(0, 2000);
      await Podcast.findByIdAndUpdate(job.data.podcastId, update);
    }
    if (job?.name === 'select-stories') {
      const retrying = job.attemptsMade < (job.opts.attempts || 1);
      if (!retrying) {
        await Podcast.findByIdAndUpdate(job.data.podcastId, {
          $set: {
            storyMomentsStatus: 'failed',
            storyMomentsMessage: 'Story selection failed',
            storyMomentsError: 'Story selection failed. Please retry or contact an administrator.'
          },
          $unset: { storyMomentsJobId: 1 }
        });
      }
    }
    if (job?.name === 'opusclip-generate' || job?.name === 'opusclip-poll') {
      const retrying = job.attemptsMade < (job.opts.attempts || 1);
      if (!retrying) {
        await Podcast.findByIdAndUpdate(job.data.podcastId, {
          $set: {
            opusClipStatus: 'failed',
            opusClipError: err.message.slice(0, 2000),
            opusClipMessage: 'OpusClip reel generation failed'
          },
          $unset: { opusClipJobId: 1 }
        });
      }
    }
    if (job?.name === 'render-clip') {
      const retrying = job.attemptsMade < (job.opts.attempts || 1);
      await Clip.findByIdAndUpdate(job.data.clipId, {
        renderStatus: retrying ? 'processing' : 'failed',
        ...(retrying ? {} : { renderError: err.message.slice(0, 2000) })
      });
    }
    const retrying = job && job.attemptsMade < (job.opts.attempts || 1);
    if (job?.data?.userId && !retrying) {
      const entityType = job.name === 'render-clip' ? 'Clip' : 'Podcast';
      const entityId = entityType === 'Clip' ? job.data.clipId : job.data.podcastId;
      const clip = entityType === 'Clip' ? await Clip.findById(entityId).select('title podcast').lean() : null;
      const podcast = await Podcast.findById(entityType === 'Clip' ? clip?.podcast : entityId).select('title').lean();
      await Activity.create({
        user: job.data.userId,
        action: 'background_job_failed',
        entityType,
        entityId,
        details: {
          jobName: job.name,
          jobId: job.id,
          message: `${podcast?.title || clip?.title || 'Project'}: ${err.message.slice(0, 350)}`,
        },
      });
    }
  } catch (updateError) {
    console.error(JSON.stringify({ level: 'error', jobId: job?.id, error: 'Could not persist failed job status', message: updateError.message }));
  }
});
worker.on('error', err => console.error('BullMQ worker error:', err));
const shutdown = async signal => { console.log(`Received ${signal}; closing worker`); await worker.close(); await connection.quit(); process.exit(0); };
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
console.log('ClipFinder BullMQ media worker started');
