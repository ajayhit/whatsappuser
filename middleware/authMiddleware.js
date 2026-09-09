import jwt from 'jsonwebtoken';
import { getUserById } from '../db.js';

const DEFAULT_FALLBACK_SECRET = 'whatsapp-api-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_FALLBACK_SECRET;

if (JWT_SECRET === DEFAULT_FALLBACK_SECRET) {
  console.warn('\x1b[33m%s\x1b[0m', '⚠️  [SECURITY WARNING] JWT_SECRET is using an insecure default fallback key! Please set a strong random JWT_SECRET in your .env to prevent token forgery.');
}

export function generateToken(user) {
  // Permanent API token without expiration (remains valid indefinitely until user regenerates)
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET
  );
}

export async function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization token is required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.is_blocked === 1) {
      return res.status(403).json({ error: 'Your account has been suspended or blocked by an admin.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}
