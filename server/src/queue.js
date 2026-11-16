import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: true
});
export const mediaQueue = new Queue('clipfinder-media', { connection, defaultJobOptions: { removeOnComplete: 200, removeOnFail: 500 } });
export const mediaJobCancellationKey = jobId => `clipfinder-media:cancel:${jobId}`;
export async function requestMediaJobCancellation(job) {
  let state = await job.getState();
  if (['waiting', 'delayed', 'paused'].includes(state)) {
    try {
      await job.remove();
      return 'cancelled';
    } catch (error) {
      state = await job.getState();
      if (state !== 'active') throw error;
    }
  }
  if (state === 'active') {
    // Active jobs stop cooperatively by checking this short-lived Redis flag.
    await connection.set(mediaJobCancellationKey(job.id), '1', 'EX', 3600);
    return 'cancelling';
  }
  return state;
}
export async function enqueueYoutubeTranscription(podcastId, userId, url) {
  return mediaQueue.add('transcribe-youtube', { podcastId, userId, url }, {
    attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200, removeOnFail: 500
  });
}
export async function enqueueTranscription(podcastId, userId) {
  return mediaQueue.add('transcribe-podcast', { podcastId, userId }, {
    attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200, removeOnFail: 500
  });
}
export async function enqueueClipSelection(podcastId, userId) {
  return mediaQueue.add('select-clips', { podcastId, userId }, {
    attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200, removeOnFail: 500
  });
}
export async function enqueueStorySelection(podcastId, userId) {
  return mediaQueue.add('select-stories', { podcastId, userId }, {
    attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200, removeOnFail: 500
  });
}
export async function enqueueOpusClipProject(podcastId, userId) {
  return mediaQueue.add('opusclip-generate', { podcastId, userId }, {
    attempts: 1, removeOnComplete: 200, removeOnFail: 500
  });
}
export async function enqueueOpusClipPoll(podcastId, userId, attempt = 0, delay = 20000) {
  return mediaQueue.add('opusclip-poll', { podcastId, userId, attempt }, {
    delay, attempts: 3, backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 200, removeOnFail: 500
  });
}
export async function enqueueRender(clipId, userId, settings = {}) {
  return mediaQueue.add('render-clip', { clipId, userId, settings }, {
    attempts: 2, backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 200, removeOnFail: 500
  });
}
