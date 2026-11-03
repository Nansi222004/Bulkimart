import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { normalizePhone } from '../utils/phone.js';

const jsonMessage = (message) => ({ success: false, data: null, message, meta: {} });
export const paymentRecoveryLimiter = rateLimit({ windowMs:60000, limit:30, standardHeaders:true, legacyHeaders:false, keyGenerator:req=>`admin:${req.user._id}`, message:jsonMessage('Too many payment recovery operations. Review status and retry later.') });
export const wholesalePublicLimiter = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false, message: jsonMessage('Too many Wholesale availability requests. Please retry in a minute.') });
export const wholesaleCustomerLimiter = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => `customer:${req.user._id}`, message: jsonMessage('Too many Wholesale price requests. Please retry in a minute.') });

/**
 * OTP requests are unauthenticated and trigger paid SMS once the real gateway
 * is wired, so this endpoint is a direct billing-attack surface. Keyed on
 * IP + canonical phone (so "+91 98…" and "98…" share one bucket). The
 * per-number cap across all IPs (resend cooldown + hourly limit) lives in
 * services/sms.service.js.
 */
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${normalizePhone(req.body?.phone) || String(req.body?.phone || '').trim().slice(0, 32)}`,
  message: jsonMessage('Too many OTP requests. Please try again in 15 minutes.'),
});

/** Slightly looser guard for OTP verification / admin login brute force. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: jsonMessage('Too many verification attempts. Please try again in 15 minutes.'),
});

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
  max: process.env.NODE_ENV === 'development' ? 100 : 5,
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

/**
 * Live chat (after `protect`, so keyed on the signed-in account). Starting a
 * chat notifies every admin, so it is tighter than sending messages.
 */
const chatKey = (req) => (req.user?._id ? `chat:${req.userType}:${req.user._id}` : `chat:ip:${ipKeyGenerator(req.ip)}`);
export const supportChatStartLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, keyGenerator: chatKey,
  message: jsonMessage('Too many new chats. Please continue your existing chat or try again later.'),
});
export const supportChatMessageLimiter = rateLimit({
  windowMs: 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, keyGenerator: chatKey,
  message: jsonMessage('You are sending messages too quickly. Please wait a moment.'),
});
