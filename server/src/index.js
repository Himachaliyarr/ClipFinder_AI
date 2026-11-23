import './config/env.js';
import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import podcastRoutes from './routes/podcasts.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'replace_with_a_long_random_secret') {
  throw new Error('JWT_SECRET must be a unique random value of at least 32 characters');
}

const app = express();
app.disable('x-powered-by');
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(x => x.trim());
app.use(cors({ origin: (origin, cb) => !origin || allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Origin not allowed by CORS')) }));
app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  skip: req =>
    (req.method === 'GET' && req.path === '/api/podcasts/notifications') ||
    (req.method === 'PATCH' &&
      /^\/api\/podcasts\/[^/]+\/uploads\/[^/]+$/.test(req.path)),
}));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'ClipFinder AI' }));
app.use('/api/auth', authRoutes);
app.use('/api/podcasts', podcastRoutes);
// Media is deliberately NOT mounted as a public static directory. Originals and renders
// are served only through authenticated API endpoints.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.code === 'ENOSPC' ? 507 : err.code === 'LIMIT_FILE_SIZE' ? 413 : err.name === 'MulterError' ? 400 : 500);
  console.error(JSON.stringify({
    level: 'error',
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    status,
    errorName: err.name || 'Error',
    message: String(err.message || 'Unknown error').slice(0, 1000),
  }));
  const message = err.code === 'ENOSPC'
    ? 'Storage is full. Free disk space or configure MEDIA_ROOT with more capacity, then retry.'
    : err.code === 'LIMIT_FILE_SIZE'
    ? 'A file exceeds the configured upload-size limit'
    : err.code === 'LIMIT_FILE_COUNT'
      ? 'This upload exceeds the configured file-count limit'
      : status >= 500
        ? 'Internal server error'
        : err.message;
  res.status(status).json({ error: message, requestId: req.requestId });
});
const port = Number(process.env.PORT || 5000);
connectDB().then(() => app.listen(port, () => console.log(`ClipFinder API running on ${port}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
