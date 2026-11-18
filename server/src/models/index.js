import mongoose from "mongoose";
const { Schema, model } = mongoose;
const UserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "editor", "viewer"],
      default: "editor",
    },
  },
  { timestamps: true },
);
const PodcastSchema = new Schema(
  {
    title: { type: String, required: true },
    description: String,
    folder: { type: String, default: "" },
    tags: { type: [String], default: [] },
    sourceUrl: String,
    sourceFiles: [
      {
        path: String,
        kind: String,
        speaker: String,
        originalName: String,
        size: Number,
      },
    ],
    audioPath: String,
    duration: Number,
    status: {
      type: String,
      enum: [
        "uploaded",
        "downloading",
        "queued",
        "processing",
        "transcribed",
        "clips_ready",
        "failed",
        "cancelled",
      ],
      default: "uploaded",
    },
    language: String,
    timingNote: String,
    transcript: String,
    deepgramTranscript: String,
    sarvamTranscript: String,
    sarvamSegments: [Schema.Types.Mixed],
    segments: [Schema.Types.Mixed],
    storyMoments: { type: [Schema.Types.Mixed], default: [] },
    storyMomentsStatus: {
      type: String,
      enum: ["idle", "queued", "processing", "completed", "failed", "cancelled"],
      default: "idle",
    },
    storyMomentsMessage: String,
    storyMomentsError: String,
    opusClipProjectId: String,
    opusClipOrgId: String,
    opusClipStatus: {
      type: String,
      enum: ["idle", "queued", "processing", "completed", "failed", "cancelled"],
      default: "idle",
    },
    opusClipMessage: String,
    opusClipError: String,
    opusClipOpenAiMoments: { type: [Schema.Types.Mixed], default: [] },
    opusClipClips: { type: [Schema.Types.Mixed], default: [] },
    jobId: String,
    jobType: String,
    jobProgress: { type: Number, default: 0 },
    jobMessage: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    error: String,
  },
  { timestamps: true },
);
const ClipSchema = new Schema(
  {
    podcast: { type: Schema.Types.ObjectId, ref: "Podcast", index: true },
    start: Number,
    end: Number,
    hook: String,
    title: String,
    caption: String,
    score: Number,
    reason: String,
    status: {
      type: String,
      enum: ["suggested", "approved", "rejected", "rendered", "published"],
      default: "suggested",
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    renderPath: String,
    renderVersion: { type: Number, default: 0 },
    renderSettings: Schema.Types.Mixed,
    renderJobId: String,
    renderStatus: {
      type: String,
      enum: ["idle", "queued", "processing", "completed", "failed"],
      default: "idle",
    },
    renderProgress: { type: Number, default: 0 },
    renderError: String,
    cameraSegments: [{ start: Number, end: Number, speaker: String }],
    captionSegments: [{ start: Number, end: Number, text: String }],
    editorNotes: String,
    performance: {
      views: { type: Number, min: 0 },
      watchTime: { type: Number, min: 0 },
    },
    createdByAI: { type: Boolean, default: true },
  },
  { timestamps: true },
);
const ActivitySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User" },
    action: String,
    entityType: String,
    entityId: Schema.Types.ObjectId,
    details: Schema.Types.Mixed,
  },
  { timestamps: true },
);
const UploadSessionSchema = new Schema(
  {
    podcast: {
      type: Schema.Types.ObjectId,
      ref: "Podcast",
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    originalName: { type: String, required: true },
    size: { type: Number, required: true },
    mimeType: { type: String, required: true },
    kind: { type: String, enum: ["video", "audio", "mix"], required: true },
    speaker: { type: String, default: "" },
    offset: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
UploadSessionSchema.index({ expiresAt: 1 });
export const User = model("User", UserSchema);
export const Podcast = model("Podcast", PodcastSchema);
export const Clip = model("Clip", ClipSchema);
export const Activity = model("Activity", ActivitySchema);
export const UploadSession = model("UploadSession", UploadSessionSchema);
