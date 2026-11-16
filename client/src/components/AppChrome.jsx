import {
  Clapperboard,
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
<<<<<<< HEAD
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
=======
      <form onSubmit={onLogin}>
        <h1>Team sign in</h1>
        <input name="email" type="email" placeholder="Email" required />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
        />
        <button>Sign in</button>
        {error && <p className="error">{error}</p>}
>>>>>>> 5e4df040bc2a0c1af8ba173eb9c65e3f485e243a
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

export function WorkspaceSidebar({ page, user, onNavigate, onSignOut }) {
  return (
<<<<<<< HEAD
    <aside aria-label="Main navigation">
=======
    <aside>
>>>>>>> 5e4df040bc2a0c1af8ba173eb9c65e3f485e243a
      <div className="brand">
        <Film /> ClipFinder <b>AI</b>
      </div>
      <button
        className={page === "dashboard" ? "nav active" : "nav"}
<<<<<<< HEAD
        aria-current={page === "dashboard" ? "page" : undefined}
        aria-label="Podcasts dashboard"
=======
>>>>>>> 5e4df040bc2a0c1af8ba173eb9c65e3f485e243a
        onClick={() => onNavigate("dashboard")}
      >
        <Clapperboard /> Podcasts
      </button>
      {user?.role === "admin" && (
        <button
          className={page === "team" ? "nav active" : "nav"}
<<<<<<< HEAD
          aria-current={page === "team" ? "page" : undefined}
          aria-label="Team and audit"
=======
>>>>>>> 5e4df040bc2a0c1af8ba173eb9c65e3f485e243a
          onClick={() => onNavigate("team")}
        >
          <Users /> Team &amp; audit
        </button>
      )}
      <div className="sidefoot">
<<<<<<< HEAD
        <span className="sidebar-user-name">{user?.name || "Vande Digital"}</span>
=======
        {user?.name || "Vande Digital"}
>>>>>>> 5e4df040bc2a0c1af8ba173eb9c65e3f485e243a
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
}) {
  return (
    <header>
      <div>
        <small>WORKSPACE / {page.toUpperCase()}</small>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <button className="secondary" onClick={onRefresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </div>
    </header>
  );
}
