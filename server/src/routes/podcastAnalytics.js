import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { Activity, Clip, Podcast, User } from "../models/index.js";
import { allow, auth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { config } from "../config/settings.js";

const router = Router();
const validId = (id) => mongoose.isValidObjectId(id);
const wrap = asyncHandler;

router.get(
  "/summary",
  auth,
  wrap(async (req, res) => {
    const [podcastCount, clipCount, approvedCount, aggregate] =
      await Promise.all([
        Podcast.countDocuments(),
        Clip.countDocuments({ createdByAI: true }),
        Clip.countDocuments({
          createdByAI: true,
          status: { $in: ["approved", "rendered", "published"] },
        }),
        Clip.aggregate([
          {
            $group: {
              _id: null,
              totalViews: {
                $sum: { $ifNull: ["$performance.views", 0] },
              },
              averageWatchTime: { $avg: "$performance.watchTime" },
            },
          },
        ]),
      ]);
    const metrics = aggregate[0] || {};
    res.json({
      podcastCount,
      clipCount,
      approvedCount,
      approvalRate: clipCount
        ? Math.round((approvedCount / clipCount) * 100)
        : 0,
      totalViews: metrics.totalViews || 0,
      averageWatchTime: Math.round(metrics.averageWatchTime || 0),
    });
  }),
);

router.get(
  "/backup-status",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    const statusPath = path.join(config.backupRoot, "backup-status.json");
    let status;
    try {
      status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return res.json({ status: "never_run", lastVerification: null });
      }
      throw error;
    }
    res.json({
      status: status.status || "unknown",
      createdAt: status.createdAt || null,
      failedAt: status.failedAt || null,
      backupFolder: status.backupFolder || null,
      databaseArchiveBytes: status.databaseArchiveBytes || null,
      mediaIncluded: Boolean(status.mediaIncluded),
      error: status.error || null,
      lastVerification: status.lastVerification || null,
      lastRestoreTest: status.lastRestoreTest || null,
    });
  }),
);

router.post(
  "/backup-restore-test",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    const backupFolder =
      typeof req.body?.backupFolder === "string" ? req.body.backupFolder : "";
    const notes =
      typeof req.body?.notes === "string"
        ? req.body.notes.trim().slice(0, 500)
        : "";
    if (req.body?.confirmed !== true || !backupFolder || !notes) {
      return res.status(400).json({
        error:
          "Confirm a completed restore drill and provide its backup folder and notes",
      });
    }
    const statusPath = path.join(config.backupRoot, "backup-status.json");
    let status;
    try {
      status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return res
          .status(404)
          .json({ error: "No backup status has been recorded" });
      }
      throw error;
    }
    if (status.backupFolder !== backupFolder) {
      return res.status(409).json({
        error: "The selected backup is not the latest completed backup",
      });
    }
    status.lastRestoreTest = {
      testedAt: new Date().toISOString(),
      backupFolder,
      notes,
      testedBy: String(req.user.id),
    };
    const temporaryPath = `${statusPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(status, null, 2), "utf8");
    await fs.rm(statusPath, { force: true });
    await fs.rename(temporaryPath, statusPath);
    try {
      await Activity.create({
        user: req.user.id,
        action: "backup_restore_test_recorded",
        entityType: "Backup",
        details: { backupFolder, notes },
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          operation: "record_restore_test_activity",
          message: error.message,
        }),
      );
    }
    res.json({
      message: "Restore drill recorded",
      lastRestoreTest: status.lastRestoreTest,
    });
  }),
);

router.get(
  "/learning-examples",
  auth,
  wrap(async (req, res) => {
    const examples = await Clip.find({
      status: { $in: ["approved", "rendered", "published"] },
      "performance.views": { $gt: 0 },
    })
      .sort({ "performance.views": -1, updatedAt: -1 })
      .limit(20)
      .select("title hook caption reason score performance status")
      .lean();
    res.json(examples);
  }),
);

router.get(
  "/activity",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    const events = await Activity.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("user", "name email")
      .lean();
    const idsFor = (entityType) => [
      ...new Set(
        events
          .filter(
            (event) =>
              event.entityType === entityType && validId(event.entityId),
          )
          .map((event) => String(event.entityId)),
      ),
    ];
    const [podcasts, clips, users] = await Promise.all([
      Podcast.find({ _id: { $in: idsFor("Podcast") } })
        .select("title")
        .lean(),
      Clip.find({ _id: { $in: idsFor("Clip") } })
        .select("title podcast")
        .lean(),
      User.find({ _id: { $in: idsFor("User") } })
        .select("name")
        .lean(),
    ]);
    const clipPodcastIds = [
      ...new Set(clips.map((clip) => String(clip.podcast)).filter(validId)),
    ];
    const clipPodcasts = await Podcast.find({
      _id: { $in: clipPodcastIds },
    })
      .select("title")
      .lean();
    const podcastTitles = new Map(
      [...podcasts, ...clipPodcasts].map((podcast) => [
        String(podcast._id),
        podcast.title,
      ]),
    );
    const clipTitles = new Map(
      clips.map((clip) => [String(clip._id), clip]),
    );
    const userNames = new Map(
      users.map((user) => [String(user._id), user.name]),
    );
    res.json(
      events.map((event) => {
        const details =
          event.details &&
          typeof event.details === "object" &&
          !Array.isArray(event.details)
            ? { ...event.details }
            : event.details;
        if (details && typeof details === "object") delete details.renderPath;
        const entityId = String(event.entityId || "");
        let location = event.entityType || "Workspace";
        if (event.entityType === "Podcast") {
          location = `Podcast${podcastTitles.has(entityId) ? ` / ${podcastTitles.get(entityId)}` : ""}`;
        } else if (event.entityType === "Clip") {
          const clip = clipTitles.get(entityId);
          const podcastTitle = clip
            ? podcastTitles.get(String(clip.podcast))
            : null;
          location = `${podcastTitle ? `Podcast / ${podcastTitle} / ` : ""}Clip${clip?.title ? ` / ${clip.title}` : ""}`;
        } else if (event.entityType === "User") {
          location = `Team${userNames.has(entityId) ? ` / ${userNames.get(entityId)}` : ""}`;
        } else if (event.entityType === "Backup") {
          location = "Backup and restore";
        }
        const podcastName =
          event.entityType === "Podcast"
            ? podcastTitles.get(entityId)
            : event.entityType === "Clip"
              ? podcastTitles.get(
                  String(clipTitles.get(entityId)?.podcast || ""),
                )
              : undefined;
        return { ...event, details, location, podcastName };
      }),
    );
  }),
);

router.delete(
  "/activity",
  auth,
  allow("admin"),
  wrap(async (req, res) => {
    const result = await Activity.deleteMany({});
    res.json({
      message: "Activity history cleared",
      deletedCount: result.deletedCount,
    });
  }),
);

export default router;
