import { api } from './apiClient';

// Contracts: backend/routes/seller.routes.js (returns) + controllers/return.controller.js,
// and frontend SellerReturnsTab.jsx / ReturnPickupPanel.jsx.

const requireId = (id) => { if (!/^[a-f\d]{24}$/i.test(String(id))) throw new Error('Invalid return reference'); return encodeURIComponent(id); };

// GET /api/sellers/returns?limit=100&page=&status=A,B → { data[], meta{ pages, statusCounts } }
// Reads every page, the same as the web list.
export async function listSellerReturns(statusFilter) {
  let page = 1; let pages = 1; const rows = []; let statusCounts = null;
  do {
    const body = await api.get('/api/sellers/returns', { params: { limit: 100, page, ...(statusFilter && statusFilter !== 'all' ? { status: statusFilter } : {}) } });
    rows.push(...(Array.isArray(body?.data) ? body.data : []));
    statusCounts = body?.meta?.statusCounts || statusCounts;
    pages = Number(body?.meta?.pages) || 1;
    page += 1;
  } while (page <= pages && page <= 20);
  return { rows: [...new Map(rows.map((r) => [String(r._id), r])).values()], statusCounts };
}

export async function getSellerReturn(id) {
  const body = await api.get(`/api/sellers/returns/${requireId(id)}`);
  if (!body?.data) throw new Error(body?.message || 'Could not load this return');
  return body.data;
}

// POST /decision { decision: 'APPROVED'|'REJECTED', rejectionReason }
export const decideReturn = (id, decision, rejectionReason = '') =>
  api.post(`/api/sellers/returns/${requireId(id)}/decision`, { decision, rejectionReason });

// GET /pickup-options → data { stateReady, stateReason, manual{available,reason,eligibleRiderCount,riders[{id,name,contact,availability,distanceKm}]}, shiprocket{available}, pickup, drop }
export async function getReturnPickupOptions(id) {
  const body = await api.get(`/api/sellers/returns/${requireId(id)}/pickup-options`);
  return body?.data || null;
}

// POST /pickup { pickupMethod: 'MANUAL'|'SHIPROCKET', riderId? }. SHIPROCKET books a real reverse pickup.
export const selectReturnPickup = (id, pickupMethod, riderId) =>
  api.post(`/api/sellers/returns/${requireId(id)}/pickup`, { pickupMethod, ...(pickupMethod === 'MANUAL' ? { riderId } : {}) }, { timeout: 45000 });

export const refreshReturnCourier = (id) => api.post(`/api/sellers/returns/${requireId(id)}/pickup/refresh`);
export const cancelReturnPickup = (id) => api.post(`/api/sellers/returns/${requireId(id)}/pickup/cancel`);
export const markReturnReceived = (id) => api.post(`/api/sellers/returns/${requireId(id)}/mark-received`);
