import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import {
  formatClipMetadataCsv,
  formatStoryMetadataCsv,
  formatStoryMetadataText,
  formatTranscriptForExport,
  formatTranscriptJson,
  formatTranscriptSrt,
  formatTranscriptTimestamp,
  formatTranscriptVtt,
  getTranscriptLines,
  getTranscriptLinesInRange,
} from "../utils/transcript.js";
import {
  BrandIntroScreen,
  LoginScreen,
  WelcomeScreen,
  WorkspaceHeader,
  WorkspaceSidebar,
} from "../components/AppChrome.jsx";
import { isPodcastJobActive } from "../components/PodcastJobProgress.jsx";
import { isSupportedExportFormat } from "../components/TranscriptPanel.jsx";
import DashboardPage from "./DashboardPage.jsx";
import PodcastDetailPage from "./PodcastDetailPage.jsx";
import TeamPage from "./TeamPage.jsx";

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function transcriptFilename(title) {
  return (
    String(title || "transcript")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim() || "transcript"
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Attach the saved session token to every API request in one place.
const api = axios.create({ baseURL: "/api" });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cf_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("cf_token"));
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem("cf_theme");
    return savedTheme === "light" ? "light" : "dark";
  });
  const [showWelcome, setShowWelcome] = useState(false);
  const [showBrandIntro, setShowBrandIntro] = useState(
    () => !localStorage.getItem("cf_token"),
  );
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState(() => {
    const savedPage = sessionStorage.getItem("cf_workspace_page");
    const savedPodcastId = sessionStorage.getItem("cf_selected_podcast_id");
    if (savedPage === "detail" && savedPodcastId) return "detail";
    return ["dashboard", "team"].includes(savedPage) ? savedPage : "dashboard";
  });
  const [savedPodcastId] = useState(
    () => sessionStorage.getItem("cf_selected_podcast_id") || "",
  );
  const [restoringPodcast, setRestoringPodcast] = useState(() =>
    Boolean(token && page === "detail" && savedPodcastId),
  );
  const [restorePodcastError, setRestorePodcastError] = useState("");
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [podcasts, setPodcasts] = useState([]);
  const [podcastsLoaded, setPodcastsLoaded] = useState(false);
  const [podcastsLoadError, setPodcastsLoadError] = useState("");
  const [selectedPodcastIds, setSelectedPodcastIds] = useState([]);
  const [podcastSearch, setPodcastSearch] = useState("");
  const [podcastStatusFilter, setPodcastStatusFilter] = useState("all");
  const [podcastDateFrom, setPodcastDateFrom] = useState("");
  const [podcastDateTo, setPodcastDateTo] = useState("");
  const [projectFolder, setProjectFolder] = useState("");
  const [projectTags, setProjectTags] = useState("");
  const [folderFilter, setFolderFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [openTranscriptFor, setOpenTranscriptFor] = useState(null);
  const [clips, setClips] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [backupStatus, setBackupStatus] = useState(null);
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
    role: "editor",
  });
  const [editingUser, setEditingUser] = useState(null);
  const [title, setTitle] = useState("");
  const [files, setFiles] = useState([]);
  const [uploadLimits, setUploadLimits] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [extraFiles, setExtraFiles] = useState([]);
  const [sourceKind, setSourceKind] = useState("video");
  const [speakerKey, setSpeakerKey] = useState("");
  const [exportFormat, setExportFormat] = useState("pdf");
  const [busy, setBusy] = useState(false);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [assignees, setAssignees] = useState([]);
  const [previewSource, setPreviewSource] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [retryingNotificationIds, setRetryingNotificationIds] = useState(
    () => new Set(),
  );
  const notificationCursor = useRef(
    new Date(Date.now() - 60_000).toISOString(),
  );
  const seenNotificationIds = useRef(new Set());
  const [metricsLoading, setMetricsLoading] = useState(
    Boolean(localStorage.getItem("cf_token")),
  );
  const [error, setError] = useState("");
  const [loginError, setLoginError] = useState("");
  const canDeletePodcasts = ["admin", "editor"].includes(currentUser?.role);
  const filteredPodcasts = podcasts.filter((podcast) => {
    const search = podcastSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      [podcast.title, ...(podcast.tags || [])].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(search),
      );
    const matchesStatus =
      podcastStatusFilter === "all" || podcast.status === podcastStatusFilter;
    const matchesFolder =
      folderFilter === "all" || (podcast.folder || "") === folderFilter;
    const createdAt = new Date(podcast.createdAt);
    const matchesDateFrom =
      !podcastDateFrom ||
      (Number.isFinite(createdAt.getTime()) &&
        createdAt >= new Date(`${podcastDateFrom}T00:00:00`));
    const dateToExclusive = podcastDateTo
      ? new Date(`${podcastDateTo}T00:00:00`)
      : null;
    if (dateToExclusive) dateToExclusive.setDate(dateToExclusive.getDate() + 1);
    const matchesDateTo =
      !dateToExclusive ||
      (Number.isFinite(createdAt.getTime()) && createdAt < dateToExclusive);
    return (
      matchesSearch &&
      matchesStatus &&
      matchesFolder &&
      matchesDateFrom &&
      matchesDateTo
    );
  });
  const folderOptions = [
    ...new Set(podcasts.map((podcast) => podcast.folder).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));
  const allPodcastsSelected =
    filteredPodcasts.length > 0 &&
    filteredPodcasts.every((podcast) =>
      selectedPodcastIds.includes(podcast._id),
    );

  useEffect(() => {
    localStorage.setItem("cf_theme", theme);
  }, [theme]);

  useEffect(() => {
    sessionStorage.setItem("cf_workspace_page", page);
    if (page === "detail") {
      if (selected?._id)
        sessionStorage.setItem("cf_selected_podcast_id", selected._id);
    } else {
      sessionStorage.removeItem("cf_selected_podcast_id");
    }
  }, [page, selected?._id]);

  useEffect(() => {
    if (!showWelcome) return undefined;
    const timer = setTimeout(() => setShowWelcome(false), 1500);
    return () => clearTimeout(timer);
  }, [showWelcome]);

  useEffect(() => {
    if (token || !showBrandIntro) return undefined;
    const timer = setTimeout(() => setShowBrandIntro(false), 1600);
    return () => clearTimeout(timer);
  }, [token, showBrandIntro]);

  async function load() {
    try {
      const nextPodcasts = (await api.get("/podcasts")).data;
      setPodcasts(nextPodcasts);
      setPodcastsLoadError("");
    } catch (e) {
      setPodcastsLoadError(
        e.response?.data?.error ||
          "The podcast list is temporarily unavailable.",
      );
    } finally {
      setPodcastsLoaded(true);
    }
  }

  useEffect(() => {
    if (!token) return;
    load();
    api
      .get("/auth/me")
      .then(({ data }) => setCurrentUser(data))
      .catch((e) => {
        setError(
          e.response?.data?.error || "Could not load the signed-in user",
        );
      });
  }, [token]);

  useEffect(() => {
    if (!token || page !== "detail" || selected?._id || !savedPodcastId)
      return undefined;
    let active = true;
    setRestoringPodcast(true);
    setRestorePodcastError("");
    Promise.all([
      api.get(`/podcasts/${savedPodcastId}`),
      api.get(`/podcasts/${savedPodcastId}/clips`),
    ])
      .then(([detail, podcastClips]) => {
        if (!active) return;
        setSelected(detail.data);
        setClips(podcastClips.data);
      })
      .catch((e) => {
        if (!active) return;
        setRestorePodcastError(
          e.response?.data?.error ||
            "Could not restore this podcast workspace.",
        );
      })
      .finally(() => {
        if (active) setRestoringPodcast(false);
      });
    return () => {
      active = false;
    };
  }, [token, page, selected?._id, savedPodcastId, restoreAttempt]);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    api
      .get("/podcasts/upload-limits")
      .then(({ data }) => {
        if (active) setUploadLimits(data);
      })
      .catch((e) => {
        if (active)
          setError(e.response?.data?.error || "Could not load upload limits");
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !currentUser) return undefined;
    if (currentUser.role === "viewer") {
      setAssignees([]);
      return undefined;
    }
    let active = true;
    api
      .get("/auth/assignable-users")
      .then(({ data }) => {
        if (active) setAssignees(data);
      })
      .catch((e) => {
        if (active)
          setError(
            e.response?.data?.error || "Could not load assignable editors",
          );
      });
    return () => {
      active = false;
    };
  }, [token, currentUser?.role]);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    const pollNotifications = async () => {
      try {
        const since = new Date(
          Date.parse(notificationCursor.current) - 60_000,
        ).toISOString();
        const { data } = await api.get("/podcasts/notifications", {
          params: { since },
        });
        if (!active) return;
        const fresh = data.filter(
          (notification) => !seenNotificationIds.current.has(notification.id),
        );
        if (fresh.length) {
          fresh.forEach((notification) =>
            seenNotificationIds.current.add(notification.id),
          );
          if (seenNotificationIds.current.size > 500) {
            seenNotificationIds.current = new Set(
              [...seenNotificationIds.current].slice(-250),
            );
          }
          notificationCursor.current = data.reduce(
            (latest, notification) =>
              notification.createdAt > latest ? notification.createdAt : latest,
            notificationCursor.current,
          );
          setNotifications((current) => [...fresh, ...current].slice(0, 30));
        }
      } catch (e) {
        if (active)
          setError(
            e.response?.data?.error ||
              "Could not load background job notifications",
          );
      }
    };
    pollNotifications();
    const timer = setInterval(pollNotifications, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [token]);

  async function loadMetrics() {
    setMetricsLoading(true);
    try {
      const { data } = await api.get("/podcasts/analytics/summary");
      setMetrics(data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load production metrics");
    } finally {
      setMetricsLoading(false);
    }
  }

  async function refreshDashboard() {
    setError("");
    if (podcastsLoadError) {
      setPodcastsLoadError("");
      setPodcastsLoaded(false);
    }
    await Promise.all([load(), loadMetrics()]);
  }

  function togglePodcastSelection(id) {
    setSelectedPodcastIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id],
    );
  }

  function toggleSelectAllPodcasts() {
    const visibleIds = filteredPodcasts.map((podcast) => podcast._id);
    setSelectedPodcastIds((current) =>
      allPodcastsSelected
        ? current.filter((id) => !visibleIds.includes(id))
        : [...new Set([...current, ...visibleIds])],
    );
  }

  async function deleteSelectedPodcasts() {
    const ids = podcasts
      .filter((podcast) => selectedPodcastIds.includes(podcast._id))
      .map((podcast) => podcast._id);
    if (
      !ids.length ||
      !window.confirm(
        `Permanently delete ${ids.length} selected podcast${ids.length === 1 ? "" : "s"}, including clips, activity history, and media files?`,
      )
    )
      return;

    setBusy(true);
    const deletedIds = [];
    try {
      for (const id of ids) {
        await api.delete(`/podcasts/${id}`);
        deletedIds.push(id);
      }
      setError(
        `${deletedIds.length} podcast history item${deletedIds.length === 1 ? "" : "s"} deleted.`,
      );
    } catch (e) {
      setError(
        e.response?.data?.error ||
          `Deleted ${deletedIds.length} of ${ids.length} selected items; the remaining items could not be deleted.`,
      );
    } finally {
      if (deletedIds.length) {
        setPodcasts((current) =>
          current.filter((podcast) => !deletedIds.includes(podcast._id)),
        );
        setSelectedPodcastIds((current) =>
          current.filter((id) => !deletedIds.includes(id)),
        );
        if (selected && deletedIds.includes(selected._id)) {
          setSelected(null);
          setClips([]);
        }
        await loadMetrics();
      }
      setBusy(false);
    }
  }

  async function stopPodcastJob(podcastId) {
    setBusy(true);
    try {
      const { data } = await api.post(`/podcasts/${podcastId}/cancel`);
      setError(data.message || "Stop requested.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || "Could not stop podcast processing");
    } finally {
      setBusy(false);
    }
  }

  async function stopGeneration(podcastId, generation) {
    setBusy(true);
    try {
      const { data } = await api.post(
        `/podcasts/${podcastId}/cancel-generation`,
        { generation },
      );
      setError(data.message || "Stop requested.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || "Could not stop generation");
    } finally {
      setBusy(false);
    }
  }

  async function restartPodcastJob(podcastId) {
    setBusy(true);
    try {
      const { data } = await api.post(`/podcasts/${podcastId}/restart`);
      setError(data.message || "Podcast processing restarted.");
      await refresh();
    } catch (e) {
      setError(
        e.response?.data?.error || "Could not restart podcast processing",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadTeam() {
    try {
      const [userResult, activityResult] = await Promise.all([
        api.get("/auth/users"),
        api.get("/podcasts/analytics/activity"),
      ]);
      setUsers(userResult.data);
      setActivity(activityResult.data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load team and audit log");
      return;
    }
    try {
      setBackupStatus(
        (await api.get("/podcasts/analytics/backup-status")).data,
      );
    } catch (e) {
      setError(e.response?.data?.error || "Could not load backup status");
    }
  }

  async function clearActivity() {
    if (
      !window.confirm(
        "Permanently clear all activity history? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    try {
      const { data } = await api.delete("/podcasts/analytics/activity");
      setActivity([]);
      setError(
        data.message || `Cleared ${data.deletedCount} activity records.`,
      );
    } catch (e) {
      setError(e.response?.data?.error || "Could not clear activity history");
    } finally {
      setBusy(false);
    }
  }

  async function recordRestoreTest(backupFolder) {
    const notes = window.prompt(
      "Only continue after a successful restore drill. Record the test database or validation notes:",
    );
    if (!notes?.trim()) return;
    try {
      const { data } = await api.post(
        "/podcasts/analytics/backup-restore-test",
        {
          confirmed: true,
          backupFolder,
          notes: notes.trim(),
        },
      );
      setBackupStatus((current) => ({
        ...current,
        lastRestoreTest: data.lastRestoreTest,
      }));
      setError(data.message || "Restore drill recorded.");
    } catch (e) {
      setError(e.response?.data?.error || "Could not record restore drill");
    }
  }

  async function retryNotification(notificationId) {
    setRetryingNotificationIds((current) =>
      new Set(current).add(notificationId),
    );
    try {
      const { data } = await api.post(
        `/podcasts/notifications/${notificationId}/retry`,
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                retryable: false,
                message: `${notification.message} · Retry queued`,
              }
            : notification,
        ),
      );
      setError(data.message || "Job retry queued.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || "Could not retry this job");
    } finally {
      setRetryingNotificationIds((current) => {
        const next = new Set(current);
        next.delete(notificationId);
        return next;
      });
    }
  }

  useEffect(() => {
    if (token && page === "dashboard") loadMetrics();
    if (token && page === "team" && currentUser?.role === "admin") loadTeam();
  }, [token, page, currentUser?.role]);

  useEffect(() => {
    if (page === "team" && currentUser && currentUser.role !== "admin")
      setPage("dashboard");
  }, [page, currentUser]);

  const hasActivePodcastJobs = podcasts.some((podcast) =>
    isPodcastJobActive(podcast.status),
  );
  useEffect(() => {
    if (!token || page !== "dashboard" || !hasActivePodcastJobs) return;
    // Poll only while visible dashboard jobs are active, then stop the timer.
    const timer = setInterval(() => load(), 2500);
    return () => clearInterval(timer);
  }, [token, page, hasActivePodcastJobs]);

  const hasRenderJobs = clips.some((clip) =>
    ["queued", "processing"].includes(clip.renderStatus),
  );
  const hasOpusClipJob = ["queued", "processing"].includes(
    selected?.opusClipStatus,
  );
  const transcriptLines = getTranscriptLines(selected?.segments);
  const transcriptVisible = Boolean(
    selected?._id && openTranscriptFor === selected._id,
  );
  const hasTranscript = Boolean(selected?.transcript || transcriptLines.length);
  const hasStoryMomentJob = ["queued", "processing"].includes(
    selected?.storyMomentsStatus,
  );
  const selectedExportFormat = isSupportedExportFormat(exportFormat)
    ? exportFormat
    : "pdf";
  useEffect(() => {
    const hasPodcastJob = isPodcastJobActive(selected?.status);
    if (
      !token ||
      page !== "detail" ||
      !selected?._id ||
      (!hasPodcastJob &&
        !hasRenderJobs &&
        !hasOpusClipJob &&
        !hasStoryMomentJob)
    )
      return;
    const timer = setInterval(() => {
      refresh().catch((e) =>
        setError(e.response?.data?.error || "Could not refresh job status"),
      );
    }, 2500);
    return () => clearInterval(timer);
  }, [
    token,
    page,
    selected?._id,
    selected?.status,
    selected?.jobProgress,
    hasRenderJobs,
    hasOpusClipJob,
    hasStoryMomentJob,
  ]);

  useEffect(() => {
    if (youtubeUrl.trim()) setFiles([]);
  }, [youtubeUrl]);

  async function login(e) {
    e.preventDefault();
    try {
      const data = (
        await api.post("/auth/login", {
          email: e.target.email.value,
          password: e.target.password.value,
        })
      ).data;
      localStorage.setItem("cf_token", data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      setShowWelcome(true);
      setNotifications([]);
      notificationCursor.current = new Date(Date.now() - 60_000).toISOString();
      seenNotificationIds.current = new Set();
      setPodcastsLoaded(false);
      setPodcasts([]);
      setError("");
      setLoginError("");
      setNotifications([]);
      notificationCursor.current = new Date().toISOString();
      seenNotificationIds.current = new Set();
      closeSourcePreview();
    } catch (e) {
      setLoginError(e.response?.data?.error || "Login failed");
    }
  }

  async function create() {
    const uploadError = youtubeUrl.trim() ? "" : validateUpload(files);
    if (uploadError) {
      setError(uploadError);
      return;
    }
    setBusy(true);
    setUploadProgress(null);
    let podcast;
    let uploadCompleted = false;
    try {
      if (youtubeUrl.trim()) {
        const result = (
          await api.post("/podcasts/youtube", {
            title,
            url: youtubeUrl.trim(),
            folder: projectFolder,
            tags: projectTags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          })
        ).data;
        podcast = result.podcast;
        setError(
          "YouTube transcription queued. Media will not be saved locally.",
        );
      } else {
        podcast = (
          await api.post("/podcasts", {
            title,
            folder: projectFolder,
            tags: projectTags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          })
        ).data;
        podcast = await uploadResumableFiles(
          podcast._id,
          files,
          sourceKind,
          speakerKey,
        );
        uploadCompleted = true;
        const { data: job } = await api.post(
          `/podcasts/${podcast._id}/transcribe`,
        );
        podcast = {
          ...podcast,
          status: "queued",
          jobId: job.jobId,
          jobType: "transcribe-podcast",
          jobProgress: 0,
          jobMessage: "Waiting for a worker to transcribe the audio",
        };
        setError("Upload complete. Transcription started automatically.");
      }

      setTitle("");
      setProjectFolder("");
      setProjectTags("");
      setFiles([]);
      setYoutubeUrl("");
      setUploadProgress(null);
      await load();
      setSelected(podcast);
      setPage("detail");
    } catch (e) {
      setUploadProgress(null);
      if (podcast && uploadCompleted) {
        await load();
        setSelected(podcast);
        setPage("detail");
        setError(
          `Upload complete, but transcription could not be started: ${e.response?.data?.error || e.message}`,
        );
      } else if (podcast && !youtubeUrl.trim()) {
        await load();
        setError(
          `${e.response?.data?.error || e.message}. Project was created; open it and reselect the same file to resume.`,
        );
      } else {
        setError(e.response?.data?.error || e.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function uploadResumableFiles(podcastId, selectedFiles, kind, speaker) {
    const uploads = [...selectedFiles];
    const totalBytes = uploads.reduce((total, file) => total + file.size, 0);
    let completedBytes = 0;
    for (const file of uploads) {
      const { data: session } = await api.post(
        `/podcasts/${podcastId}/uploads`,
        {
          name: file.name,
          size: file.size,
          mimeType:
            file.type || (kind === "video" ? "video/mp4" : "audio/mpeg"),
          kind,
          speaker,
        },
      );
      if (session.complete) {
        completedBytes += file.size;
        setUploadProgress({
          fileName: file.name,
          loaded: completedBytes,
          total: totalBytes,
        });
        continue;
      }
      let offset = session.offset;
      setUploadProgress({
        fileName: file.name,
        loaded: completedBytes + offset,
        total: totalBytes,
      });
      while (offset < file.size) {
        const end = Math.min(file.size, offset + session.chunkBytes);
        const chunk = file.slice(offset, end);
        let chunkSaved = false;
        let lastError;
        for (let attempt = 0; attempt < 6 && !chunkSaved; attempt += 1) {
          try {
            const result = await api.patch(
              `/podcasts/${podcastId}/uploads/${session.uploadId}`,
              chunk,
              {
                headers: {
                  "Content-Type": "application/octet-stream",
                  "Upload-Offset": String(offset),
                },
              },
            );
            offset = result.data.offset;
            chunkSaved = true;
          } catch (error) {
            lastError = error;
            if (
              error.response &&
              error.response.status !== 409 &&
              error.response.status < 500
            )
              throw error;
            const status = await api.get(
              `/podcasts/${podcastId}/uploads/${session.uploadId}`,
            );
            if (status.data.offset > offset) {
              offset = status.data.offset;
              chunkSaved = true;
            } else if (attempt < 5) {
              await new Promise((resolve) =>
                setTimeout(resolve, 750 * (attempt + 1)),
              );
            }
          }
        }
        if (!chunkSaved)
          throw lastError || new Error("Upload chunk could not be saved");
        setUploadProgress({
          fileName: file.name,
          loaded: completedBytes + offset,
          total: totalBytes,
        });
      }
      await api.post(
        `/podcasts/${podcastId}/uploads/${session.uploadId}/complete`,
      );
      completedBytes += file.size;
    }
    return (await api.get(`/podcasts/${podcastId}`)).data;
  }

  async function open(podcast) {
    closeSourcePreview();
    setPage("detail");
    setSelected(podcast);
    setError("");
    try {
      const [detail, podcastClips] = await Promise.all([
        api.get(`/podcasts/${podcast._id}`),
        api.get(`/podcasts/${podcast._id}/clips`),
      ]);
      setSelected(detail.data);
      setClips(podcastClips.data);
    } catch (e) {
      setError(e.response?.data?.error || "Could not load podcast details");
    }
  }

  async function uploadMore() {
    if (!extraFiles.length) return;
    const uploadError = validateUpload(extraFiles);
    if (uploadError) {
      setError(uploadError);
      return;
    }
    setBusy(true);
    setUploadProgress(null);
    try {
      await uploadResumableFiles(
        selected._id,
        extraFiles,
        sourceKind,
        speakerKey,
      );
      setExtraFiles([]);
      await refresh();
      setUploadProgress(null);
      setError("Source tracks uploaded. Use the speaker key in Camera plan.");
    } catch (e) {
      setUploadProgress(null);
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  function validateUpload(selectedFiles) {
    if (!uploadLimits) return "";
    if (selectedFiles.length > uploadLimits.maxFiles) {
      return `Select no more than ${uploadLimits.maxFiles} files at a time.`;
    }
    const maxFileBytes =
      uploadLimits.maxResumableFileBytes || uploadLimits.maxFileBytes;
    const oversizedFile = [...selectedFiles].find(
      (file) => file.size > maxFileBytes,
    );
    return oversizedFile
      ? `${oversizedFile.name} exceeds the ${Math.ceil(maxFileBytes / 1024 ** 3)} GiB per-file limit.`
      : "";
  }

  async function transcribe() {
    setBusy(true);
    try {
      await api.post(`/podcasts/${selected._id}/transcribe`);
      setError("Transcription job accepted. Refresh after processing.");
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportTranscript() {
    if (!selected || !hasTranscript) return;
    const normalizedFormat = isSupportedExportFormat(exportFormat)
      ? exportFormat
      : "pdf";
    const filename = transcriptFilename(selected.title);
    const lines = getTranscriptLines(selected.segments);
    const rows = lines.length
      ? lines.map((line) => ({
          start: `${formatTranscriptTimestamp(line.start)} - ${formatTranscriptTimestamp(line.end)}`,
          text: line.text,
        }))
      : [{ start: "", text: selected.transcript || "" }];

    try {
      if (normalizedFormat === "json") {
        downloadBlob(
          new Blob(
            [
              formatTranscriptJson(
                selected.title,
                selected.transcript,
                selected.segments,
              ),
            ],
            { type: "application/json;charset=utf-8" },
          ),
          `${filename}-transcript.json`,
        );
        return;
      }

      if (normalizedFormat === "txt") {
        downloadBlob(
          new Blob(
            [
              `\uFEFF${formatTranscriptForExport(selected.transcript, selected.segments)}`,
            ],
            { type: "text/plain;charset=utf-8" },
          ),
          `${filename}-transcript.txt`,
        );
        return;
      }

      if (normalizedFormat === "srt" || normalizedFormat === "vtt") {
        const content =
          normalizedFormat === "srt"
            ? formatTranscriptSrt(selected.segments)
            : formatTranscriptVtt(selected.segments);
        downloadBlob(
          new Blob([content], { type: "text/plain;charset=utf-8" }),
          `${filename}-transcript.${normalizedFormat}`,
        );
        return;
      }

      if (normalizedFormat === "docx") {
        const paragraphs = [
          new Paragraph({
            text: selected.title || "Transcript",
            heading: HeadingLevel.TITLE,
          }),
          ...rows.map(
            (row) =>
              new Paragraph({
                children: [
                  ...(row.start
                    ? [new TextRun({ text: `[${row.start}] `, bold: true })]
                    : []),
                  new TextRun(row.text),
                ],
              }),
          ),
        ];
        const blob = await Packer.toBlob(
          new Document({ sections: [{ children: paragraphs }] }),
        );
        downloadBlob(blob, `${filename}-transcript.docx`);
        return;
      }

      const printWindow = window.open("", "_blank");
      if (!printWindow)
        throw new Error("Allow pop-ups to export the transcript as PDF.");
      // Transcript text is inserted into HTML for printing, so escape it before writing.
      const printRows = rows
        .map(
          (row) => `
        <p>${row.start ? `<strong>[${escapeHtml(row.start)}]</strong> ` : ""}${escapeHtml(row.text)}</p>
      `,
        )
        .join("");
      printWindow.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(selected.title || "Transcript")}</title><style>body{font:12pt Arial,sans-serif;color:#111;margin:24mm}h1{font-size:18pt}p{line-height:1.5;white-space:pre-wrap;break-inside:avoid}@media print{body{margin:18mm}}</style></head><body><h1>${escapeHtml(selected.title || "Transcript")}</h1>${printRows}</body></html>`,
      );
      printWindow.document.close();
      printWindow.onafterprint = () => printWindow.close();
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 300);
    } catch (e) {
      setError(e.message || "Could not export transcript");
    }
  }

  async function saveTranscript(payload, { silent = false } = {}) {
    setSavingTranscript(true);
    try {
      const { data } = await api.patch(
        `/podcasts/${selected._id}/transcript`,
        payload,
      );
      setSelected(data);
      setPodcasts((items) =>
        items.map((item) =>
          item._id === data._id
            ? { ...item, status: data.status, jobMessage: data.jobMessage }
            : item,
        ),
      );
      if (!silent)
        setError(
          "Transcript saved. Regenerate clip suggestions to apply the edits.",
        );
      return true;
    } catch (e) {
      setError(e.response?.data?.error || "Could not save transcript");
      return false;
    } finally {
      setSavingTranscript(false);
    }
  }

  function exportClipMetadata() {
    downloadBlob(
      new Blob([formatClipMetadataCsv(clips)], {
        type: "text/csv;charset=utf-8",
      }),
      `${transcriptFilename(selected?.title)}-clips.csv`,
    );
  }

  async function exportStoryMetadata(format = "pdf") {
    const stories = (selected?.storyMoments || []).map((story) => ({
      ...story,
      script: getTranscriptLinesInRange(
        selected?.segments,
        story.start,
        story.end,
      )
        .map(
          (line) =>
            `[${formatTranscriptTimestamp(line.start)} - ${formatTranscriptTimestamp(line.end)}] ${line.text}`,
        )
        .join("\n"),
    }));
    if (!stories.length) return;
    const normalizedFormat = ["pdf", "docx", "txt", "csv"].includes(format)
      ? format
      : "pdf";
    const filename = `${transcriptFilename(selected?.title)}-stories`;
    const rows = stories.map((story, index) => ({
      title: `${index + 1}. ${story.title || "Untitled story"}`,
      time: `${formatTranscriptTimestamp(Number(story.start))} - ${formatTranscriptTimestamp(Number(story.end))}`,
    }));

    try {
      if (normalizedFormat === "csv") {
        downloadBlob(
          new Blob([formatStoryMetadataCsv(stories)], {
            type: "text/csv;charset=utf-8",
          }),
          `${filename}.csv`,
        );
        return;
      }

      if (normalizedFormat === "txt") {
        downloadBlob(
          new Blob([`\uFEFF${formatStoryMetadataText(stories)}`], {
            type: "text/plain;charset=utf-8",
          }),
          `${filename}.txt`,
        );
        return;
      }

      if (normalizedFormat === "docx") {
        const paragraphs = [
          new Paragraph({
            text: selected?.title || "Story moments",
            heading: HeadingLevel.TITLE,
          }),
          ...stories.flatMap((story, index) => [
            new Paragraph({
              text: rows[index].title,
              heading: HeadingLevel.HEADING_1,
            }),
            new Paragraph({
              children: [new TextRun({ text: rows[index].time, bold: true })],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: "Summary: ", bold: true }),
                new TextRun(String(story.summary || "")),
              ],
            }),
            ...(story.excerpt
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Excerpt: ", bold: true }),
                      new TextRun(String(story.excerpt)),
                    ],
                  }),
                ]
              : []),
            new Paragraph({
              children: [
                new TextRun({ text: "Exact transcript:", bold: true }),
              ],
            }),
            ...String(story.script || "Unavailable for this time range.")
              .split("\n")
              .map((line) => new Paragraph({ text: line })),
            ...(story.reason
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({ text: "Why it stands out: ", bold: true }),
                      new TextRun(String(story.reason)),
                    ],
                  }),
                ]
              : []),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Score: ${String(story.score ?? "")}/10`,
                  bold: true,
                }),
              ],
            }),
          ]),
        ];
        const blob = await Packer.toBlob(
          new Document({ sections: [{ children: paragraphs }] }),
        );
        downloadBlob(blob, `${filename}.docx`);
        return;
      }

      const printWindow = window.open("", "_blank");
      if (!printWindow)
        throw new Error("Allow pop-ups to export stories as PDF.");
      const printRows = stories
        .map(
          (story, index) => `
        <article>
          <h2>${escapeHtml(rows[index].title)}</h2>
          <p><strong>${escapeHtml(rows[index].time)}</strong></p>
          <p><strong>Summary:</strong> ${escapeHtml(story.summary || "")}</p>
          ${story.excerpt ? `<p><strong>Excerpt:</strong> ${escapeHtml(story.excerpt)}</p>` : ""}
          <p><strong>Exact transcript:</strong></p>
          <pre>${escapeHtml(story.script || "Unavailable for this time range.")}</pre>
          ${story.reason ? `<p><strong>Why it stands out:</strong> ${escapeHtml(story.reason)}</p>` : ""}
          <p><strong>Score:</strong> ${escapeHtml(story.score ?? "")}/10</p>
        </article>
      `,
        )
        .join("");
      printWindow.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(selected?.title || "Story moments")}</title><style>body{font:12pt Arial,sans-serif;color:#111;margin:24mm}h1{font-size:20pt}h2{font-size:15pt;margin:0 0 8px}article{margin:0 0 22px;break-inside:avoid}p{line-height:1.5;margin:6px 0;white-space:pre-wrap}pre{font:inherit;line-height:1.5;white-space:pre-wrap;margin:6px 0 12px}@media print{body{margin:18mm}}</style></head><body><h1>${escapeHtml(selected?.title || "Story moments")}</h1>${printRows}</body></html>`,
      );
      printWindow.document.close();
      printWindow.onafterprint = () => printWindow.close();
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 300);
    } catch (e) {
      setError(e.message || "Could not export stories");
    }
  }

  async function generateOpusClips(storyIndexes) {
    setBusy(true);
    try {
      const { data } = await api.post(`/podcasts/${selected._id}/opusclip`, {
        ...(Array.isArray(storyIndexes) ? { storyIndexes } : {}),
      });
      setError(data.message || "Reel generation queued.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateStories() {
    setBusy(true);
    try {
      const { data } = await api.post(
        `/podcasts/${selected._id}/select-stories`,
      );
      setError(data.message || "Story selection queued.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function generateClipSuggestions() {
    setBusy(true);
    try {
      const { data } = await api.post(
        `/podcasts/${selected._id}/select-clips`,
      );
      setError(data.message || "Reel suggestions queued.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    await load();
    if (selected) {
      const podcast = (await api.get(`/podcasts/${selected._id}`)).data;
      setSelected(podcast);
      const nextClips = (await api.get(`/podcasts/${selected._id}/clips`)).data;
      setClips(nextClips);
    }
  }

  async function updateClip(id, patch) {
    try {
      const clip = (await api.patch(`/podcasts/clips/${id}`, patch)).data;
      setClips((old) => old.map((item) => (item._id === id ? clip : item)));
      return true;
    } catch (e) {
      setError(e.response?.data?.error || "Could not save clip changes");
      return false;
    }
  }

  async function updatePodcastMetadata(podcast, patch) {
    try {
      const { data } = await api.patch(`/podcasts/${podcast._id}`, patch);
      setPodcasts((items) =>
        items.map((item) => (item._id === data._id ? data : item)),
      );
      setSelected((current) =>
        current?._id === data._id ? { ...current, ...data } : current,
      );
    } catch (e) {
      setError(
        e.response?.data?.error || "Could not save project organization",
      );
    }
  }

  async function renderClip(id, aspectRatio = "9:16") {
    setBusy(true);
    try {
      await api.post(`/podcasts/clips/${id}/render`, { aspectRatio });
      setError("Render queued. Progress will update here.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function previewSourceClip(clip) {
    if (
      !selected?._id ||
      !selected.sourceFiles?.some((file) => file.kind === "video")
    )
      return;
    try {
      const { data } = await api.post(
        `/podcasts/${selected._id}/source-preview`,
      );
      setPreviewSource({
        url: data.url,
        start: clip.start,
        end: clip.end,
        title: clip.title || "Clip preview",
      });
    } catch (e) {
      setError(e.response?.data?.error || "Source preview unavailable");
    }
  }

  function closeSourcePreview() {
    setPreviewSource(null);
  }

  async function previewClip(id) {
    try {
      const response = await api.get(`/podcasts/clips/${id}/render`, {
        responseType: "blob",
      });
      return URL.createObjectURL(response.data);
    } catch (e) {
      setError(e.response?.data?.error || "Rendered preview unavailable");
      return null;
    }
  }

  async function downloadClip(id) {
    try {
      const response = await api.get(`/podcasts/clips/${id}/render`, {
        responseType: "blob",
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `clip-${id}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.response?.data?.error || "Rendered download unavailable");
    }
  }

  async function deleteRenderedClip(id) {
    if (
      !window.confirm(
        "Remove this render from the workspace? The reel suggestion will remain, and any saved rendered video will be deleted.",
      )
    )
      return;
    setBusy(true);
    try {
      const { data } = await api.delete(`/podcasts/clips/${id}/render`);
      setError(data.message || "Rendered video deleted.");
      await refresh();
    } catch (e) {
      setError(
        e.response?.data?.error || "Rendered video could not be deleted",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createUser(e) {
    e.preventDefault();
    try {
      await api.post("/auth/users", newUser);
      setNewUser({ name: "", email: "", password: "", role: "editor" });
      setError("Team member created.");
      await loadTeam();
    } catch (e) {
      setError(e.response?.data?.error || "Could not create team member");
    }
  }

  function startEditingUser(user) {
    setEditingUser({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      password: "",
    });
  }

  async function updateUser(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch(`/auth/users/${editingUser.id}`, {
        name: editingUser.name,
        email: editingUser.email,
        role: editingUser.role,
        password: editingUser.password,
      });
      if (String(data.id) === String(currentUser?.id)) {
        setCurrentUser((user) => ({ ...user, ...data }));
      }
      setEditingUser(null);
      setError("Account updated.");
      await loadTeam();
    } catch (e) {
      setError(e.response?.data?.error || "Could not update account");
    } finally {
      setBusy(false);
    }
  }

  async function editCameraPlan(clip) {
    const current = JSON.stringify(clip.cameraSegments || [], null, 2);
    const raw = window.prompt(
      "Camera plan JSON (clip-relative seconds; speaker must match an uploaded source track):",
      current,
    );
    if (raw === null) return;
    try {
      await updateClip(clip._id, { cameraSegments: JSON.parse(raw) });
    } catch (e) {
      setError("Invalid camera plan JSON: " + e.message);
    }
  }

  if (!token) {
    if (showBrandIntro) return <BrandIntroScreen theme={theme} />;
    return (
      <LoginScreen
        theme={theme}
        onToggleTheme={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        onLogin={login}
        error={loginError}
      />
    );
  }

  return (
    <div
      className={`app${showWelcome ? " is-welcoming" : ""}`}
      data-theme={theme}
    >
      {showWelcome && <WelcomeScreen name={currentUser?.name} />}
      <WorkspaceSidebar
        page={page}
        user={currentUser}
        onNavigate={(nextPage) => {
          setPage(nextPage);
          setError("");
        }}
        onSignOut={() => {
          localStorage.removeItem("cf_token");
          setToken(null);
          setCurrentUser(null);
          setShowWelcome(false);
          setShowBrandIntro(true);
          setPage("dashboard");
          setError("");
          setLoginError("");
        }}
      />
      <main className="main">
        <WorkspaceHeader
          page={page}
          title={
            page === "detail"
              ? selected?.title
              : page === "team"
                ? "Team and audit log"
                : "Podcast workspace"
          }
          theme={theme}
          onToggleTheme={() =>
            setTheme((current) => (current === "dark" ? "light" : "dark"))
          }
          onRefresh={
            page === "team"
              ? loadTeam
              : page === "dashboard"
                ? refreshDashboard
                : refresh
          }
          notifications={notifications}
          onClearNotifications={() => setNotifications([])}
          onRetryNotification={retryNotification}
          retryingNotificationIds={retryingNotificationIds}
        />
        {error && (
          <div className="notice" role="status" aria-live="polite">
            <span>{error}</span>
            <button
              type="button"
              className="notice-dismiss"
              onClick={() => setError("")}
              aria-label="Dismiss message"
            >
              Dismiss
            </button>
          </div>
        )}
        {page === "team" && currentUser?.role === "admin" ? (
          <TeamPage
            data={{
              users,
              activity,
              backupStatus,
              newUser,
              editingUser,
              busy,
              currentUser,
            }}
            actions={{
              setNewUser,
              createUser,
              setEditingUser,
              updateUser,
              startEditingUser,
              recordRestoreTest,
              clearActivity,
            }}
          />
        ) : page === "dashboard" ? (
          <DashboardPage
            data={{
              metrics,
              metricsLoading,
              title,
              youtubeUrl,
              sourceKind,
              speakerKey,
              files,
              uploadLimits,
              uploadProgress,
              busy,
              podcasts,
              filteredPodcasts,
              podcastSearch,
              podcastStatusFilter,
              podcastDateFrom,
              podcastDateTo,
              projectFolder,
              projectTags,
              folderFilter,
              folderOptions,
              allPodcastsSelected,
              selectedPodcastIds,
              canDeletePodcasts,
              podcastsLoaded,
              podcastsLoadFailed: Boolean(podcastsLoadError),
              podcastsLoadError,
            }}
            actions={{
              setPodcastSearch,
              setPodcastStatusFilter,
              setPodcastDateFrom,
              setPodcastDateTo,
              setProjectFolder,
              setProjectTags,
              setFolderFilter,
              refreshDashboard,
              setTitle,
              setYoutubeUrl,
              setSourceKind,
              setSpeakerKey,
              setFiles,
              create,
              toggleSelectAllPodcasts,
              deleteSelectedPodcasts,
              open,
              updatePodcastMetadata,
              togglePodcastSelection,
              stopPodcastJob,
              restartPodcastJob,
            }}
          />
        ) : page === "detail" && !selected ? (
          <section
            className="empty-state workspace-restore-state"
            role="status"
            aria-live="polite"
          >
            <h3>
              {restorePodcastError
                ? "Could not reopen podcast"
                : "Restoring podcast workspace…"}
            </h3>
            {restorePodcastError && (
              <p className="muted">{restorePodcastError}</p>
            )}
            {restorePodcastError && (
              <div className="workspace-restore-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRestoreAttempt((attempt) => attempt + 1)}
                >
                  Retry
                </button>
                <button type="button" onClick={() => setPage("dashboard")}>
                  Back to podcasts
                </button>
              </div>
            )}
          </section>
        ) : page === "detail" ? (
          <PodcastDetailPage
            key={selected?._id || "podcast-detail"}
            data={{
              selected,
              clips,
              busy,
              sourceKind,
              speakerKey,
              extraFiles,
              transcriptLines,
              transcriptVisible,
              hasTranscript,
              selectedExportFormat,
              hasStoryMomentJob,
              hasOpusClipJob,
              assignees,
              savingTranscript,
              previewSource,
              uploadProgress,
            }}
            actions={{
              setSourceKind,
              setSpeakerKey,
              setExtraFiles,
              stopPodcastJob,
              stopGeneration,
              restartPodcastJob,
              transcribe,
              generateStories,
              generateClipSuggestions,
              generateOpusClips,
              uploadMore,
              setExportFormat,
              exportTranscript,
              saveTranscript,
              exportClipMetadata,
              exportStoryMetadata,
              setOpenTranscriptFor,
              updateClip,
              editCameraPlan,
              renderClip,
              previewSourceClip,
              closeSourcePreview,
              previewClip,
              downloadClip,
              deleteRenderedClip,
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
