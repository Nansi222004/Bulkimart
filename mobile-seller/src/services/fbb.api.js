import { api } from './apiClient';

// Fulfilled by Bulkimart. Contracts: backend/routes/seller.routes.js (/api/sellers/fbb…) and
// backend/routes/product.routes.js (/api/products/seller/fbb-charges, /api/products/:id/fbb-conversion).

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));

// Warehouse stock and receipts (read only), charges, what is owed, current rates; `active` decides whether the menu shows it.
export const getSellerFbb = () => api.get('/api/sellers/fbb').then((body) => body?.data || null);

// Rates in force (+ any scheduled change) and whether FBB is ready, shown before choosing FBB.
export const getFbbChargePreview = () => api.get('/api/products/seller/fbb-charges').then((body) => body?.data || null);

// One-way conversion of an existing listing; the server refuses a stale charge version or open seller-fulfilled orders.
export const convertToFbb = async (productId, acceptedChargeVersion) => {
  if (!isObjectId(productId)) throw new Error('Invalid product reference');
  const body = await api.post(`/api/products/${encodeURIComponent(productId)}/fbb-conversion`, { confirm: true, acceptedChargeVersion });
  return body?.data;
};

// Pay (part of) what is owed in advance; returns { status, checkout } for Razorpay.
export const startFbbPayment = (amount) => api.post('/api/sellers/fbb/payments', { amount }).then((body) => body?.data);

const BASIS = { per_unit: 'per unit', per_order: 'per order' };
const rupee = (n) => `₹${Number(n || 0).toFixed(2)}`;

/** The FBB rates as readable lines, for alerts and cards. */
export const describeFbbRates = (preview) => {
  const r = preview?.current;
  if (!r) return 'No FBB charges are set at the moment.';
  return [
    `Storage: ${rupee(r.storage.amount)} ${BASIS[r.storage.basis]} (once, when the warehouse accepts each unit)`,
    `Packaging: ${rupee(r.packaging.amount)} ${BASIS[r.packaging.basis]} (when the order is packed)`,
    `Fulfilment: ${rupee(r.fulfillment.amount)} ${BASIS[r.fulfillment.basis]} (when the order leaves the warehouse)`,
    preview.upcoming ? `New rates (version ${preview.upcoming.version}) apply from ${new Date(preview.upcoming.effectiveFrom).toLocaleDateString('en-IN')}.` : null,
    'Charges are taken from your earnings before payout.',
    preview.taxNote,
  ].filter(Boolean).join('\n');
};

// "I've sent stock": tell Bulkimart what is on its way (information only; stock comes from the warehouse count).
// Reuse the same idempotencyKey when retrying one submit so it is recorded once.
export const sendFbbShipment = (payload) => api.post('/api/sellers/fbb/shipments', payload).then((body) => body?.data);

// Withdraw a shipment notice sent by mistake (only before the warehouse counts it).
export const cancelFbbShipment = (shipmentId) => {
  if (!isObjectId(shipmentId)) return Promise.reject(new Error('Invalid shipment reference'));
  return api.post(`/api/sellers/fbb/shipments/${encodeURIComponent(shipmentId)}/cancel`, {}).then((body) => body?.data);
};
