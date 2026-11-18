import React, { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Bell,
  Eye,
  EyeOff,
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
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordHelp, setShowPasswordHelp] = useState(false);

  return (
    <main className="login" data-theme={theme}>
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <section className="login-intro" aria-label="ClipFinder AI">
        <div className="brand">
          <Film /> ClipFinder <b>AI</b>
        </div>
        <span className="login-eyebrow">YOUR CREATOR WORKSPACE</span>
        <h1>Long videos,<strong>ready-to-post clips.</strong></h1>
        <p className="login-intro-copy">Find the moments worth sharing. Turn full-length conversations into short-form content your audience will watch.</p>
        <div className="login-intro-note">
          <Clapperboard size={18} aria-hidden="true" />
          <span>One workspace for stories, reels, and your team.</span>
        </div>
      </section>
      <section className="login-panel">
        <form onSubmit={onLogin} aria-labelledby="team-sign-in-heading">
          <div className="login-form-heading">
            <span className="login-eyebrow">WELCOME BACK</span>
            <h2 id="team-sign-in-heading">Team sign in</h2>
            <p>Use your team account to continue.</p>
          </div>
          <label className="login-field" htmlFor="sign-in-email">
            <span>Work email</span>
            <input id="sign-in-email" name="email" type="email" placeholder="name@company.com" autoComplete="username" required />
          </label>
          <div className="login-field">
            <label htmlFor="sign-in-password">Password</label>
            <span className="login-password-input">
              <input
                id="sign-in-password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                className="login-password-toggle"
                type="button"
                onClick={() => setShowPassword(current => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </div>
          <div className="login-help">
            <button
              className="login-text-link"
              type="button"
              onClick={() => setShowPasswordHelp(current => !current)}
              aria-expanded={showPasswordHelp}
            >
              Forgot password?
            </button>
            {showPasswordHelp && (
              <p className="login-password-help" role="status">
                Password resets are managed by your workspace administrator. Contact them to restore access.
              </p>
            )}
          </div>
          <button className="login-submit" type="submit">Sign in</button>
          <p className="login-access-note">Need access? Ask your workspace admin for an account.</p>
          {error && <p className="error login-error" role="alert">{error}</p>}
        </form>
      </section>
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
  onRetryNotification,
  retryingNotificationIds = new Set(),
}) {
  const notificationDetailsRef = useRef(null);

  useEffect(() => {
    const closeOnOutsideInteraction = event => {
      const details = notificationDetailsRef.current;
      if (details?.open && !details.contains(event.target)) details.open = false;
    };
    const closeOnEscape = event => {
      if (event.key === "Escape" && notificationDetailsRef.current?.open) {
        notificationDetailsRef.current.open = false;
      }
    };
    document.addEventListener("focusin", closeOnOutsideInteraction);
    document.addEventListener("pointerdown", closeOnOutsideInteraction);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("focusin", closeOnOutsideInteraction);
      document.removeEventListener("pointerdown", closeOnOutsideInteraction);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <header>
      <div>
        <small>WORKSPACE / {page.toUpperCase()}</small>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="notification-center">
          <details ref={notificationDetailsRef}>
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
                  {notification.retryable && (
                    <button
                      type="button"
                      className="notification-retry"
                      onClick={() => onRetryNotification(notification.id)}
                      disabled={retryingNotificationIds.has(notification.id)}
                    >
                      {retryingNotificationIds.has(notification.id) ? 'Retrying…' : 'Retry job'}
                    </button>
                  )}
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
