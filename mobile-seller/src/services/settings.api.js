import { api } from './apiClient';
import { UPLOAD_TIMEOUT_MS } from '../config/env';

// Business settings that already have backend endpoints (backend/controllers/seller.controller.js).

// PATCH /api/sellers/channels { channels: ['ecommerce'|'grocery'] }. Wholesale is approved separately and kept by the server.
export const updateSalesChannels = (channels) => api.patch('/api/sellers/channels', { channels });

// POST /api/sellers/wholesale-request {} → { status, salesChannels }
export const requestWholesaleAccess = () => api.post('/api/sellers/wholesale-request', {});

// PUT /api/sellers/profile, multipart field `sameDay` (JSON), the same as SellerContext.saveSameDaySettings.
// { enabled:false } or { enabled:true, cutoffTime:'HH:MM', radiusKm, availableDays:[0..6] } (parseSellerSameDay).
export function saveShopSameDay(settings) {
  const fd = new FormData();
  fd.append('sameDay', JSON.stringify(settings));
  return api.put('/api/sellers/profile', fd, { headers: { 'Content-Type': 'multipart/form-data' }, transformRequest: (d) => d });
}

// PUT /api/sellers/profile { lat, lng }: the same call the web ProfileTab "Update Location" makes.
// The server validates the pair and stores storeDetails.lat/lng/point with locationSource 'gps'.
export const saveStoreLocation = ({ lat, lng }) => api.put('/api/sellers/profile', { lat, lng });

// GET /api/geo/reverse?lat&lng[&accuracy] → data { address, city, state, pincode, ... }. Display only.
export async function reverseGeocode({ lat, lng, accuracy }) {
  const body = await api.get('/api/geo/reverse', { params: { lat, lng, ...(Number.isFinite(accuracy) ? { accuracy: Math.round(accuracy) } : {}) } });
  return body?.data || null;
}

// PUT /api/sellers/profile multipart `logo` and/or `banner` (images; same uploader as KYC, 5 MB).
export function uploadStoreBranding({ logo, banner }, onProgress) {
  const fd = new FormData();
  if (logo) fd.append('logo', { uri: logo.uri, name: logo.name, type: logo.type });
  if (banner) fd.append('banner', { uri: banner.uri, name: banner.name, type: banner.type });
  return api.put('/api/sellers/profile', fd, {
    timeout: UPLOAD_TIMEOUT_MS,
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (d) => d,
    onUploadProgress: onProgress ? (e) => { if (e.total) onProgress(Math.min(1, e.loaded / e.total)); } : undefined,
  });
}
