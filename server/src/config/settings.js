import "./env.js";
import path from "node:path";

function positiveInteger(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(
      `${name} must be a positive integer no greater than ${maximum}`,
    );
  }
  return value;
}

const ffmpegPath = () => process.env.FFMPEG_PATH || "ffmpeg";
function resolveFfprobePath(fallback) {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const configuredFfmpeg = ffmpegPath();
  return /[\\/]/.test(configuredFfmpeg)
    ? path.join(
        path.dirname(configuredFfmpeg),
        process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
      )
    : fallback;
}

export const config = Object.freeze({
  get adminEmail() {
    return process.env.ADMIN_EMAIL;
  },
  get adminName() {
    return process.env.ADMIN_NAME;
  },
  get adminPassword() {
    return process.env.ADMIN_PASSWORD;
  },
  get backupIntervalHours() {
    return positiveInteger("BACKUP_INTERVAL_HOURS", 24);
  },
  get backupRoot() {
    return path.resolve(process.env.BACKUP_ROOT || "./backups");
  },
  get corsOrigins() {
    return (process.env.CORS_ORIGIN || "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim());
  },
  get deepgramApiKey() {
    return process.env.DEEPGRAM_API_KEY;
  },
  get deepgramModel() {
    return process.env.DEEPGRAM_MODEL || "nova-3";
  },
  get ffmpegPath() {
    return ffmpegPath();
  },
  get ffmpegPreset() {
    return process.env.FFMPEG_PRESET || "veryfast";
  },
  get ffmpegVideoBitrate() {
    return process.env.FFMPEG_VIDEO_BITRATE || "8M";
  },
  get ffmpegVideoEncoder() {
    return (
      process.env.FFMPEG_VIDEO_ENCODER ||
      (process.platform === "darwin" ? "h264_videotoolbox" : "libx264")
    );
  },
  get ffprobePath() {
    return resolveFfprobePath("ffprobe");
  },
  get renderFfprobePath() {
    return resolveFfprobePath(
        process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
    );
  },
  get inviteCode() {
    return process.env.INVITE_CODE;
  },
  get jwtSecret() {
    return process.env.JWT_SECRET;
  },
  get llmApiKey() {
    return process.env.LLM_API_KEY;
  },
  get llmBaseUrl() {
    return process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  },
  get llmModel() {
    return process.env.LLM_MODEL || "gpt-6-astra";
  },
  get llmReasoningEffort() {
    return process.env.LLM_REASONING_EFFORT || "low";
  },
  get mediaRoot() {
    return path.resolve(process.env.MEDIA_ROOT || "./server/storage");
  },
  get mediaQueueName() {
    return process.env.MEDIA_QUEUE_NAME || `clipfinder-media-${process.platform}`;
  },
  get mongodbUri() {
    return process.env.MONGODB_URI;
  },
  get opusClipApiBaseUrl() {
    return process.env.OPUSCLIP_API_BASE_URL || "https://api.opus.pro/api";
  },
  get opusClipApiKey() {
    return process.env.OPUSCLIP_API_KEY;
  },
  get opusClipOrgId() {
    return process.env.OPUSCLIP_ORG_ID;
  },
  get port() {
    return positiveInteger("PORT", 5000, 65535);
  },
  get pythonPath() {
    return process.env.PYTHON_PATH || "python3";
  },
  get redisUrl() {
    return process.env.REDIS_URL || "redis://127.0.0.1:6379";
  },
  get sarvamApiKey() {
    return process.env.SARVAM_API_KEY;
  },
  get sarvamMode() {
    return process.env.SARVAM_MODE || "codemix";
  },
  get sttProvider() {
    return (process.env.STT_PROVIDER || "deepgram").toLowerCase();
  },
  get workerConcurrency() {
    return positiveInteger("WORKER_CONCURRENCY", 2);
  },
});

export { positiveInteger };
