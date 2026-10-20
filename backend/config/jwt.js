/**
 * Single source of truth for the JWT signing/verification secret.
 *
 * No fallback, in any environment — a hardcoded default secret meant anyone
 * who could read this repo could mint a valid token for any account,
 * including admin. Failing at import time (rather than only in production,
 * and rather than only the first time a token is verified) means a missing
 * secret is caught the moment the process starts, not the first time a
 * customer tries to log in.
 *
 * Every place that previously called `jwt.sign`/`jwt.verify` with
 * `process.env.JWT_SECRET || "<default>"` now imports JWT_SECRET from here
 * instead — see auth.controller.js, middlewares/auth.middleware.js,
 * socket/socket.js.
 */
import './environment.js';
import jwt from 'jsonwebtoken';

const secret = process.env.JWT_SECRET;

if (!secret || !secret.trim()) {
  console.error(JSON.stringify({ event: 'jwt_configuration_error', code: 'AUTH_CONFIGURATION_MISSING', instance: process.pid }));
  throw new Error(
    'JWT_SECRET is not set. Configure a strong secret in the environment before starting the server — see .env.example.'
  );
}

export const JWT_SECRET = secret;
// HS256 is jsonwebtoken's existing signing default. Pin both sides explicitly
// without changing keys, claims, expiry policy, or requiring issuer migrations.
export const JWT_ALGORITHM = 'HS256';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';
export const signSessionToken = payload => jwt.sign(payload, JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: JWT_EXPIRES_IN });
export const verifySessionToken = token => jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });

export default JWT_SECRET;
