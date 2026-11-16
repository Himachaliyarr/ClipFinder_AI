import './config/env.js';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { connectDB } from './config/db.js';
import { User } from './models/index.js';
import authRoutes from './routes/auth.js';
import podcastRoutes from './routes/podcasts.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'replace_with_a_long_random_secret') {
  throw new Error('JWT_SECRET must be a unique random value of at least 32 characters');
}

async function configureAdminFromEnvironment() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!name || !email || !password || password.length < 12) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and an ADMIN_PASSWORD of at least 12 characters in the root .env');
  }

  const user = await User.findOne({ email });
  if (user) {
    // The environment is authoritative for the bootstrap admin on every server start.
    let changed = false;
    if (user.name !== name) { user.name = name; changed = true; }
    if (user.role !== 'admin') { user.role = 'admin'; changed = true; }
    if (!await bcrypt.compare(password, user.passwordHash)) {
      user.passwordHash = await bcrypt.hash(password, 12);
      changed = true;
    }
    if (changed) await user.save();
    return;
  }

  await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
  console.log('Admin account created from environment configuration');
}

const app = express();
app.disable('x-powered-by');
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(x => x.trim());
app.use(cors({ origin: (origin, cb) => !origin || allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Origin not allowed by CORS')) }));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'ClipFinder AI' }));
app.use('/api/auth', authRoutes);
app.use('/api/podcasts', podcastRoutes);
// Media is deliberately NOT mounted as a public static directory. Originals and renders
// are served only through authenticated API endpoints.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});
const port = Number(process.env.PORT || 5000);
connectDB().then(configureAdminFromEnvironment).then(() => app.listen(port, () => console.log(`ClipFinder API running on ${port}`)))
  .catch(err => { console.error('Startup failed:', err); process.exit(1); });
