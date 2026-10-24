import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db.ts';
import { jwtSecret } from '../env.ts';
import { HttpError, fail } from '../errors.ts';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'staff';
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export function generateToken(user: AuthUser): string {
  return jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, jwtSecret(), {
    expiresIn: '7d',
  });
}

export function isAdmin(user: AuthUser): boolean {
  return user.role === 'admin';
}

// Verifies the bearer token and loads the current user. Database errors are passed to the
// error handler as 500s, so a database outage never looks like an expired session.
export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      fail(401, 'UNAUTHORIZED', 'Authentication token is required.');
    }

    let decoded: { id: number };
    try {
      decoded = jwt.verify(authHeader.substring(7), jwtSecret()) as { id: number };
    } catch {
      fail(401, 'INVALID_TOKEN', 'Invalid or expired authentication token.');
    }

    const userRes = await db.query<AuthUser>('SELECT id, name, email, role FROM users WHERE id = $1', [decoded.id]);
    if (userRes.rows.length === 0) {
      fail(401, 'UNAUTHORIZED', 'User account no longer exists.');
    }
    const row = userRes.rows[0];
    req.user = { id: Number(row.id), name: row.name, email: row.email, role: row.role };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required.'));
  }
  if (!isAdmin(req.user)) {
    return next(new HttpError(403, 'FORBIDDEN', 'Administrative privileges required for this action.'));
  }
  next();
};

// Admins can access every lab; staff only labs they are members of.
export async function hasLabAccess(user: AuthUser, labId: number): Promise<boolean> {
  if (isAdmin(user)) return true;
  const res = await db.query('SELECT 1 FROM lab_members WHERE lab_id = $1 AND user_id = $2', [labId, user.id]);
  return res.rows.length > 0;
}

export async function assertLabAccess(user: AuthUser, labId: number): Promise<void> {
  if (!(await hasLabAccess(user, labId))) {
    fail(403, 'FORBIDDEN', 'Access denied: You are not assigned to this laboratory.');
  }
}

// Reads the lab from the route parameter, query string or body (in that order).
// Handlers must use the same validated value that was checked here.
export const requireLabAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) fail(401, 'UNAUTHORIZED', 'Authentication required.');
    const raw = req.params.labId ?? req.query.lab_id ?? req.body?.lab_id;
    const labId = Number(raw);
    if (raw === undefined || !Number.isInteger(labId) || labId <= 0) {
      fail(400, 'INVALID_LAB_ID', 'A valid lab_id is required.');
    }
    await assertLabAccess(req.user, labId);
    next();
  } catch (err) {
    next(err);
  }
};
