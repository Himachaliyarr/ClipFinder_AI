// Team account management and audit history are rendered as a dedicated page.
export default function TeamPage({ data, actions }) {
  const { users, activity, newUser, editingUser, busy, currentUser } = data;
  const { setNewUser, createUser, setEditingUser, updateUser, startEditingUser } = actions;

  return (
    <>
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
      <h3 className="sectiontitle">Recent activity</h3>
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
