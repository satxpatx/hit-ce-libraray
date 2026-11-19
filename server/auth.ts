import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db.ts';
import type { UserRole } from '../src/lib/libraryRules.ts';

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  photoUrl: string | null;
  role: UserRole;
  status: string;
  departmentId: number | null;
  departmentName: string | null;
  memberCode: string | null;
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
  sessionToken?: string;
}

const SESSION_DURATION_HOURS = 24 * 7;

// Simple in-memory rate limiter for auth routes
const authAttempts = new Map<string, { count: number; resetAt: number }>();

export function authRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  if (entry.count >= 60) {
    res.status(429).json({ error: 'Too many authentication attempts. Please try again in a minute.' });
    return;
  }
  entry.count += 1;
  next();
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function getUserById(userId: number): SessionUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.full_name, u.phone, u.photo_url, u.status, u.department_id,
              r.name as role_name, d.name as department_name,
              COALESCE(s.registration_number, f.employee_id) as member_code
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN faculty f ON f.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: number;
        email: string;
        full_name: string;
        phone: string | null;
        photo_url: string | null;
        status: string;
        department_id: number | null;
        role_name: UserRole;
        department_name: string | null;
        member_code: string | null;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    photoUrl: row.photo_url,
    role: row.role_name,
    status: row.status,
    departmentId: row.department_id,
    departmentName: row.department_name,
    memberCode: row.member_code,
  };
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.hit_lib_session;
  if (cookieToken) return cookieToken;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  if (queryToken) return queryToken;
  return null;
}

export function resolveOptionalSessionUser(req: Request): SessionUser | null {
  const token = extractToken(req);
  if (!token) return null;
  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: number; expires_at: string } | undefined;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return null;
  }
  const user = getUserById(session.user_id);
  if (!user || user.status !== 'ACTIVE') return null;
  return user;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const session = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { user_id: number; expires_at: string } | undefined;

  if (!session) {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    res.status(401).json({ error: 'Session expired. Please sign in again.' });
    return;
  }

  const user = getUserById(session.user_id);
  if (!user || user.status !== 'ACTIVE') {
    res.status(403).json({ error: 'Account is inactive or unavailable.' });
    return;
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}.`,
      });
      return;
    }
    next();
  };
}

export function writeAuditLog(
  req: AuthedRequest | null,
  action: string,
  entityType: string,
  entityId: string | number | null,
  details: string
): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req?.user?.id ?? null,
      req?.user?.fullName ?? 'System',
      req?.user?.role ?? 'SYSTEM',
      action,
      entityType,
      entityId !== null && entityId !== undefined ? String(entityId) : null,
      details,
      req?.ip || '127.0.0.1'
    );
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export function createNotification(
  userId: number,
  type: string,
  title: string,
  message: string
): void {
  try {
    db.prepare(
      'INSERT INTO notifications (user_id, type, title, message, is_read) VALUES (?, ?, ?, ?, 0)'
    ).run(userId, type, title, message);
  } catch (err) {
    console.error('Notification insert failed:', err);
  }
}
