// Team account management and audit history are rendered as a dedicated page.
export default function TeamPage({ data, actions }) {
  const { users, activity, backupStatus, newUser, editingUser, busy, currentUser } = data;
  const { setNewUser, createUser, setEditingUser, updateUser, startEditingUser, recordRestoreTest, clearActivity } = actions;
  const backupLabel = backupStatus?.status === 'success'
    ? 'Last backup succeeded'
    : backupStatus?.status === 'failed'
      ? 'Last backup failed'
      : 'No backup recorded yet';

  return (
    <>
      <section className="create backup-health" aria-labelledby="backup-health-heading">
        <div>
          <h3 id="backup-health-heading">Backup health</h3>
          <span className={`status ${backupStatus?.status === 'success' ? 'approved' : backupStatus?.status === 'failed' ? 'failed' : ''}`}>
            {backupLabel}
          </span>
          {backupStatus?.createdAt && <p className="muted">Last completed: {new Date(backupStatus.createdAt).toLocaleString()}</p>}
          {backupStatus?.failedAt && <p className="error">{backupStatus.error || 'Check the backup process logs for details.'}</p>}
          {backupStatus?.status === 'success' && (
            <p className="muted">
              Database archive: {backupStatus.databaseArchiveBytes ? `${(backupStatus.databaseArchiveBytes / 1024 ** 2).toFixed(1)} MiB` : 'recorded'} ·
              Media: {backupStatus.mediaIncluded ? 'included' : 'not found'}
            </p>
          )}
          {backupStatus?.lastVerification && (
            <p className={backupStatus.lastVerification.ok ? 'muted' : 'error'}>
              Integrity check {backupStatus.lastVerification.ok ? 'passed' : 'failed'} · {new Date(backupStatus.lastVerification.checkedAt).toLocaleString()}
              {backupStatus.lastVerification.error ? ` · ${backupStatus.lastVerification.error}` : ''}
              {backupStatus.lastVerification.ok && ' · Restore itself was not tested'}
            </p>
          )}
          {backupStatus?.lastRestoreTest && (
            <p className="muted">
              Restore drill recorded: {new Date(backupStatus.lastRestoreTest.testedAt).toLocaleString()} · {backupStatus.lastRestoreTest.backupFolder} · {backupStatus.lastRestoreTest.notes}
            </p>
          )}
          {backupStatus?.status === 'success' && backupStatus.backupFolder && (
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
          <input value={newUser.name ?? ''} onChange={event => setNewUser({ ...newUser, name: event.target.value })} placeholder="Name" aria-label="Team member name" required />
          <input type="email" value={newUser.email ?? ''} onChange={event => setNewUser({ ...newUser, email: event.target.value })} placeholder="Email" aria-label="Team member email" required />
          <input type="password" value={newUser.password ?? ''} onChange={event => setNewUser({ ...newUser, password: event.target.value })} placeholder="Temporary password (12+ characters)" aria-label="Temporary password" minLength="12" required />
          <select value={newUser.role} onChange={event => setNewUser({ ...newUser, role: event.target.value })}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit">Add member</button>
        </form>
      </section>
      <h3 className="sectiontitle">Team roles</h3>
      <div className="cards">
        {users.map(user => (
          <article className="podcard" key={user._id}>
            {editingUser?.id === user._id ? (
              <form className="account-edit-form" onSubmit={updateUser}>
                <h3>Edit account</h3>
                <input
                  value={editingUser.name}
                  onChange={event => setEditingUser({ ...editingUser, name: event.target.value })}
                  placeholder="Name"
                  aria-label="Edit team member name"
                  required
                />
                <input
                  type="email"
                  value={editingUser.email}
                  onChange={event => setEditingUser({ ...editingUser, email: event.target.value })}
                  placeholder="Email"
                  aria-label="Edit team member email"
                  required
                />
                <select
                  value={editingUser.role}
                  disabled={user._id === currentUser.id}
                  onChange={event => setEditingUser({ ...editingUser, role: event.target.value })}
                >
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <input
                  type="password"
                  value={editingUser.password}
                  onChange={event => setEditingUser({ ...editingUser, password: event.target.value })}
                  placeholder="New password (optional, 12+ characters)"
                  aria-label="New password"
                  minLength="12"
                  autoComplete="new-password"
                />
                <div className="account-actions">
                  <button type="submit" disabled={busy}>Save account</button>
                  <button type="button" className="secondary" onClick={() => setEditingUser(null)} disabled={busy}>Cancel</button>
                </div>
                {user._id === currentUser.id && <small className="muted">Your admin role is protected.</small>}
              </form>
            ) : (
              <>
                <h3>{user.name}</h3>
                <p className="muted">{user.email}</p>
                <span className="status">{user.role}</span>
                <button className="secondary" onClick={() => startEditingUser(user)}>Edit account</button>
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
      <div className="activity-heading">
        <h3 className="sectiontitle">Recent activity</h3>
        <button type="button" className="secondary" onClick={clearActivity} disabled={busy || !activity.length}>
          Clear all activity
        </button>
      </div>
      <div className="activitylist" aria-live="polite">
        {activity.map(event => (
          <article className="activityitem" key={event._id}>
            <strong>{event.action.replaceAll('_', ' ')}</strong>
            <span>{event.user?.name || 'Unknown user'}</span>
            <small className="muted">{new Date(event.createdAt).toLocaleString()}</small>
          </article>
        ))}
        {!activity.length && <p className="muted">No activity recorded yet.</p>}
      </div>
    </>
  );
}
