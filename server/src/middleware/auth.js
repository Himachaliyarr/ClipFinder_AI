import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { config } from '../config/settings.js';
import { asyncHandler } from './asyncHandler.js';

export function isCurrentTokenVersion(tokenVersion, userVersion) {
  return (tokenVersion ?? 0) === (userVersion ?? 0);
}

export const auth = asyncHandler(async (req, res, next) => {
  if (!config.jwtSecret) return res.status(503).json({ error: 'Authentication is not configured' });
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Login required' });
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // Load the user on each request so deleted accounts and changed roles take effect immediately.
  req.user = await User.findById(payload.id).select('-passwordHash');
  if (!req.user) return res.status(401).json({ error: 'User not found' });
  if (!isCurrentTokenVersion(payload.tokenVersion, req.user.tokenVersion)) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  return next();
});
export const allow = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Insufficient permissions' });
