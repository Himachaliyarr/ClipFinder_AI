import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { Upload, CheckCircle, Clapperboard } from 'lucide-react';
import { formatTranscriptForExport, formatTranscriptJson, formatTranscriptTimestamp, getTranscriptLines } from '../utils/transcript.js';
import { LoginScreen, WelcomeScreen, WorkspaceHeader, WorkspaceSidebar } from '../components/AppChrome.jsx';
import PodcastCard from '../components/PodcastCard.jsx';
import PodcastJobProgress, {
  canRestartPodcastJob,
  isPodcastJobActive,
} from '../components/PodcastJobProgress.jsx';
import TranscriptPanel, {
  isSupportedExportFormat,
} from '../components/TranscriptPanel.jsx';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function transcriptFilename(title) {
  return String(title || 'transcript').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'transcript';
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Attach the saved session token to every API request in one place.
const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('cf_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('cf_token'));
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('cf_theme');
    return savedTheme === 'light' ? 'light' : 'dark';
  });
  const [showWelcome, setShowWelcome] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [podcasts, setPodcasts] = useState([]);
  const [selectedPodcastIds, setSelectedPodcastIds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [openTranscriptFor, setOpenTranscriptFor] = useState(null);
  const [clips, setClips] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'editor' });
  const [editingUser, setEditingUser] = useState(null);
  const [title, setTitle] = useState('');
  const [files, setFiles] = useState([]);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [extraFiles, setExtraFiles] = useState([]);
  const [sourceKind, setSourceKind] = useState('video');
  const [speakerKey, setSpeakerKey] = useState('');
  const [exportFormat, setExportFormat] = useState('pdf');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canDeletePodcasts = ['admin', 'editor'].includes(currentUser?.role);
  const allPodcastsSelected = podcasts.length > 0 && podcasts.every(podcast => selectedPodcastIds.includes(podcast._id));

  useEffect(() => {
    localStorage.setItem('cf_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!showWelcome) return undefined;
    const timer = setTimeout(() => setShowWelcome(false), 1500);
    return () => clearTimeout(timer);
  }, [showWelcome]);

  async function load() {
    try {
      setPodcasts((await api.get('/podcasts')).data);
    } catch (e) {
      setError(e.response?.data?.error || 'API unavailable. Start backend and sign in.');
    }
  }

  useEffect(() => {
    if (!token) return;
    load();
    api.get('/auth/me').then(({ data }) => setCurrentUser(data)).catch(e => {
      setError(e.response?.data?.error || 'Could not load the signed-in user');
    });
  }, [token]);

  async function loadMetrics() {
    try {
      const { data } = await api.get('/podcasts/analytics/summary');
      setMetrics(data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load production metrics');
    }
  }

  async function refreshDashboard() {
    await Promise.all([load(), loadMetrics()]);
  }

  function togglePodcastSelection(id) {
    setSelectedPodcastIds(current => current.includes(id)
      ? current.filter(selectedId => selectedId !== id)
      : [...current, id]);
  }

  function toggleSelectAllPodcasts() {
    setSelectedPodcastIds(allPodcastsSelected ? [] : podcasts.map(podcast => podcast._id));
  }

  async function deleteSelectedPodcasts() {
    const ids = podcasts.filter(podcast => selectedPodcastIds.includes(podcast._id)).map(podcast => podcast._id);
    if (!ids.length || !window.confirm(`Permanently delete ${ids.length} selected podcast${ids.length === 1 ? '' : 's'}, including clips, activity history, and media files?`)) return;

    setBusy(true);
    const deletedIds = [];
    try {
      for (const id of ids) {
        await api.delete(`/podcasts/${id}`);
        deletedIds.push(id);
      }
      setError(`${deletedIds.length} podcast history item${deletedIds.length === 1 ? '' : 's'} deleted.`);
    } catch (e) {
      setError(e.response?.data?.error || `Deleted ${deletedIds.length} of ${ids.length} selected items; the remaining items could not be deleted.`);
    } finally {
      if (deletedIds.length) {
        setPodcasts(current => current.filter(podcast => !deletedIds.includes(podcast._id)));
        setSelectedPodcastIds(current => current.filter(id => !deletedIds.includes(id)));
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
      setError(data.message || 'Stop requested.');
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not stop podcast processing');
    } finally {
      setBusy(false);
    }
  }

  async function restartPodcastJob(podcastId) {
    setBusy(true);
    try {
      const { data } = await api.post(`/podcasts/${podcastId}/restart`);
      setError(data.message || 'Podcast processing restarted.');
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not restart podcast processing');
    } finally {
      setBusy(false);
    }
  }

  async function loadTeam() {
    try {
      const [userResult, activityResult] = await Promise.all([
        api.get('/auth/users'),
        api.get('/podcasts/analytics/activity'),
      ]);
      setUsers(userResult.data);
      setActivity(activityResult.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load team and audit log');
    }
  }

  useEffect(() => {
    if (token && page === 'dashboard') loadMetrics();
    if (token && page === 'team' && currentUser?.role === 'admin') loadTeam();
  }, [token, page, currentUser?.role]);

  const hasActivePodcastJobs = podcasts.some(podcast => isPodcastJobActive(podcast.status));
  useEffect(() => {
    if (!token || page !== 'dashboard' || !hasActivePodcastJobs) return;
    // Poll only while visible dashboard jobs are active, then stop the timer.
    const timer = setInterval(() => load(), 2500);
    return () => clearInterval(timer);
  }, [token, page, hasActivePodcastJobs]);

  const hasRenderJobs = clips.some(clip => ['queued', 'processing'].includes(clip.renderStatus));
  const hasOpusClipJob = ['queued', 'processing'].includes(selected?.opusClipStatus);
  const transcriptLines = getTranscriptLines(selected?.segments);
  const transcriptVisible = Boolean(selected?._id && openTranscriptFor === selected._id);
  const hasTranscript = Boolean(selected?.transcript || transcriptLines.length);
  const hasStoryMomentJob = ['queued', 'processing'].includes(selected?.storyMomentsStatus);
  const selectedExportFormat = isSupportedExportFormat(exportFormat) ? exportFormat : 'pdf';
  useEffect(() => {
    const hasPodcastJob = isPodcastJobActive(selected?.status);
    if (!token || page !== 'detail' || !selected?._id || (!hasPodcastJob && !hasRenderJobs && !hasOpusClipJob && !hasStoryMomentJob)) return;
    const timer = setInterval(() => {
      refresh().catch(e => setError(e.response?.data?.error || 'Could not refresh job status'));
    }, 2500);
    return () => clearInterval(timer);
  }, [token, page, selected?._id, selected?.status, selected?.jobProgress, hasRenderJobs, hasOpusClipJob, hasStoryMomentJob]);

  useEffect(() => {
    if (youtubeUrl.trim()) setFiles([]);
  }, [youtubeUrl]);

  async function login(e) {
    e.preventDefault();
    try {
      const data = (await api.post('/auth/login', {
        email: e.target.email.value,
        password: e.target.password.value,
      })).data;
      localStorage.setItem('cf_token', data.token);
      setToken(data.token);
      setCurrentUser(data.user);
      setShowWelcome(true);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || 'Login failed');
    }
  }

  async function create() {
    setBusy(true);
    try {
      let podcast;
      if (youtubeUrl.trim()) {
        const result = (await api.post('/podcasts/youtube', {
          title,
          url: youtubeUrl.trim(),
        })).data;
        podcast = result.podcast;
        setError('YouTube transcription queued. Media will not be saved locally.');
      } else {
        podcast = (await api.post('/podcasts', { title })).data;
        const formData = new FormData();
        [...files].forEach(file => formData.append('files', file));
        formData.append('kind', sourceKind);
        formData.append('speaker', speakerKey);
        await api.post(`/podcasts/${podcast._id}/files`, formData);
      }

      setTitle('');
      setFiles([]);
      setYoutubeUrl('');
      await load();
      setSelected(podcast);
      setPage('detail');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function open(podcast) {
    setPage('detail');
    setSelected(podcast);
    setCorrectingSpeakers(false);
    setSpeakerDraft([]);
    try {
      const [detail, podcastClips] = await Promise.all([
        api.get(`/podcasts/${podcast._id}`),
        api.get(`/podcasts/${podcast._id}/clips`),
      ]);
      setSelected(detail.data);
      setClips(podcastClips.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Could not load podcast details');
    }
  }

  async function uploadMore() {
    if (!extraFiles.length) return;
    setBusy(true);
    try {
      const formData = new FormData();
      [...extraFiles].forEach(file => formData.append('files', file));
      formData.append('kind', sourceKind);
      formData.append('speaker', speakerKey);
      await api.post(`/podcasts/${selected._id}/files`, formData);
      setExtraFiles([]);
      await refresh();
      setError('Source tracks uploaded. Use the speaker key in Camera plan.');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function transcribe() {
    setBusy(true);
    try {
      await api.post(`/podcasts/${selected._id}/transcribe`);
      setError('Transcription job accepted. Refresh after processing.');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function exportTranscript() {
    if (!selected || !hasTranscript) return;
    const normalizedFormat = isSupportedExportFormat(exportFormat) ? exportFormat : 'pdf';
    const filename = transcriptFilename(selected.title);
    const lines = getTranscriptLines(selected.segments);
    const rows = lines.length
      ? lines.map(line => ({
        start: `${formatTranscriptTimestamp(line.start)} - ${formatTranscriptTimestamp(line.end)}`,
        text: line.text,
      }))
      : [{ start: '', text: selected.transcript || '' }];

    try {
      if (normalizedFormat === 'json') {
        downloadBlob(
          new Blob([formatTranscriptJson(selected.title, selected.transcript, selected.segments)], { type: 'application/json;charset=utf-8' }),
          `${filename}-transcript.json`
        );
        return;
      }

      if (normalizedFormat === 'txt') {
        downloadBlob(
          new Blob([`\uFEFF${formatTranscriptForExport(selected.transcript, selected.segments)}`], { type: 'text/plain;charset=utf-8' }),
          `${filename}-transcript.txt`
        );
        return;
      }

      if (normalizedFormat === 'docx') {
        const paragraphs = [
          new Paragraph({ text: selected.title || 'Transcript', heading: HeadingLevel.TITLE }),
          ...rows.map(row => new Paragraph({
            children: [
              ...(row.start ? [new TextRun({ text: `[${row.start}] `, bold: true })] : []),
              new TextRun(row.text),
            ],
          })),
        ];
        const blob = await Packer.toBlob(new Document({ sections: [{ children: paragraphs }] }));
        downloadBlob(blob, `${filename}-transcript.docx`);
        return;
      }

      const printWindow = window.open('', '_blank');
      if (!printWindow) throw new Error('Allow pop-ups to export the transcript as PDF.');
      // Transcript text is inserted into HTML for printing, so escape it before writing.
      const printRows = rows.map(row => `
        <p>${row.start ? `<strong>[${escapeHtml(row.start)}]</strong> ` : ''}${escapeHtml(row.text)}</p>
      `).join('');
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(selected.title || 'Transcript')}</title><style>body{font:12pt Arial,sans-serif;color:#111;margin:24mm}h1{font-size:18pt}p{line-height:1.5;white-space:pre-wrap;break-inside:avoid}@media print{body{margin:18mm}}</style></head><body><h1>${escapeHtml(selected.title || 'Transcript')}</h1>${printRows}</body></html>`);
      printWindow.document.close();
      printWindow.onafterprint = () => printWindow.close();
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 300);
    } catch (e) {
      setError(e.message || 'Could not export transcript');
    }
  }

  async function generateOpusClips() {
    setBusy(true);
    try {
      const { data } = await api.post(`/podcasts/${selected._id}/opusclip`);
      setError(data.message || 'Reel generation queued.');
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
      const { data } = await api.post(`/podcasts/${selected._id}/select-stories`);
      setError(data.message || 'Story selection queued.');
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
      setClips((await api.get(`/podcasts/${selected._id}/clips`)).data);
    }
  }

  async function updateClip(id, patch) {
    try {
      const clip = (await api.patch(`/podcasts/clips/${id}`, patch)).data;
      setClips(old => old.map(item => item._id === id ? clip : item));
    } catch (e) {
      setError(e.response?.data?.error || 'Could not save clip changes');
    }
  }

  async function renderClip(id) {
    setBusy(true);
    try {
      await api.post(`/podcasts/clips/${id}/render`, { brandText: 'VANDE DIGITAL' });
      setError('Render queued. Progress will update here.');
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function previewClip(id) {
    try {
      const response = await api.get(`/podcasts/clips/${id}/render`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e.response?.data?.error || 'Rendered preview unavailable');
    }
  }

  async function downloadClip(id) {
    try {
      const response = await api.get(`/podcasts/clips/${id}/render`, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `clip-${id}.mp4`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.response?.data?.error || 'Rendered download unavailable');
    }
  }

  async function createUser(e) {
    e.preventDefault();
    try {
      await api.post('/auth/users', newUser);
      setNewUser({ name: '', email: '', password: '', role: 'editor' });
      setError('Team member created.');
      await loadTeam();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not create team member');
    }
  }

  function startEditingUser(user) {
    setEditingUser({ id: user._id, name: user.name, email: user.email, role: user.role, password: '' });
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
        setCurrentUser(user => ({ ...user, ...data }));
      }
      setEditingUser(null);
      setError('Account updated.');
      await loadTeam();
    } catch (e) {
      setError(e.response?.data?.error || 'Could not update account');
    } finally {
      setBusy(false);
    }
  }

  async function editCameraPlan(clip) {
    const current = JSON.stringify(clip.cameraSegments || [], null, 2);
    const raw = window.prompt('Camera plan JSON (clip-relative seconds; speaker must match an uploaded source track):', current);
    if (raw === null) return;
    try {
      await updateClip(clip._id, { cameraSegments: JSON.parse(raw) });
    } catch (e) {
      setError('Invalid camera plan JSON: ' + e.message);
    }
  }

  if (!token) {
    return (
      <LoginScreen
        theme={theme}
        onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
        onLogin={login}
        error={error}
      />
    );
  }

  return (
    <div className={`app${showWelcome ? ' is-welcoming' : ''}`} data-theme={theme}>
      {showWelcome && (
        <WelcomeScreen name={currentUser?.name} />
      )}
      <WorkspaceSidebar
        page={page}
        user={currentUser}
        onNavigate={setPage}
        onSignOut={() => {
            localStorage.removeItem('cf_token');
            setToken(null);
            setCurrentUser(null);
            setShowWelcome(false);
        }}
      />
      <main className="main">
        <WorkspaceHeader
          page={page}
          title={page === 'detail' ? selected?.title : page === 'team' ? 'Team and audit log' : 'Podcast workspace'}
          theme={theme}
          onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
          onRefresh={page === 'team' ? loadTeam : page === 'dashboard' ? refreshDashboard : refresh}
        />
        {error && <div className="notice">{error}</div>}
        {page === 'team' && currentUser?.role === 'admin' ? (
          <>
            <section className="create">
              <form className="userform" onSubmit={createUser}>
                <h3>Create team member</h3>
                <input value={newUser.name ?? ''} onChange={e => setNewUser({ ...newUser, name: e.target.value })} placeholder="Name" required />
                <input type="email" value={newUser.email ?? ''} onChange={e => setNewUser({ ...newUser, email: e.target.value })} placeholder="Email" required />
                <input type="password" value={newUser.password ?? ''} onChange={e => setNewUser({ ...newUser, password: e.target.value })} placeholder="Temporary password (12+ characters)" minLength="12" required />
                <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })}>
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
                        onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
                        placeholder="Name"
                        required
                      />
                      <input
                        type="email"
                        value={editingUser.email}
                        onChange={e => setEditingUser({ ...editingUser, email: e.target.value })}
                        placeholder="Email"
                        required
                      />
                      <select
                        value={editingUser.role}
                        disabled={user._id === currentUser.id}
                        onChange={e => setEditingUser({ ...editingUser, role: e.target.value })}
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <input
                        type="password"
                        value={editingUser.password}
                        onChange={e => setEditingUser({ ...editingUser, password: e.target.value })}
                        placeholder="New password (optional, 12+ characters)"
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
            </div>
            <h3 className="sectiontitle">Recent activity</h3>
            <div className="activitylist">
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
        ) : page === 'dashboard' ? (
          <>
            <section className="hero">
              <div>
                <span className="eyebrow">AI VIDEO WORKFLOW</span>
                <h2>Turn long podcasts into<br />short-form moments.</h2>
                <p>Upload source footage, transcribe it, then review AI-selected clips.</p>
              </div>
              <div className="heroicon"><Clapperboard size={64} /></div>
            </section>
            <section className="metricgrid">
              <article><small>Podcasts</small><strong>{metrics?.podcastCount ?? '—'}</strong></article>
              <article><small>AI clips</small><strong>{metrics?.clipCount ?? '—'}</strong></article>
              <article><small>Editor approval</small><strong>{metrics ? `${metrics.approvalRate}%` : '—'}</strong></article>
              <article><small>Published views entered</small><strong>{metrics?.totalViews ?? '—'}</strong></article>
              <article><small>Average watch time</small><strong>{metrics ? `${metrics.averageWatchTime}s` : '—'}</strong></article>
            </section>
            <section className="create">
              <div>
                <h3>New podcast</h3>
                <p className="muted">Upload a media file or paste a YouTube link to transcribe audio without saving YouTube media locally.</p>
              </div>
              <input value={title ?? ''} onChange={e => setTitle(e.target.value)} placeholder="Podcast name" />
              {!youtubeUrl.trim() && (
                <>
                  <select value={sourceKind} onChange={e => setSourceKind(e.target.value)}>
                    <option value="video">Camera video</option>
                    <option value="audio">Speaker mic track</option>
                    <option value="mix">Master mix audio</option>
                  </select>
                  <input value={speakerKey ?? ''} onChange={e => setSpeakerKey(e.target.value)} placeholder="Speaker key (optional for master mix)" />
                  <input type="file" multiple accept="video/*,audio/*" onChange={e => setFiles(e.target.files)} />
                </>
              )}
              <input
                type="url"
                value={youtubeUrl ?? ''}
                onChange={e => setYoutubeUrl(e.target.value)}
                placeholder="YouTube video link (optional)"
              />
              <button
                onClick={create}
                disabled={busy || !title || (!files.length && !youtubeUrl.trim()) || (files.length && youtubeUrl.trim())}
              >
                {busy ? 'Creating…' : <><Upload size={16} /> {youtubeUrl.trim() ? 'Transcribe YouTube link' : 'Create & upload'}</>}
              </button>
            </section>
            <h3 className="sectiontitle">Recent podcasts</h3>
            <section className="create">
              <label>
                <input
                  type="checkbox"
                  checked={allPodcastsSelected}
                  onChange={toggleSelectAllPodcasts}
                  disabled={!podcasts.length || busy}
                  style={{ width: 18, height: 18, padding: 0, accentColor: '#c79b41' }}
                />
                Select all
              </label>
              <span className="muted">{selectedPodcastIds.length} selected</span>
              {canDeletePodcasts && (
                <button className="secondary" onClick={deleteSelectedPodcasts} disabled={busy || !selectedPodcastIds.length}>
                  {busy ? 'Deleting…' : 'Delete selected'}
                </button>
              )}
            </section>
            <div className="cards">
              {podcasts.map(podcast => (
                <PodcastCard
                  key={podcast._id}
                  podcast={podcast}
                  canDelete={canDeletePodcasts}
                  selected={selectedPodcastIds.includes(podcast._id)}
                  busy={busy}
                  onOpen={open}
                  onToggleSelection={togglePodcastSelection}
                  onStop={stopPodcastJob}
                  onRestart={restartPodcastJob}
                />
              ))}
            </div>
          </>
        ) : page === 'detail' ? (
          <>
            <section className="detailbar">
              <div>
                <span className={`status ${selected?.status}`}>{selected?.status}</span>
                <p className="muted">{selected?.sourceFiles?.length || 0} source files · {selected?.language || 'Language pending'}</p>
                {selected?.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">YouTube source</a>}
                {(selected?.jobId || isPodcastJobActive(selected?.status) || (selected && canRestartPodcastJob(selected))) && (
                  <PodcastJobProgress
                    podcast={selected}
                    busy={busy}
                    onStop={() => stopPodcastJob(selected._id)}
                    onRestart={() => restartPodcastJob(selected._id)}
                  />
                )}
              </div>
              <button onClick={transcribe} disabled={busy || !selected?.sourceFiles?.length || ['downloading','queued','processing'].includes(selected?.status)}>
                {busy ? 'Starting…' : 'Start transcription'}
              </button>
              {hasTranscript && (
                <button
                  className="secondary"
                  onClick={generateStories}
                  disabled={busy || hasStoryMomentJob}
                >
                  {hasStoryMomentJob ? 'Finding stories…' : selected?.storyMomentsStatus === 'completed' ? 'Regenerate stories' : 'Find story moments'}
                </button>
              )}
              {selected?.transcript && (selected?.sourceUrl || selected?.sourceFiles?.some(file => file.kind === 'video')) && (
                <button
                  className="secondary"
                  onClick={generateOpusClips}
                  disabled={busy || hasOpusClipJob}
                >
                  Generate Reels
                </button>
              )}
            </section>
            <section className="create sourceupload">
              <div>
                <h3>Add camera / audio track</h3>
                <p className="muted">Upload one speaker camera at a time and assign its stable key.</p>
              </div>
              <select value={sourceKind} onChange={e => setSourceKind(e.target.value)}>
                <option value="video">Camera video</option>
                <option value="audio">Speaker mic track</option>
                <option value="mix">Master mix audio</option>
              </select>
              <input value={speakerKey ?? ''} onChange={e => setSpeakerKey(e.target.value)} placeholder="Speaker key e.g. host_a" />
              <input type="file" multiple accept="video/*,audio/*" onChange={e => setExtraFiles(e.target.files)} />
              <button onClick={uploadMore} disabled={busy || !extraFiles.length || (!speakerKey && sourceKind !== 'mix')}>
                Upload track
              </button>
            </section>
            {selected?.error && !isPodcastJobActive(selected.status) && <div className="notice error">Processing failed: {selected.error}</div>}
            <TranscriptPanel
              selected={selected}
              transcriptLines={transcriptLines}
              transcriptVisible={transcriptVisible}
              hasTranscript={hasTranscript}
              selectedExportFormat={selectedExportFormat}
              setExportFormat={setExportFormat}
              exportTranscript={exportTranscript}
              setOpenTranscriptFor={setOpenTranscriptFor}
            />
            <section className="story-results">
              <div className="story-heading">
                <div>
                  <h3>Story moments ({selected?.storyMoments?.length || 0})</h3>
                  <p className={selected?.storyMomentsStatus === 'failed' ? 'error' : 'muted'}>
                    {selected?.storyMomentsStatus === 'completed'
                      ? 'Story moments are ready.'
                      : selected?.storyMomentsStatus === 'failed'
                        ? 'Story selection failed. Please retry or contact an administrator.'
                        : hasStoryMomentJob
                          ? 'Finding story moments…'
                          : hasTranscript
                            ? selected?.sourceUrl && !selected?.sourceFiles?.length
                              ? 'Generate story moments manually from this YouTube transcript.'
                              : 'Story cards are generated automatically after transcription.'
                            : 'Transcribe the source to find story moments.'}
                  </p>
                  {hasStoryMomentJob && (
                    <div className="async-progress">
                      <span>{selected?.storyMomentsMessage || 'Finding story moments…'}</span>
                      <div className="indeterminate-progress" role="progressbar" aria-label="Finding story moments" aria-valuetext="In progress">
                        <span />
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="story-grid">
                {(selected?.storyMoments || []).map((story, index) => (
                  <article className="story-card" key={`${story.start}-${index}`}>
                    <div className="story-card-top">
                      <span className="story-time">
                        {formatTranscriptTimestamp(story.start)} – {formatTranscriptTimestamp(story.end)}
                      </span>
                      <span className="score">{story.score}/10</span>
                    </div>
                    <h4>{story.title}</h4>
                    <p>{story.summary}</p>
                    {story.excerpt && <blockquote>{story.excerpt}</blockquote>}
                    {story.reason && <small className="muted">{story.reason}</small>}
                  </article>
                ))}
              </div>
            </section>
            <h3 className="sectiontitle">Reel suggestions ({clips.length})</h3>
            {!clips.length && <p className="muted">{selected?.transcript ? 'No reel suggestions are available yet.' : 'Transcribe the source to prepare reel suggestions.'}</p>}
            <div className="cliplist">
              {clips.map(clip => (
                <article className="clip" key={clip._id}>
                  <div className="score">{clip.score}/10</div>
                  <div className="clipbody">
                    <h3>{clip.title}</h3>
                    <p>{clip.hook}</p>
                    <p className="muted">{clip.start?.toFixed(1)}s – {clip.end?.toFixed(1)}s · {clip.reason}</p>
                    <div className="trimrow">
                      <label>In (sec)<input type="number" min="0" step="0.1" defaultValue={clip.start} onBlur={e => updateClip(clip._id, { start: Number(e.target.value) })} /></label>
                      <label>Out (sec)<input type="number" min="0.1" step="0.1" defaultValue={clip.end} onBlur={e => updateClip(clip._id, { end: Number(e.target.value) })} /></label>
                    </div>
                    <label>Caption</label>
                    <textarea defaultValue={clip.caption} onBlur={e => updateClip(clip._id, { caption: e.target.value })} />
                    <div className="trimrow performance">
                      <label>Published views<input type="number" min="0" step="1" defaultValue={clip.performance?.views ?? ''} onBlur={e => updateClip(clip._id, { performance: { views: Number(e.target.value || 0) } })} /></label>
                      <label>Average watch time (sec)<input type="number" min="0" step="0.1" defaultValue={clip.performance?.watchTime ?? ''} onBlur={e => updateClip(clip._id, { performance: { watchTime: Number(e.target.value || 0) } })} /></label>
                    </div>
                    <div className="actions">
                      <button className="approve" onClick={() => updateClip(clip._id, { status: 'approved' })}><CheckCircle size={15} /> Approve</button>
                      <button className="reject" onClick={() => updateClip(clip._id, { status: 'rejected' })}>Reject</button>
                      <button className="secondary" onClick={() => editCameraPlan(clip)}>Camera plan</button>
                      <button onClick={() => renderClip(clip._id)} disabled={busy || ['queued', 'processing'].includes(clip.renderStatus)}>Render 9:16</button>
                      {['queued', 'processing'].includes(clip.renderStatus) && <span className="renderprogress">{clip.renderStatus} · {clip.renderProgress || 0}%</span>}
                      {clip.renderStatus === 'failed' && <span className="error">{clip.renderError || 'Render failed'}</span>}
                      {clip.renderStatus === 'completed' && <><button className="secondary" onClick={() => previewClip(clip._id)}>Preview render</button><button className="secondary" onClick={() => downloadClip(clip._id)}>Download MP4</button></>}
                    </div>
                  </div>
                  <span className={`status ${clip.status}`}>{clip.status}</span>
                </article>
              ))}
            </div>
            {selected?.opusClipStatus && selected.opusClipStatus !== 'idle' && (
              <section className="opusclip-results">
                <h3>Generated reels ({selected.opusClipClips?.length || 0})</h3>
                <p className={selected.opusClipStatus === 'failed' ? 'error' : 'muted'}>
                  {selected.opusClipStatus === 'completed' ? 'Reels are ready.' : selected.opusClipStatus === 'failed' ? 'Reel generation failed. Please try again.' : 'Reels are being generated...'}
                </p>
                {hasOpusClipJob && (
                  <div className="async-progress">
                    <span>{selected.opusClipStatus === 'queued' ? 'Starting reel generation…' : 'Generating your reels…'}</span>
                    <div className="indeterminate-progress" role="progressbar" aria-label="Generating reels" aria-valuetext="In progress">
                      <span />
                    </div>
                  </div>
                )}
                <div className="opusclip-grid">
                  {(selected.opusClipClips || []).map((opusClip, index) => (
                    <article className="opusclip-card" key={opusClip.id || index}>
                      <h4>{opusClip.title || `Reel ${index + 1}`}</h4>
                      {opusClip.durationMs && <small className="muted">{(opusClip.durationMs / 1000).toFixed(1)}s</small>}
                      {opusClip.text && <p>{opusClip.text}</p>}
                      <div className="opusclip-actions">
                        {opusClip.uriForPreview && <a className="secondary" href={opusClip.uriForPreview} target="_blank" rel="noreferrer">Preview</a>}
                        {opusClip.uriForExport && <a className="secondary" href={opusClip.uriForExport} target="_blank" rel="noreferrer">Download</a>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
