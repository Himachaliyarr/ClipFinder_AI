import {
  Clapperboard,
  Bell,
  Film,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";

// Shared sign-in and workspace chrome keeps page content focused on its own workflow.
export function ThemeToggle({ theme, onToggle }) {
  const nextTheme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      className="secondary theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <Icon size={16} />
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

export function LoginScreen({ theme, onToggleTheme, onLogin, error }) {
  return (
    <main className="login" data-theme={theme}>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <div className="brand">
        <Film /> ClipFinder <b>AI</b>
      </div>
      <form onSubmit={onLogin} aria-labelledby="team-sign-in-heading">
        <h1 id="team-sign-in-heading">Team sign in</h1>
        <label className="sr-only" htmlFor="sign-in-email">Email</label>
        <input id="sign-in-email" name="email" type="email" placeholder="Email" autoComplete="username" required />
        <label className="sr-only" htmlFor="sign-in-password">Password</label>
        <input
          id="sign-in-password"
          name="password"
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        <button type="submit">Sign in</button>
        <p className="muted">Sign in with admin email and password</p>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}

export function WelcomeScreen({ name }) {
  return (
    <div className="welcome-screen" role="status" aria-live="polite">
      <div className="welcome-orb" aria-hidden="true">
        <Sparkles size={30} />
      </div>
      <p className="welcome-kicker">
        CLIPFINDER AI <span>•</span> WORKSPACE READY
      </p>
      <h2>
        You're in, <strong>{name || "creator"}.</strong>
      </h2>
      <p className="welcome-subtitle">Let’s make something scroll-stopping.</p>
      <div className="welcome-progress" aria-hidden="true">
        <span />
      </div>
    </div>
  );
}

export function BrandIntroScreen({ theme }) {
  return (
    <main data-theme={theme}>
      <div className="welcome-screen brand-intro-screen" role="status" aria-live="polite">
        <div className="welcome-orb" aria-hidden="true">
          <Film size={30} />
        </div>
        <p className="welcome-kicker">YOUR CREATOR WORKSPACE</p>
        <h2 className="brand-intro-title">
          ClipFinder <strong>AI</strong>
        </h2>
        <p className="welcome-subtitle">Find the moments worth sharing.</p>
        <div className="welcome-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </main>
  );
}

export function WorkspaceSidebar({ page, user, onNavigate, onSignOut }) {
  return (
    <aside aria-label="Main navigation">
      <div className="brand">
        <Film /> ClipFinder <b>AI</b>
      </div>
      <button
        className={page === "dashboard" ? "nav active" : "nav"}
        aria-current={page === "dashboard" ? "page" : undefined}
        aria-label="Podcasts dashboard"
        onClick={() => onNavigate("dashboard")}
      >
        <Clapperboard /> Podcasts
      </button>
      {user?.role === "admin" && (
        <button
          className={page === "team" ? "nav active" : "nav"}
          aria-current={page === "team" ? "page" : undefined}
          aria-label="Team and audit"
          onClick={() => onNavigate("team")}
        >
          <Users /> Team &amp; audit
        </button>
      )}
      <div className="sidefoot">
        <span className="sidebar-user-name">{user?.name || "Vande Digital"}</span>
        <br />
        <small>Internal production</small>
        <button className="logout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </aside>
  );
}

export function WorkspaceHeader({
  page,
  title,
  theme,
  onToggleTheme,
  onRefresh,
  notifications = [],
  onClearNotifications,
}) {
  return (
    <header>
      <div>
        <small>WORKSPACE / {page.toUpperCase()}</small>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="notification-center">
          <details>
            <summary aria-label={`${notifications.length} notifications`}>
              <Bell size={16} />
              {notifications.length > 0 && <span className="notification-count">{notifications.length}</span>}
            </summary>
            <section className="notification-popover" aria-label="Recent notifications">
              <div className="notification-heading">
                <strong>Notifications</strong>
                {notifications.length > 0 && (
                  <button type="button" className="notification-clear" onClick={onClearNotifications}>
                    Clear all
                  </button>
                )}
              </div>
              {notifications.length ? notifications.map(notification => (
                <article className="notification-item" key={notification.id}>
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <time dateTime={notification.createdAt}>{new Date(notification.createdAt).toLocaleString()}</time>
                </article>
              )) : <p className="muted notification-empty">No notifications yet.</p>}
            </section>
          </details>
        </div>
        <button className="secondary" onClick={onRefresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
    </header>
  );
}
