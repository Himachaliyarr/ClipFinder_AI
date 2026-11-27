import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import { config } from './config/settings.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

if (!config.jwtSecret || config.jwtSecret.length < 32 || config.jwtSecret === 'replace_with_a_long_random_secret') {
  throw new Error('JWT_SECRET must be a unique random value of at least 32 characters');
}

const app = express();
app.disable('x-powered-by');
const allowedOrigins = config.corsOrigins;
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
app.use('/api', apiRoutes);
// Media is deliberately NOT mounted as a public static directory. Originals and renders
// are served only through authenticated API endpoints.
app.use(errorHandler);
const port = config.port;
connectDB().then(() => app.listen(port, () => console.log(`ClipFinder API running on ${port}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
