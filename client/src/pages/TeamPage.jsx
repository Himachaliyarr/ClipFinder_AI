// Team account management is rendered as a dedicated page.
const activityLabels = {
  podcast_created: "Podcast created",
  podcast_organization_updated: "Podcast details updated",
  source_files_uploaded: "Source media uploaded",
  youtube_transcription_queued: "Transcription started",
  youtube_transcription_completed: "Transcription completed",
  transcript_edited: "Transcript edited",
  transcript_text_edited: "Transcript text edited",
  transcript_speakers_corrected: "Transcript speakers corrected",
  story_moments_generated: "Story moments generated",
  opusclip_reels_generated: "Reels generated",
  clip_sentences_edited: "Clip sentences edited",
  clip_assigned: "Clip assignment updated",
  clip_rendered: "Clip rendered",
  render_deleted: "Rendered video deleted",
  render_accessed: "Rendered video opened",
  source_preview_accessed: "Source video previewed",
  background_job_failed: "Background job failed",
  background_job_retried: "Background job retried",
  user_created: "Team member added",
  user_updated: "Team member updated",
  user_role_changed: "Team role changed",
  backup_restore_test_recorded: "Restore drill recorded",
};
const clipFieldLabels = {
  start: "clip start time",
  end: "clip end time",
  title: "title",
  hook: "hook",
  caption: "caption",
  status: "status",
  assignedTo: "assignment",
  editorNotes: "editor notes",
  cameraSegments: "camera cuts",
  captionSegments: "caption segments",
  performance: "performance data",
  sentenceEdits: "sentence edits",
};

function getActivityLabel(action = "") {
  if (typeof action !== "string") return "Activity recorded";
  if (activityLabels[action]) return activityLabels[action];
  if (action.startsWith("clip_")) {
    const status = action.slice("clip_".length);
    return `Clip ${status.replaceAll("_", " ")}`;
  }
  return action.replaceAll("_", " ");
}

function getActivitySummary(event) {
  const details =
    event.details && typeof event.details === "object" ? event.details : {};
  switch (event.action) {
    case "podcast_organization_updated": {
      const changed = (Array.isArray(details.changed) ? details.changed : [])
        .map((field) =>
          field === "folder" ? "folder" : field === "tags" ? "tags" : null,
        )
        .filter(Boolean);
      return changed.length
        ? `Changed ${changed.join(" and ")}.`
        : "Updated podcast organization.";
    }

    case "source_files_uploaded": {
      const count = Number(details.count) || 1;
      return `Uploaded ${count} ${details.kind || "source"} file${count === 1 ? "" : "s"}.`;
    }
    case "transcript_edited":
      return `Updated ${details.lineCount || 0} transcript lines.`;
    case "transcript_speakers_corrected":
      return `Corrected speakers in ${details.correctionCount || 0} transcript ranges.`;
    case "story_moments_generated":
      return `Generated ${details.storyCount || 0} story moments.`;
    case "opusclip_reels_generated":
      return `Generated ${details.clipCount || 0} reels.`;
    case "clip_sentences_edited": {
      const edits = Array.isArray(details.sentenceEdits)
        ? details.sentenceEdits
        : [];
      return `Edited ${edits.length} sentence segments.`;
    }
    case "clip_updated": {
      const changed = Object.keys(details).flatMap((field) => {
        const label = clipFieldLabels[field];
        if (!label) return [];
        const value = details[field];
        if (
          ["title", "hook", "caption"].includes(field) &&
          typeof value === "string"
        ) {
          const shortValue =
            value.length > 80 ? `${value.slice(0, 77)}…` : value;
          return [`${label} → “${shortValue}”`];
        }
        if (field === "status" && typeof value === "string")
          return [`status → ${value}`];
        if (
          ["cameraSegments", "captionSegments", "sentenceEdits"].includes(
            field,
          ) &&
          Array.isArray(value)
        ) {
          return [`${value.length} ${label}`];
        }
        return [label];
      });
      return changed.length
        ? `Changed ${changed.join(", ")}.`
        : "Updated clip details.";
    }
    case "clip_assigned":
      return "Changed the clip assignment.";
    case "clip_rendered":
      return `Created render version ${details.renderVersion || 1}.`;
    case "render_deleted":
      return `Deleted render version ${details.renderVersion || ""}${details.fileRemoved === false ? " (render file was already missing)" : ""}.`;
    case "user_updated": {
      const fields = (
        Array.isArray(details.changedFields) ? details.changedFields : []
      )
        .map((field) => (field === "passwordReset" ? "password" : field))
        .filter(Boolean);
      return fields.length
        ? `Changed ${fields.join(", ")}.`
        : "Updated team member details.";
    }
    case "user_created":
      return details.role ? `Added with ${details.role} role.` : "";
    case "user_role_changed":
      return `Changed role from ${details.previousRole || "unknown"} to ${details.role || "unknown"}.`;
    case "background_job_failed":
      return typeof details.message === "string"
        ? details.message
        : "A background job failed.";
    case "backup_restore_test_recorded":
      return details.notes
        ? `Restore drill: ${details.notes}`
        : "Recorded a completed restore drill.";
    default:
      return "";
  }
}

export function RecentActivityPage({ activity = [], busy = false, onClearActivity }) {
  return (
    <section className="team-section" aria-labelledby="recent-activity-heading">
      <div className="activity-heading">
        <h3 id="recent-activity-heading" className="sectiontitle">Recent activity</h3>
        <button
          type="button"
          className="secondary"
          onClick={onClearActivity}
          disabled={busy || !activity.length}
        >
          Clear all activity
        </button>
      </div>
      <div className="activitylist" aria-live="polite">
        {activity.map((event) => {
          const summary = getActivitySummary(event);
          return (
            <article className="activityitem" key={event._id}>
              <div className="activityitem-heading">
                <strong>{getActivityLabel(event.action)}</strong>
                <span>{event.user?.name || "Unknown user"}</span>
              </div>
              {summary && <p>{summary}</p>}
              {event.podcastName && (
                <small className="muted">Podcast: {event.podcastName}</small>
              )}
              <small className="muted">
                Where: {event.location || event.entityType || "Workspace"}
              </small>
              <time className="muted" dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </article>
          );
        })}
        {!activity.length && <p className="muted">No activity recorded yet.</p>}
      </div>
    </section>
  );
}

export default function TeamPage({ data, actions }) {
  const {
    users,
    backupStatus,
    newUser,
    editingUser,
    busy,
    currentUser,
  } = data;
  const {
    setNewUser,
    createUser,
    setEditingUser,
    updateUser,
    startEditingUser,
    recordRestoreTest,
  } = actions;
  const backupLabel =
    backupStatus?.status === "success"
      ? "Last backup succeeded"
      : backupStatus?.status === "failed"
        ? "Last backup failed"
        : "No backup recorded yet";

  return (
    <>
      <section
        className="create backup-health"
        aria-labelledby="backup-health-heading"
      >
        <div>
          <h3 id="backup-health-heading">Backup health</h3>
          <span
            className={`status ${backupStatus?.status === "success" ? "approved" : backupStatus?.status === "failed" ? "failed" : ""}`}
          >
            {backupLabel}
          </span>
          {backupStatus?.createdAt && (
            <p className="muted">
              Last completed:{" "}
              {new Date(backupStatus.createdAt).toLocaleString()}
            </p>
          )}
          {backupStatus?.failedAt && (
            <p className="error">
              {backupStatus.error ||
                "Check the backup process logs for details."}
            </p>
          )}
          {backupStatus?.status === "success" && (
            <p className="muted">
              Database archive:{" "}
              {backupStatus.databaseArchiveBytes
                ? `${(backupStatus.databaseArchiveBytes / 1024 ** 2).toFixed(1)} MiB`
                : "recorded"}{" "}
              · Media: {backupStatus.mediaIncluded ? "included" : "not found"}
            </p>
          )}
          {backupStatus?.lastVerification && (
            <p className={backupStatus.lastVerification.ok ? "muted" : "error"}>
              Integrity check{" "}
              {backupStatus.lastVerification.ok ? "passed" : "failed"} ·{" "}
              {new Date(
                backupStatus.lastVerification.checkedAt,
              ).toLocaleString()}
              {backupStatus.lastVerification.error
                ? ` · ${backupStatus.lastVerification.error}`
                : ""}
              {backupStatus.lastVerification.ok &&
                " · Restore itself was not tested"}
            </p>
          )}
          {backupStatus?.lastRestoreTest && (
            <p className="muted">
              Restore drill recorded:{" "}
              {new Date(backupStatus.lastRestoreTest.testedAt).toLocaleString()}{" "}
              · {backupStatus.lastRestoreTest.backupFolder} ·{" "}
              {backupStatus.lastRestoreTest.notes}
            </p>
          )}
          {backupStatus?.status === "success" && backupStatus.backupFolder && (
            <button
              type="button"
              className="secondary"
              onClick={() => recordRestoreTest(backupStatus.backupFolder)}
            >
              Record completed restore drill
            </button>
          )}
        </div>
      </section>
      <section className="create">
        <form className="userform" onSubmit={createUser}>
          <h3>Create team member</h3>
          <input
            value={newUser.name ?? ""}
            onChange={(event) =>
              setNewUser({ ...newUser, name: event.target.value })
            }
            placeholder="Name"
            aria-label="Team member name"
            required
          />
          <input
            type="email"
            value={newUser.email ?? ""}
            onChange={(event) =>
              setNewUser({ ...newUser, email: event.target.value })
            }
            placeholder="Email"
            aria-label="Team member email"
            required
          />
          <input
            type="password"
            value={newUser.password ?? ""}
            onChange={(event) =>
              setNewUser({ ...newUser, password: event.target.value })
            }
            placeholder="Temporary password (12+ characters)"
            aria-label="Temporary password"
            minLength="12"
            required
          />
          <select
            value={newUser.role}
            onChange={(event) =>
              setNewUser({ ...newUser, role: event.target.value })
            }
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit">Add member</button>
        </form>
      </section>
      <h3 className="sectiontitle">Team roles</h3>
      <div className="cards">
        {users.map((user) => (
          <article className="podcard" key={user._id}>
            {editingUser?.id === user._id ? (
              <form className="account-edit-form" onSubmit={updateUser}>
                <h3>Edit account</h3>
                <input
                  value={editingUser.name}
                  onChange={(event) =>
                    setEditingUser({ ...editingUser, name: event.target.value })
                  }
                  placeholder="Name"
                  aria-label="Edit team member name"
                  required
                />
                <input
                  type="email"
                  value={editingUser.email}
                  onChange={(event) =>
                    setEditingUser({
                      ...editingUser,
                      email: event.target.value,
                    })
                  }
                  placeholder="Email"
                  aria-label="Edit team member email"
                  required
                />
                <select
                  value={editingUser.role}
                  disabled={user._id === currentUser.id}
                  onChange={(event) =>
                    setEditingUser({ ...editingUser, role: event.target.value })
                  }
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <input
                  type="password"
                  value={editingUser.password}
                  onChange={(event) =>
                    setEditingUser({
                      ...editingUser,
                      password: event.target.value,
                    })
                  }
                  placeholder="New password (optional, 12+ characters)"
                  aria-label="New password"
                  minLength="12"
                  autoComplete="new-password"
                />
                <div className="account-actions">
                  <button type="submit" disabled={busy}>
                    Save account
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setEditingUser(null)}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
                {user._id === currentUser.id && (
                  <small className="muted">Your admin role is protected.</small>
                )}
              </form>
            ) : (
              <>
                <h3>{user.name}</h3>
                <p className="muted">{user.email}</p>
                <span className="status">{user.role}</span>
                <button
                  className="secondary"
                  onClick={() => startEditingUser(user)}
                >
                  Edit account
                </button>
              </>
            )}
          </article>
        ))}
        {!users.length && (
          <div className="empty-state">
            <h4>No team accounts yet</h4>
            <p className="muted">Add a team member using the form above.</p>
          </div>
        )}
      </div>
    </>
  );
}
