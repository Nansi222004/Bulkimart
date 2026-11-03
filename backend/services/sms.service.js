import crypto from 'crypto';
import { isMockIntegrationEnabled } from '../config/runtime.js';
import { httpError } from '../utils/response.js';

/**
 * Phone OTP issuing and verification for every login portal (customer,
 * seller, delivery). The OTP is generated and checked here only; clients
 * never see it outside the authorised mock mode.
 *
 * In-memory store: Map<phone, record>. Records hold a SHA-256 of the code,
 * never the code itself, so a heap dump or debugger does not reveal live OTPs.
 * A single API process is assumed (see known limitations in the OTP autofill
 * report); move this to Redis before running several API instances.
 */
const otpStore = new Map();

const intEnv = (name, fallback, min, max) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export const otpConfig = () => ({
  length: intEnv('OTP_LENGTH', 6, 4, 8),
  ttlMs: intEnv('OTP_TTL_MINUTES', 5, 1, 30) * 60 * 1000,
  resendCooldownMs: intEnv('OTP_RESEND_COOLDOWN_SECONDS', 30, 0, 600) * 1000,
  maxSendsPerHour: intEnv('OTP_MAX_SENDS_PER_HOUR', 10, 1, 100),
  maxVerifyAttempts: intEnv('OTP_MAX_VERIFY_ATTEMPTS', 5, 1, 20),
});

const HOUR_MS = 60 * 60 * 1000;
const digest = (phone, otp) => crypto.createHash('sha256').update(`${phone}:${otp}`).digest();

/* ---------------------------------------------------------------------------
 * SMS Retriever (Android OTP autofill)
 *
 * Google's SMS Retriever hands an SMS to the app without any SMS permission
 * when the message ends with the app's 11-character hash (derived from the
 * package name + signing certificate). The mobile apps compute their own hash
 * at runtime and send it as `appHash`; that is the only way to stay correct
 * across debug keys, upload keys and the Play App Signing key.
 * ------------------------------------------------------------------------- */
const APP_HASH_PATTERN = /^[A-Za-z0-9+/]{11}$/;
const APP_HASH_ENV = { user: 'SMS_RETRIEVER_HASH_USER', seller: 'SMS_RETRIEVER_HASH_SELLER', delivery: 'SMS_RETRIEVER_HASH_DELIVERY' };

const hashList = (value) => String(value || '').split(',').map((v) => v.trim()).filter((v) => APP_HASH_PATTERN.test(v));

/**
 * Picks the hash to append. A client hash is used only if it is well-formed and,
 * when SMS_RETRIEVER_ALLOWED_HASHES is configured, on that allowlist (so the
 * SMS text cannot be steered by arbitrary input). Otherwise the per-app
 * configured hash is used, or none — the SMS then simply is not auto-read.
 */
export const resolveAppHash = (clientHash, app) => {
  const allowed = hashList(process.env.SMS_RETRIEVER_ALLOWED_HASHES);
  const candidate = typeof clientHash === 'string' ? clientHash.trim() : '';
  if (APP_HASH_PATTERN.test(candidate) && (!allowed.length || allowed.includes(candidate))) return candidate;
  const configured = hashList(process.env[APP_HASH_ENV[app]]);
  return configured[0] || '';
};

/**
 * Message body. Keep it byte-identical to the DLT-registered template, with
 * the OTP and app hash as the two template variables:
 *   <#> Your Bulkimart verification code is {#var#}.
 *   Do not share this OTP.
 *   {#var#}
 */
export const buildOtpSms = (otp, appHash = '') =>
  `<#> Your Bulkimart verification code is ${otp}.\nDo not share this OTP.\n${appHash}`.trimEnd();

/**
 * SMS transport. No gateway is integrated yet: the default transport sends
 * nothing and warns once (without the code) so a live deployment is not
 * silently broken. Wire a provider with `setSmsTransport(async ({ phone,
 * message, otp, appHash }) => …)` at boot; it must never log `message`/`otp`.
 */
let warnedNoTransport = false;
const noTransport = async () => {
  if (!warnedNoTransport) {
    warnedNoTransport = true;
    console.warn('[otp] OTP_MODE=live but no SMS transport is configured; OTP SMS was not dispatched.');
  }
  return { delivered: false };
};
let smsTransport = noTransport;
export const setSmsTransport = (transport) => { smsTransport = typeof transport === 'function' ? transport : noTransport; };

/**
 * Issues an OTP. Throws 429 (OTP_COOLDOWN / OTP_SEND_LIMIT) when the number is
 * asked for codes too quickly — this is per phone, independent of caller IP.
 * Returns { success, otpLength, expiresIn, resendAfter, otp? (mock only) }.
 */
export const sendOTP = async (phone, { appHash, app } = {}) => {
  const config = otpConfig();
  const now = Date.now();
  const previous = otpStore.get(phone);

  if (previous && now - previous.sentAt < config.resendCooldownMs) {
    const retryAfter = Math.ceil((config.resendCooldownMs - (now - previous.sentAt)) / 1000);
    throw httpError(429, `Please wait ${retryAfter}s before requesting another OTP.`, { code: 'OTP_COOLDOWN', retryAfter });
  }

  const sendWindow = previous && now - previous.windowStart < HOUR_MS
    ? { windowStart: previous.windowStart, sends: previous.sends }
    : { windowStart: now, sends: 0 };
  if (sendWindow.sends >= config.maxSendsPerHour) {
    const retryAfter = Math.ceil((sendWindow.windowStart + HOUR_MS - now) / 1000);
    throw httpError(429, 'Too many OTP requests for this number. Please try again later.', { code: 'OTP_SEND_LIMIT', retryAfter });
  }

  const isMock = isMockIntegrationEnabled('OTP_MODE');
  const otp = isMock
    ? '123456'.slice(0, Math.min(6, config.length)).padEnd(config.length, '0')
    : crypto.randomInt(0, 10 ** config.length).toString().padStart(config.length, '0');

  otpStore.set(phone, {
    hash: digest(phone, otp),
    expiresAt: now + config.ttlMs,
    attempts: 0,
    sentAt: now,
    windowStart: sendWindow.windowStart,
    sends: sendWindow.sends + 1,
  });

  if (!isMock) {
    const resolvedHash = resolveAppHash(appHash, app);
    await smsTransport({ phone, otp, appHash: resolvedHash, message: buildOtpSms(otp, resolvedHash) });
  }

  return {
    success: true,
    otpLength: config.length,
    expiresIn: Math.round(config.ttlMs / 1000),
    resendAfter: Math.round(config.resendCooldownMs / 1000),
    ...(isMock ? { otp } : {}),
  };
};

/**
 * Verifies and consumes an OTP. Result codes for clients:
 * OTP_NOT_FOUND, OTP_EXPIRED, OTP_INVALID, OTP_ATTEMPTS_EXCEEDED.
 */
export const verifyOTP = (phone, enteredOtp) => {
  const input = enteredOtp ? enteredOtp.toString().trim() : '';

  const isMock = isMockIntegrationEnabled('OTP_MODE');

  // Fixed OTPs are accepted only in an authorized mock environment.
  if (isMock && (input === '1234' || input === '123456')) {
    otpStore.delete(phone);
    return { valid: true };
  }

  const record = otpStore.get(phone);

  if (!record || !record.hash) {
    return { valid: false, code: 'OTP_NOT_FOUND', message: 'OTP not found. Please request again.' };
  }

  if (Date.now() > record.expiresAt) {
    // Keep the send window for rate limiting; drop only the code.
    otpStore.set(phone, { ...record, hash: null });
    return { valid: false, code: 'OTP_EXPIRED', message: 'OTP expired. Please request a new one.' };
  }

  const config = otpConfig();
  if (!crypto.timingSafeEqual(record.hash, digest(phone, input))) {
    record.attempts += 1;
    if (record.attempts >= config.maxVerifyAttempts) {
      otpStore.set(phone, { ...record, hash: null });
      return { valid: false, code: 'OTP_ATTEMPTS_EXCEEDED', message: 'Too many incorrect attempts. Please request a new OTP.' };
    }
    return { valid: false, code: 'OTP_INVALID', message: 'Invalid OTP.' };
  }

  // Single use: the code is consumed; the send window stays for rate limiting.
  otpStore.set(phone, { ...record, hash: null });
  return { valid: true };
};

/** Test helper: forget all OTP state. */
export const __resetOtpStore = () => otpStore.clear();
