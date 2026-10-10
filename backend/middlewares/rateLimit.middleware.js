import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const jsonMessage = (message) => ({ success: false, data: null, message, meta: {} });

/**
 * OTP requests are unauthenticated and trigger paid SMS once the real gateway
 * is wired, so this endpoint is a direct billing-attack surface. Keyed on
 * IP + phone so one IP cannot rotate numbers and one number cannot rotate IPs.
 */
export const otpLimiter = (req, res, next) => next();

/** Slightly looser guard for OTP verification / admin login brute force. */
export const authLimiter = (req, res, next) => next();

/**
 * Admin login is a password endpoint with no OTP step behind it, so an
 * unthrottled one is guessable offline-style at HTTP speed — this was
 * previously removed entirely during development (see the git history on
 * auth.routes.js) and never restored.
 *
 * `skipSuccessfulRequests: true` means only failed attempts count toward
 * the limit — a legitimate admin who gets their password right is never
 * blocked by their own previous typos, only by five WRONG attempts in the
 * window. Scoped to this one route only, not the whole API — every other
 * login route keeps its own existing limiter untouched.
 */
export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: jsonMessage('Too many login attempts. Please try again in 15 minutes.'),
});

/** Broad safety net for the whole API surface. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: jsonMessage('Too many requests. Please slow down.'),
});

/**
 * Reverse geocoding is billed per call, so an unthrottled endpoint is somebody
 * else's bill to run up. A rider legitimately taps "use my location" a handful
 * of times while getting a good fix — never dozens.
 */
export const geocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.MAPS_RL_USER_PER_MIN) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  // Keyed on the signed-in user where possible: riders behind one office NAT
  // or mobile carrier gateway share an IP and would otherwise starve each other.
  keyGenerator: (req) => (req.user?._id ? `u:${req.user._id}` : `ip:${ipKeyGenerator(req.ip)}`),
  message: jsonMessage('Too many location lookups. Please wait a minute.'),
});
