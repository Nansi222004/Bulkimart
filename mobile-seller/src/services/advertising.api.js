import { api } from './apiClient';

// Contracts: backend/routes/advertising.routes.js (seller branch) + services/advertising.service.js,
// advertisingBilling.service.js; frontend/src/components/advertising/advertisingApi.js.
// Mounted at /api/sellers/advertising; requires an approved seller-portal session.
const BASE = '/api/sellers/advertising';
const requireId = (id) => { if (!/^[a-f\d]{24}$/i.test(String(id))) throw new Error('Invalid campaign reference'); return encodeURIComponent(id); };

// → data { managementEnabled, paymentsEnabled, deliveryEnabled, refundsEnabled, blockers[], supportedPlacements, ... }
export async function getAdvertisingCapabilities() {
  const body = await api.get(`${BASE}/capabilities`);
  return body?.data || null;
}

// Active, unarchived packages. packageDTO: { id, name, module, placement, durationDays, maxProducts, version, amountPaise,
// categories[], description, billingQuote{ basePaise, taxPaise, totalPaise } }
export async function listAdvertisingPackages() {
  const body = await api.get(`${BASE}/packages`, { params: { limit: 100 } });
  return Array.isArray(body?.data) ? body.data : [];
}

// Seller products for a storefront: module 'QUICK' | 'ECOMMERCE'.
// → data[{ id, name, image, sku, eligible, reason, categories[], adCategories[{ id, name, parentId, parentName }], variants[] }]
export async function listAdvertisingProducts(module, q) {
  const body = await api.get(`${BASE}/products`, { params: { module, limit: 100, ...(q ? { q } : {}) } });
  return Array.isArray(body?.data) ? body.data : [];
}

// campaignView: { id, name, module, version, packageId, review, funding, delivery, requestedStartAt, terms, paid, pilot,
// history[], category, products[] }
export async function listCampaigns() {
  const body = await api.get(`${BASE}/campaigns`, { params: { limit: 100 } });
  return Array.isArray(body?.data) ? body.data : [];
}
export async function getCampaign(id) {
  const body = await api.get(`${BASE}/campaigns/${requireId(id)}`);
  if (!body?.data) throw new Error('Advertising campaign not found');
  return body.data;
}

// → data { campaign, payment, quote{ basePaise, taxPaise, totalPaise }, paidAuthorization, refund?{ reason, paidPaise, limitPaise, refundedPaise, remainingPaise } }
export async function getCampaignBilling(id) {
  const body = await api.get(`${BASE}/campaigns/${requireId(id)}/billing`);
  return body?.data || null;
}

// services/advertisingTelemetry.service.js advertisingEventSummary:
// → data { from, to, started:boolean, retentionDays, rows[{ mode:'PAID_CATEGORY'|'NON_BILLABLE_PILOT', type:'IMPRESSION'|'CLICK', count }], note }
export async function getCampaignAnalytics(id) {
  const body = await api.get(`${BASE}/campaigns/${requireId(id)}/analytics`);
  if (!body?.data || !Array.isArray(body.data.rows)) throw new Error('Views and clicks are unavailable right now');
  return body.data;
}

// Create a DRAFT. Allowed fields: name, module, categoryId, items[{productId, variantId?}], packageId, requestedStartAt (ISO with offset), requestKey.
export const createCampaign = (input) => api.post(`${BASE}/campaigns`, input);
// Edit while DRAFT / CHANGES_REQUESTED and unpaid. Must carry the current `version`.
export const updateCampaign = (id, input) => api.patch(`${BASE}/campaigns/${requireId(id)}`, input);
// Submit for review, confirming the package version the seller accepted.
export const submitCampaign = (id, version, packageVersion) => api.post(`${BASE}/campaigns/${requireId(id)}/submit`, { version, packageVersion });
// Unpaid, not scheduled → cancel directly.
export const cancelUnpaidCampaign = (id, version, reason) => api.post(`${BASE}/campaigns/${requireId(id)}/actions`, { action: 'cancel', version, ...(reason ? { reason } : {}) });
// Paid or scheduled → cancellation with a reason; the server opens the refund review.
export const cancelPaidCampaign = (id, version, reason) => api.post(`${BASE}/campaigns/${requireId(id)}/cancel`, { version, reason });

// Not used by this app: /campaigns/:id/payment-attempts and /payment-verification (Razorpay).
