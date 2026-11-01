import { api } from './apiClient';

// Contracts: backend/routes/seller.routes.js + frontend/src/modules/Seller/context/SellerContext.jsx.
// Endpoints keep the exact paths, payloads and envelopes used by the web seller panel.

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));
const requireId = (id) => { if (!isObjectId(id)) throw new Error('Invalid record reference'); return encodeURIComponent(id); };

// ---- Profile ----
// { success, seller | null, limits }. A 404 also means there is no seller profile yet.
export const getSellerMe = () => api.get('/api/sellers/me');

const PROFILE_FIELDS = ['name', 'description', 'phone', 'email', 'address', 'city', 'state', 'pincode'];
export const updateSellerProfile = (values, version) => {
  const payload = Object.fromEntries(PROFILE_FIELDS.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]));
  payload.version = version ?? 0;
  return api.put('/api/sellers/profile', payload);
};

// ---- Dashboard ----
// { kpis, byChannel, salesPerformance }. Optional ?type=ecommerce|grocery scopes every figure to one storefront.
// kpis also carry server counts: productCount, liveCount, lowStockCount, outOfStockCount.
export const getDashboard = (type) => api.get('/api/sellers/dashboard', { params: type ? { type } : {} });

// ---- Orders ----
// type: 'ecommerce' | 'grocery' | undefined (all storefronts)
export const listSellerOrders = ({ type, status = 'all', limit = 100 } = {}) =>
  api.get('/api/sellers/orders', { params: { ...(type ? { type } : {}), status, limit } });

export const getSellerOrder = (id) => api.get(`/api/sellers/orders/${requireId(id)}`);

// extra: { version, reason } for cancel/reject; { courier, awb } for a courier dispatch.
export const updateOrderStatus = (id, status, extra = {}) =>
  api.patch(`/api/sellers/orders/${requireId(id)}/status`, { status, ...extra });

export const getOrderFinancialBreakdown = (id) => api.get(`/api/sellers/orders/${requireId(id)}/financial-breakdown`);

// ---- Finance ----
export const getFinanceSummary = () => api.get('/api/sellers/finances/summary');
export const getFinanceLedger = (limit = 50) => api.get('/api/sellers/finances/ledger', { params: { limit } });
export const getTaxStatement = () => api.get('/api/sellers/finances/tax-statement');

// Creates a payout REQUEST. Bulkimart pays it manually; no money moves here.
// idempotencyKey must be reused when retrying the same request.
export const requestPayout = (amount, idempotencyKey) =>
  api.post('/api/sellers/payouts', { amount }, { headers: { 'Idempotency-Key': idempotencyKey } });
