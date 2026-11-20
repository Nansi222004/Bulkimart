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
export const buildOtpSms = (otp, appHash = '') => {
  const dlt = smsDltSettings();
  // The registered DLT template (SMS_INDIA_HUB_TEMPLATE_TEXT). The OTP always fills the last ##var##;
  // the slots before it take the app name, then the "powered by" name. Works for templates with two
  // slots ("…##var##…##var##") or three. Must match the registered text exactly or operators reject it.
  if (dlt.templateText) {
    const slots = (dlt.templateText.match(/##var##/g) || []).length;
    const values = [...[dlt.appName, dlt.poweredBy].slice(0, Math.max(0, slots - 1)), otp];
    let slot = 0;
    return dlt.templateText.replace(/##var##/g, () => String(values[slot++] ?? ''));
  }
  return `<#> Your Bulkimart verification code is ${otp}.\nDo not share this OTP.\n${appHash}`.trimEnd();
};

/**
 * DLT (India) registration details of the OTP SMS, from the environment:
 *   SMS_INDIA_HUB_SENDER_ID (header, e.g. BGADPL), SMS_DLT_PE_ID (principal entity),
 *   SMS_INDIA_HUB_DLT_TEMPLATE_ID, SMS_DLT_TEMPLATE_NAME, SMS_INDIA_HUB_TEMPLATE_TEXT (with ##var##),
 *   SMS_OTP_APP_NAME and SMS_OTP_POWERED_BY (the first two ##var## values).
 * The gateway transport sends these alongside the message. None of them is a secret.
 */
export const smsDltSettings = () => ({
  senderId: (process.env.SMS_INDIA_HUB_SENDER_ID || '').trim(),
  peId: (process.env.SMS_DLT_PE_ID || '').trim(),
  templateId: (process.env.SMS_INDIA_HUB_DLT_TEMPLATE_ID || '').trim(),
  templateName: (process.env.SMS_DLT_TEMPLATE_NAME || '').trim(),
  templateText: process.env.SMS_INDIA_HUB_TEMPLATE_TEXT || '',
  appName: (process.env.SMS_OTP_APP_NAME || 'Bulkimart').trim(),
  poweredBy: (process.env.SMS_OTP_POWERED_BY || '').trim(),
});

/**
 * Real SMS sending (each message costs credit) happens only when SMS_USE_LIVE=true. Anything else,
 * including unset, sends nothing: the OTP is still created and checked, so the flow can be tested
 * end to end without spending credit, but nobody receives a code.
 */
export const smsLiveEnabled = () => String(process.env.SMS_USE_LIVE || '').trim().toLowerCase() === 'true';
let warnedNotLive = false;

/**
 * SMS transport. The default is SMS India Hub when it is configured (smsIndiaHubTransport below);
 * otherwise nothing is sent and a warning is logged once (without the code) so a live deployment
 * is not silently broken. Tests replace it with `setSmsTransport(async ({ phone, message, otp,
 * appHash, dlt }) => …)`. A transport must never log `message`/`otp`.
 */
let warnedNoTransport = false;
const noTransport = async () => {
  if (!warnedNoTransport) {
    warnedNoTransport = true;
    console.warn('[otp] OTP_MODE=live but no SMS transport is configured; OTP SMS was not dispatched.');
  }
  return { delivered: false };
};

// SMS India Hub reports success as ErrorCode "000" / "Done"; these are the failures worth naming in logs.
const SMS_INDIA_HUB_ERRORS = { '001': 'account details blank', '003': 'sender blank', '004': 'message blank', '006': 'template mismatch', '007': 'invalid API key', '015': 'invalid sender ID', '021': 'insufficient credit', '024': 'template mismatch' };
/** "91XXXXXXXXXX" for the gateway, from a 10-digit or 91-prefixed Indian mobile number. */
export const smsIndiaHubMsisdn = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits[2])) return digits;
  return null;
};
/**
 * SMS India Hub (vendorsms/pushsms.aspx, GET): APIKey, msisdn, sid (DLT header), msg, fl=0, gwid,
 * DLT_TE_ID (+ templateid) and EntityId (the DLT principal entity / PE ID). Same request as the
 * Olovely Total Suvidha backend uses with this account.
 */
export const smsIndiaHubTransport = async ({ phone, message, dlt = smsDltSettings() }) => {
  const url = (process.env.SMS_INDIA_HUB_URL || '').trim();
  const apiKey = (process.env.SMS_INDIA_HUB_API_KEY || '').trim();
  if (!url || !apiKey || !dlt.senderId || !dlt.templateId) throw httpError(503, 'OTP SMS is not configured. Please try again later.', { code: 'SMS_NOT_CONFIGURED' });
  const msisdn = smsIndiaHubMsisdn(phone);
  if (!msisdn) throw httpError(400, 'Enter a valid 10-digit Indian mobile number.', { code: 'SMS_INVALID_NUMBER' });
  const params = new URLSearchParams({ APIKey: apiKey, msisdn, sid: dlt.senderId, msg: message, fl: '0', gwid: (process.env.SMS_INDIA_HUB_GWID || '2').trim(), DLT_TE_ID: dlt.templateId, templateid: dlt.templateId, ...(dlt.peId ? { EntityId: dlt.peId } : {}) });
  const timeout = Math.min(30000, Math.max(2000, Number.parseInt(process.env.SMS_INDIA_HUB_TIMEOUT_MS || '', 10) || 10000));
  let body;
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}${params}`, { signal: AbortSignal.timeout(timeout) });
    const text = await res.text();
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  } catch {
    console.error('[otp] SMS India Hub unreachable or timed out');
    throw httpError(502, 'Could not send the OTP right now. Please try again.', { code: 'SMS_SEND_FAILED' });
  }
  const code = String(body?.ErrorCode ?? '');
  if (code === '000' || body?.ErrorMessage === 'Done') return { delivered: true, jobId: body.JobId };
  // Only the gateway's code and description: never the number, message, OTP or key.
  console.error(`[otp] SMS India Hub rejected the OTP SMS: ${code || 'no code'} ${SMS_INDIA_HUB_ERRORS[code] || String(body?.ErrorMessage || '').slice(0, 80)}`);
  throw httpError(502, 'Could not send the OTP right now. Please try again.', { code: 'SMS_SEND_FAILED' });
};

const defaultTransport = (payload) => ((process.env.SMS_INDIA_HUB_URL || '').trim() ? smsIndiaHubTransport(payload) : noTransport(payload));
let smsTransport = defaultTransport;
export const setSmsTransport = (transport) => { smsTransport = typeof transport === 'function' ? transport : defaultTransport; };

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
    if (smsLiveEnabled()) {
      try {
        await smsTransport({ phone, otp, appHash: resolvedHash, message: buildOtpSms(otp, resolvedHash), dlt: smsDltSettings() });
      } catch (error) {
        // The code never reached the customer: undo it, so "Resend" works at once instead of
        // waiting out the cooldown for an SMS that was not sent.
        if (previous) otpStore.set(phone, previous); else otpStore.delete(phone);
        throw error;
      }
    } else if (!warnedNotLive) {
      warnedNotLive = true;
      // Never logs the OTP or the message.
      console.warn('[otp] SMS_USE_LIVE is not true: OTP SMS not sent (no SMS credit used). Set SMS_USE_LIVE=true to send.');
    }
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
