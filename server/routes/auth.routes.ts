import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { db, withTransaction, type Db } from '../db.ts';
import { fail, HttpError } from '../errors.ts';
import { asyncHandler, validateBody } from '../middleware/validate.ts';
import { generateToken, requireAuth, requireAdmin, type AuthRequest } from '../middleware/auth.ts';
import { writeAudit } from '../services/audit.ts';
import { sendEmail } from '../services/email.ts';
import { env } from '../env.ts';

export const authRouter = Router();

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  invite_token: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

const inviteSchema = z.object({
  email: z.string().trim().email('Valid email is required'),
  lab_ids: z.array(z.coerce.number().int().positive()).min(1, 'At least one laboratory must be selected'),
});

// Five failed logins per email in 15 minutes locks that email out for the remainder of the window.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const failedLogins = new Map<string, { count: number; first: number }>();

function loginLocked(email: string): boolean {
  const entry = failedLogins.get(email);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    failedLogins.delete(email);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordFailure(email: string) {
  const entry = failedLogins.get(email);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
    failedLogins.set(email, { count: 1, first: Date.now() });
  } else {
    entry.count++;
  }
}

export function resetLoginLimits() {
  failedLogins.clear();
}

async function invitationStatus(queryable: Db, token: string) {
  const res = await queryable.query(
    `SELECT id, email, lab_ids, expires_at, accepted_at FROM invitations WHERE token = $1`,
    [token]
  );
  const invite = res.rows[0];
  if (!invite) return { invite: null, code: 'INVALID_INVITATION', message: 'This invitation link is not valid.' };
  if (invite.accepted_at) return { invite, code: 'INVITATION_USED', message: 'This invitation has already been used.' };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { invite, code: 'INVITATION_EXPIRED', message: 'This invitation has expired. Ask the lab head for a new one.' };
  }
  return { invite, code: null, message: null };
}

// GET /api/auth/status
authRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const countRes = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');
    const count = countRes.rows[0].count;
    res.json({ has_admin: count > 0, user_count: count });
  })
);

// GET /api/auth/invitations/:token - the signup page uses this to prefill and lock the email.
authRouter.get(
  '/invitations/:token',
  asyncHandler(async (req, res) => {
    const status = await invitationStatus(db, req.params.token);
    if (status.code) {
      res.status(404).json({ error: { code: status.code, message: status.message } });
      return;
    }
    const labs = await db.query(
      'SELECT id, name, code, department FROM labs WHERE id = ANY($1::int[]) ORDER BY name',
      [status.invite!.lab_ids]
    );
    res.json({ email: status.invite!.email, expires_at: status.invite!.expires_at, labs: labs.rows });
  })
);

// POST /api/auth/signup
authRouter.post(
  '/signup',
  validateBody(signupSchema),
  asyncHandler(async (req, res) => {
    const { name, email, password, invite_token } = req.body as z.infer<typeof signupSchema>;
    const cleanEmail = email.toLowerCase();
    const passwordHash = await bcrypt.hash(password, 10);

    const user = await withTransaction(async (tx) => {
      // Serialises signups so two people cannot both become the first administrator.
      await tx.query('SELECT pg_advisory_xact_lock(7001)');
      const count = await tx.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM users');

      const taken = await tx.query('SELECT 1 FROM users WHERE email = $1', [cleanEmail]);
      if (taken.rows.length > 0) fail(409, 'EMAIL_IN_USE', 'An account with this email address already exists.');

      if (count.rows[0].count === 0) {
        const created = await tx.query(
          `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id, name, email, role`,
          [name, cleanEmail, passwordHash]
        );
        await writeAudit(tx, { actorId: Number(created.rows[0].id), action: 'user.signup', entityType: 'user', entityId: created.rows[0].id, newValue: { role: 'admin' } });
        return created.rows[0];
      }

      if (!invite_token) {
        fail(400, 'INVITATION_REQUIRED', 'Registration requires a valid staff invitation from a laboratory administrator.');
      }
      const status = await invitationStatus(tx, invite_token);
      if (status.code) fail(400, status.code, status.message!);
      const invite = status.invite!;
      if (invite.email.toLowerCase() !== cleanEmail) {
        fail(400, 'INVITATION_EMAIL_MISMATCH', 'This invitation was issued to a different email address.');
      }

      const created = await tx.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'staff') RETURNING id, name, email, role`,
        [name, cleanEmail, passwordHash]
      );
      const userId = Number(created.rows[0].id);
      for (const labId of invite.lab_ids as number[]) {
        await tx.query('INSERT INTO lab_members (lab_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [labId, userId]);
      }
      await tx.query('UPDATE invitations SET accepted_at = NOW() WHERE id = $1', [invite.id]);
      await writeAudit(tx, {
        actorId: userId,
        action: 'user.signup',
        entityType: 'user',
        entityId: userId,
        newValue: { role: 'staff', labs: invite.lab_ids },
      });
      return created.rows[0];
    });

    const authUser = { id: Number(user.id), name: user.name, email: user.email, role: user.role };
    res.status(201).json({ user: authUser, token: generateToken(authUser) });
  })
);

// POST /api/auth/login
authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const cleanEmail = email.toLowerCase();

    if (loginLocked(cleanEmail)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-in attempts. Try again in 15 minutes.');
    }

    const userRes = await db.query('SELECT id, name, email, password_hash, role FROM users WHERE email = $1', [cleanEmail]);
    const user = userRes.rows[0];
    const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!valid) {
      recordFailure(cleanEmail);
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email address or password.');
    }
    failedLogins.delete(cleanEmail);

    const authUser = { id: Number(user.id), name: user.name, email: user.email, role: user.role };
    res.json({ user: authUser, token: generateToken(authUser) });
  })
);

// GET /api/auth/me
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = req.user!;
    const labs = user.role === 'admin'
      ? await db.query('SELECT id, name, code, department, location FROM labs ORDER BY name')
      : await db.query(
          `SELECT l.id, l.name, l.code, l.department, l.location FROM labs l
           JOIN lab_members lm ON lm.lab_id = l.id WHERE lm.user_id = $1 ORDER BY l.name`,
          [user.id]
        );
    res.json({ user, accessible_labs: labs.rows.map((row) => ({ ...row, id: Number(row.id) })) });
  })
);

// POST /api/auth/invite (admin)
authRouter.post(
  '/invite',
  requireAuth,
  requireAdmin,
  validateBody(inviteSchema),
  asyncHandler(async (req: AuthRequest, res) => {
    const { email, lab_ids } = req.body as z.infer<typeof inviteSchema>;
    const cleanEmail = email.toLowerCase();
    const labCheck = await db.query('SELECT id, name FROM labs WHERE id = ANY($1::int[])', [lab_ids]);
    if (labCheck.rows.length !== new Set(lab_ids).size) {
      fail(400, 'VALIDATION_ERROR', 'lab_ids: One of the selected laboratories no longer exists.');
    }
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await withTransaction(async (tx) => {
      const res = await tx.query(
        `INSERT INTO invitations (token, email, lab_ids, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, token, email, lab_ids, expires_at, created_at`,
        [token, cleanEmail, [...new Set(lab_ids)], req.user!.id, expiresAt]
      );
      await writeAudit(tx, {
        actorId: req.user!.id,
        action: 'invitation.create',
        entityType: 'invitation',
        entityId: res.rows[0].id,
        newValue: { email: cleanEmail, lab_ids },
      });
      return res.rows[0];
    });

    const inviteUrl = `${env.appUrl}/signup?invite=${token}`;
    const emailed = await sendEmail(
      cleanEmail,
      'You are invited to StockSense',
      `You have been invited to join StockSense. Create your account here (valid for 7 days): ${inviteUrl}`
    );
    res.status(201).json({ invitation: { ...invitation, id: Number(invitation.id) }, invite_url: inviteUrl, emailed });
  })
);
