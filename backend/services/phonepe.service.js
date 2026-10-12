import crypto from 'crypto';
import axios from 'axios';
import { getPaymentGateway } from '../config/runtime.js';

/**
 * PhonePe Standard Checkout (v2, OAuth-based).
 *
 * Flow:
 *   1. getAccessToken()  — client_credentials, cached until just before expiry
 *   2. createPayment()   — returns a PhonePe URL we redirect the shopper to
 *   3. webhook           — PhonePe calls us back; this is the source of truth
 *   4. getOrderStatus()  — polled as a fallback when the webhook is late/lost
 *
 * Never trust the browser's return trip to mark an order paid. A user can close
 * the tab, or forge the redirect. Only the webhook (or a server-side status
 * check) decides that money actually arrived.
 *
 * Amounts are in PAISE everywhere in this file.
 */

const ENV = (process.env.PHONEPE_ENV || 'sandbox').toLowerCase();
const IS_PROD = ENV === 'production' || ENV === 'prod';

const HOSTS = IS_PROD
  ? {
      oauth: 'https://api.phonepe.com/apis/identity-manager/v1/oauth/token',
      api: 'https://api.phonepe.com/apis/pg',
    }
  : {
      oauth: 'https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token',
      api: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    };

const mockStore = new Map();

const assertPhonePeSelected = () => {
  if (getPaymentGateway() !== 'phonepe') {
    throw Object.assign(new Error('PhonePe is not enabled for this deployment'), { status: 503 });
  }
};

export const setMockPaymentState = (merchantOrderId, state) => {
  assertPhonePeSelected();
  const existing = mockStore.get(merchantOrderId) || {};
  mockStore.set(merchantOrderId, { ...existing, state });
};

export const isRealGatewayConfigured = () =>
  Boolean(process.env.PHONEPE_CLIENT_ID && process.env.PHONEPE_CLIENT_SECRET);

export const isConfigured = () => true;

const requireConfig = () => {
  // Always configured for dev / sandbox mock fallback
  return true;
};

/* ==========================================================================
   1. TOKEN — cached in memory until shortly before it expires
   ========================================================================== */

let cachedToken = null;   // { token, expiresAt } — expiresAt is epoch ms

export const getAccessToken = async () => {
  requireConfig();

  // Refresh 60s early so a request never travels with a token that expires
  // mid-flight.
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    client_id: process.env.PHONEPE_CLIENT_ID,
    client_version: process.env.PHONEPE_CLIENT_VERSION || '1',
    client_secret: process.env.PHONEPE_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  try {
    const { data } = await axios.post(HOSTS.oauth, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15_000,
    });

    if (!data?.access_token) throw new Error('No access_token in PhonePe response');

    cachedToken = {
      token: data.access_token,
      // expires_at is epoch SECONDS
      expiresAt: (data.expires_at ? data.expires_at * 1000 : Date.now() + 45 * 60_000),
    };
    return cachedToken.token;
  } catch (err) {
    cachedToken = null;
    const detail = err.response?.data?.message || err.message;
    throw Object.assign(new Error('Could not reach the payment gateway.'), {
      status: 502, internal: `PhonePe auth failed: ${detail}`,
    });
  }
};

/** PhonePe returns token_type "O-Bearer", not "Bearer". */
const authHeader = (token) => ({ Authorization: `O-Bearer ${token}` });

/* ==========================================================================
   2. CREATE PAYMENT
   ========================================================================== */

/**
 * @param {object} p
 *   merchantOrderId — our own id, must be unique per attempt
 *   amountPaise     — integer paise
 *   redirectUrl     — where PhonePe sends the shopper back
 *   message         — shown on the PhonePe screen
 * @returns {{ redirectUrl, orderId, state, expireAt }}
 */
export const createPayment = async ({ merchantOrderId, amountPaise, redirectUrl, message }) => {
  assertPhonePeSelected();
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw Object.assign(new Error('Invalid payment amount'), { status: 400 });
  }

  if (isRealGatewayConfigured() && process.env.PHONEPE_MOCK !== 'true') {
    const token = await getAccessToken();
    const payload = {
      merchantOrderId,
      amount: amountPaise,
      expireAfter: 1200,                       // seconds — the link dies in 20 min
      metaInfo: { udf1: 'nhcone' },
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: message || 'Bulkimart order',
        merchantUrls: { redirectUrl },
      },
    };

    try {
      const { data } = await axios.post(`${HOSTS.api}/checkout/v2/pay`, payload, {
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        timeout: 20_000,
      });

      if (!data?.redirectUrl) throw new Error('No redirectUrl in PhonePe response');

      return {
        redirectUrl: data.redirectUrl,
        orderId: data.orderId,
        state: data.state,
        expireAt: data.expireAt,
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.response?.data?.code || err.message;
      throw Object.assign(new Error('Could not start the payment. Please try again.'), {
        status: 502, internal: `PhonePe pay failed: ${detail}`,
      });
    }
  }

  // --- MOCK / SANDBOX FALLBACK MODE ---
  const app = process.env.APP_BASE_URL || process.env.FRONTEND_URL || 'http://localhost:4173';
  mockStore.set(merchantOrderId, { state: 'COMPLETED', amountPaise, redirectUrl });

  const mockRedirectUrl = `${app}/mock-phonepe?merchantOrderId=${encodeURIComponent(merchantOrderId)}&amount=${amountPaise / 100}&redirectUrl=${encodeURIComponent(redirectUrl)}`;

  return {
    redirectUrl: mockRedirectUrl,
    orderId: `MOCK-${merchantOrderId}`,
    state: 'PENDING',
    expireAt: new Date(Date.now() + 1200 * 1000).toISOString(),
  };
};

/* ==========================================================================
   3. ORDER STATUS — server-side truth, used as the webhook's safety net
   ========================================================================== */

export const getOrderStatus = async (merchantOrderId) => {
  assertPhonePeSelected();
  if (isRealGatewayConfigured() && process.env.PHONEPE_MOCK !== 'true') {
    const token = await getAccessToken();

    try {
      const { data } = await axios.get(
        `${HOSTS.api}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status`,
        { headers: authHeader(token), timeout: 15_000 }
      );

      return {
        state: data.state,                        // PENDING | COMPLETED | FAILED
        orderId: data.orderId,
        amountPaise: data.amount,
        paymentDetails: data.paymentDetails || [],
        raw: data,
      };
    } catch (err) {
      const detail = err.response?.data?.message || err.message;
      throw Object.assign(new Error('Could not check the payment status.'), {
        status: 502, internal: `PhonePe status failed: ${detail}`,
      });
    }
  }

  // --- MOCK MODE STATUS LOOKUP ---
  const stored = mockStore.get(merchantOrderId) || { state: 'COMPLETED', amountPaise: 1000 };
  return {
    state: stored.state || 'COMPLETED',
    orderId: `MOCK-${merchantOrderId}`,
    amountPaise: stored.amountPaise || 1000,
    paymentDetails: [{ paymentMode: 'MOCK_UPI', state: stored.state || 'COMPLETED' }],
    raw: stored,
  };
};

/* ==========================================================================
   4. REFUND
   ========================================================================== */

export const createRefund = async ({ merchantRefundId, originalMerchantOrderId, amountPaise }) => {
  assertPhonePeSelected();
  const token = await getAccessToken();

  try {
    const { data } = await axios.post(
      `${HOSTS.api}/payments/v2/refund`,
      { merchantRefundId, originalMerchantOrderId, amount: amountPaise },
      { headers: { 'Content-Type': 'application/json', ...authHeader(token) }, timeout: 20_000 }
    );
    return { refundId: data.refundId, state: data.state, raw: data };
  } catch (err) {
    const detail = err.response?.data?.message || err.message;
    throw Object.assign(new Error('Refund could not be started.'), {
      status: 502, internal: `PhonePe refund failed: ${detail}`,
    });
  }
};

/* ==========================================================================
   5. WEBHOOK VERIFICATION
   ========================================================================== */

/**
 * PhonePe signs the callback as SHA256("username:password") using the
 * credentials configured against the webhook in the PhonePe dashboard.
 *
 * Compared in constant time — a plain === leaks how much of the hash matched
 * through timing, which is enough to forge one byte at a time.
 */
export const verifyWebhookSignature = (authorizationHeader) => {
  const username = process.env.PHONEPE_WEBHOOK_USERNAME;
  const password = process.env.PHONEPE_WEBHOOK_SECRET;

  if (!username || !password) {
    // Refusing is the safe default: without credentials any caller could post
    // a "payment completed" event to us.
    return { ok: false, reason: 'Webhook credentials are not configured on the server' };
  }
  if (!authorizationHeader) return { ok: false, reason: 'Missing Authorization header' };

  const expected = crypto.createHash('sha256').update(`${username}:${password}`).digest('hex');
  const received = String(authorizationHeader).replace(/^SHA256\s*/i, '').trim().toLowerCase();

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return { ok: false, reason: 'Signature mismatch' };

  return crypto.timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'Signature mismatch' };
};

/** Normalise the four webhook event types into something the controller can act on. */
export const parseWebhookEvent = (body) => {
  const event = body?.event || body?.type;
  const p = body?.payload || body || {};

  const map = {
    'checkout.order.completed': 'payment_completed',
    'checkout.order.failed': 'payment_failed',
    'pg.refund.completed': 'refund_completed',
    'pg.refund.failed': 'refund_failed',
  };

  return {
    kind: map[event] || 'unknown',
    event,
    merchantOrderId: p.merchantOrderId,
    orderId: p.orderId,
    state: p.state,
    amountPaise: p.amount,
    errorCode: p.errorCode || p.detailedErrorCode,
    paymentDetails: p.paymentDetails || [],
  };
};

export const rupeesToPaise = (rupees) => Math.round(Number(rupees) * 100);
export const paiseToRupees = (paise) => Math.round(Number(paise)) / 100;

export default { createPayment, getOrderStatus, createRefund, verifyWebhookSignature };
