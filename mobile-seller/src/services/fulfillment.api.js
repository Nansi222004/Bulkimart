import { api } from './apiClient';

// Contracts: backend/routes/seller.routes.js + frontend OrdersTab.jsx, PickupSyncCard.jsx, OrderInvoices.jsx.

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));
const requireId = (id) => { if (!isObjectId(id)) throw new Error('Invalid order reference'); return encodeURIComponent(id); };

// GET /api/sellers/orders/:id/fulfillment-options →
// data { manual{available,reason,eligibleRiderCount,riders[{id,name,contact,availability,online}]},
//        shiprocket{available,reason,quote{courierCharge},packageWeightKg,pickupLinked,verifiedPickup,activation{blockers},feeCollection{status}}, pickup }
export async function getFulfillmentOptions(orderId) {
  const body = await api.get(`/api/sellers/orders/${requireId(orderId)}/fulfillment-options`);
  if (!body?.data) throw new Error(body?.message || 'Could not evaluate fulfillment options');
  return body.data;
}

// POST /api/sellers/orders/:id/fulfillment/manual { riderId? }. No riderId leaves the offer open to eligible riders.
export const selectManualFulfillment = (orderId, riderId) =>
  api.post(`/api/sellers/orders/${requireId(orderId)}/fulfillment/manual`, riderId ? { riderId } : {});

// POST /api/sellers/orders/:id/fulfillment/shiprocket { confirm:true, package:{length,breadth,height}, quotedCourierCharge }
// Creates a REAL courier shipment. The server re-checks serviceability and the quote.
export const createShiprocketShipment = (orderId, packageSize, quotedCourierCharge) =>
  api.post(`/api/sellers/orders/${requireId(orderId)}/fulfillment/shiprocket`, { confirm: true, package: packageSize, quotedCourierCharge }, { timeout: 45000 });

// Quick Commerce Shiprocket seller fee (backend/controllers/quickShiprocketFee.controller.js).
// GET → data { snapshot, payment }
export async function getShiprocketFee(orderId) {
  const body = await api.get(`/api/sellers/orders/${requireId(orderId)}/shiprocket-fee`);
  return body?.data || {};
}
// POST { confirm:true, reviewedTotal, feeVersion } → data { status, checkout?, snapshot }
export async function startShiprocketFeePayment(orderId, reviewedTotal, feeVersion) {
  const body = await api.post(`/api/sellers/orders/${requireId(orderId)}/shiprocket-fee`, { confirm: true, reviewedTotal, feeVersion }, { timeout: 45000 });
  return body?.data || {};
}

// GET /api/sellers/orders/:id/invoice → data (one server-built invoice)
export async function getOrderInvoice(orderId) {
  const body = await api.get(`/api/sellers/orders/${requireId(orderId)}/invoice`);
  if (body?.success === false || !body?.data) throw new Error(body?.message || 'Could not load the invoice');
  return body.data;
}

// POST /api/sellers/orders/:id/invoice/print-link → data { path, expiresInSeconds }
// A 10-minute signed link to a printable copy, opened in the phone's browser (Print → Save as PDF).
export async function getInvoicePrintLink(orderId) {
  const body = await api.post(`/api/sellers/orders/${requireId(orderId)}/invoice/print-link`, {});
  const path = body?.data?.path;
  if (body?.success === false || typeof path !== 'string' || !path.startsWith('/api/invoice-print/')) throw new Error(body?.message || 'Could not prepare the invoice for printing');
  return path;
}

// Shiprocket pickup registration for the store.
// GET → data { status:'registered'|'pending'|'syncing'|..., message, locationName, registeredAt, shippingApproved, nextAttemptAt }
export async function getPickupSync() {
  const body = await api.get('/api/sellers/pickup-sync');
  return body?.data || null;
}
export const retryPickupSync = () => api.post('/api/sellers/pickup-sync/retry', {});

// Same body the web PickupSyncCard sends: { name, email, phone, address, city, state, pincode }
export const savePickupDetails = (draft) => api.put('/api/sellers/profile', draft);
