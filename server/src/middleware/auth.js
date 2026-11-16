import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
export async function auth(req, res, next) {
  try {
    if (!process.env.JWT_SECRET) return res.status(503).json({ error: 'Authentication is not configured' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Login required' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    // Load the user on each request so deleted accounts and changed roles take effect immediately.
    req.user = await User.findById(payload.id).select('-passwordHash');
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}
export const allow = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' });
