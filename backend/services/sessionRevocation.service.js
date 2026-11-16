import crypto from 'node:crypto';
import mongoose from 'mongoose';
import RevokedSession from '../models/RevokedSession.js';
import { verifySessionToken } from '../config/jwt.js';

/**
 * Server-side logout (audit M2/H3). Logging out revokes exactly the presented token: the user's other devices stay
 * signed in, other accounts are unaffected, and the configured token expiry is unchanged. Works for tokens issued
 * before this change too (they are identified by hash, not by a new claim).
 */
export const sessionTokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Without a database connection the caller's own account lookup (protect → User/Admin.findById) cannot succeed
// either, so nothing is let through by skipping; this only avoids a 10 s buffering wait in DB-less unit tests.
export const isSessionRevoked = async (token) => {
  if (mongoose.connection.readyState !== 1) return false;
  return Boolean(await RevokedSession.exists({ tokenHash: sessionTokenHash(token) }));
};

/**
 * Revoke a session token. Only a token with a valid signature is stored (an arbitrary string cannot fill the
 * collection); an invalid or already-expired token needs no revocation. Idempotent.
 */
export const revokeSessionToken = async (token) => {
  let decoded;
  try { decoded = verifySessionToken(token); } catch { return { revoked: false }; }
  if (!decoded || typeof decoded.id !== 'string') return { revoked: false };
  const expiresAt = decoded.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  await RevokedSession.updateOne(
    { tokenHash: sessionTokenHash(token) },
    { $setOnInsert: { subjectId: decoded.id, subjectType: decoded.type === 'admin' ? 'admin' : 'user', revokedAt: new Date(), expiresAt } },
    { upsert: true },
  );
  return { revoked: true };
};
