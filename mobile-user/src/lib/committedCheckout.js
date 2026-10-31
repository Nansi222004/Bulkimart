// Port of frontend/src/utils/committedCheckout.js — a locator only. Ownership, order and payment state come from the server.
import { local } from './storage';
const prefix = 'bulkimart:committed-checkout:';
const valid = row => row?.version === 1 && typeof row.customerId === 'string'
  && ['single', 'unified', 'digital'].includes(row.operation)
  && typeof row.key === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(row.key);

export function committedCheckouts(customerId) {
  if (!customerId) return [];
  try {
    const rows = JSON.parse(local.getItem(prefix + customerId) || '[]');
    return Array.isArray(rows) ? rows.filter(row => valid(row) && row.customerId === String(customerId)) : [];
  } catch { return []; }
}

export function rememberCommittedCheckout(customerId, operation, key) {
  const row = { version: 1, customerId: String(customerId), operation, key };
  if (!customerId || !valid(row)) throw new Error('Checkout recovery reference is unavailable.');
  const rows = committedCheckouts(customerId);
  if (!rows.some(saved => saved.key === key)) rows.push(row);
  // If durable storage is disabled, keep the in-flight session key instead of
  // silently claiming that refresh recovery has been saved.
  local.setItem(prefix + customerId, JSON.stringify(rows));
}

export function forgetCommittedCheckout(customerId, key) {
  const rows = committedCheckouts(customerId).filter(row => row.key !== key);
  if (rows.length) local.setItem(prefix + customerId, JSON.stringify(rows));
  else local.removeItem(prefix + customerId);
}

// Keep recovery available in My Orders without blocking a different basket.
export function deferCommittedCheckout(customerId, key) {
  const rows = committedCheckouts(customerId).map(row => row.key === key ? { ...row, deferred: true } : row);
  local.setItem(prefix + customerId, JSON.stringify(rows));
}

export function resolvedCommittedPayment(payment) {
  return payment && ['online', 'cod', 'wallet'].includes(payment.method) && payment.reconciliationRequired === false
    && (payment.orderStatus === 'cancelled' || payment.method !== 'online' || ['paid', 'failed', 'refunded', 'partial_refund'].includes(payment.status));
}
