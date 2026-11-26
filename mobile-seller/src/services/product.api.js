import { api } from './apiClient';
import { UPLOAD_TIMEOUT_MS } from '../config/env';

// Contracts: backend/routes/product.routes.js, controllers/product.controller.js,
// and the calls in frontend/src/modules/Seller/context/SellerContext.jsx + ProductModal.jsx.

const isObjectId = (id) => /^[a-f\d]{24}$/i.test(String(id));
const requireId = (id) => { if (!isObjectId(id)) throw new Error('Invalid product reference'); return encodeURIComponent(id); };

// GET /api/products/seller/mine?type=<channel>&roleContext=seller → array or { data | products }
export async function listMyProducts(type) {
  const body = await api.get('/api/products/seller/mine', { params: { ...(type ? { type } : {}), roleContext: 'seller' } });
  return Array.isArray(body) ? body : (body?.data || body?.products || []);
}

// Public category tree for a channel: [{ _id, name, children: [...] }]
export async function getCategoryTree(type) {
  const body = await api.get('/api/categories/tree', { params: { type }, skipAuth: true });
  return Array.isArray(body) ? body : (body?.data || []);
}

// The details a seller fills in for this category (Admin-configured, inherited from parent categories):
// [{ code, label, fieldType, options, required, isVariant, unit, helpText, group, … }].
export async function getCategoryFields(categoryId) {
  const body = await api.get('/api/catalog/fields', { params: { category: categoryId }, skipAuth: true });
  return Array.isArray(body?.data?.fields) ? body.data.fields : [];
}

// { success, data: { eligible:boolean, returnWindowDays, source:'category'|'global' } }
export async function getCategoryReturnPolicy(categoryId) {
  const body = await api.get('/api/products/category-return-policy', { params: { categoryId } });
  if (body?.success === false || typeof body?.data?.eligible !== 'boolean') throw new Error('Unable to check category policy');
  return body.data;
}

// Multipart requests. Content-Type is set so React Native adds the boundary;
// transformRequest stops axios from serialising the FormData.
const multipart = (onProgress) => ({
  timeout: UPLOAD_TIMEOUT_MS,
  headers: { 'Content-Type': 'multipart/form-data' },
  transformRequest: (data) => data,
  onUploadProgress: onProgress
    ? (event) => { if (event.total) onProgress(Math.min(1, event.loaded / event.total)); }
    : undefined,
});

// POST /api/products → { product }
export const createProduct = (formData, onProgress) => api.post('/api/products', formData, multipart(onProgress));

// POST /api/catalog/uploads (kind=image|file) → { url }: a file for an image/file category field or a variant photo.
export async function uploadCatalogFile(doc, kind = 'image') {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', { uri: doc.uri, name: doc.name || (kind === 'image' ? 'photo.jpg' : 'document.pdf'), type: doc.type || (kind === 'image' ? 'image/jpeg' : 'application/pdf') });
  const body = await api.post('/api/catalog/uploads', fd, multipart());
  if (!body?.data?.url) throw new Error(body?.message || 'Upload failed');
  return body.data.url;
}

// POST /api/products/media/video (field "video", MP4) → { data: { url, durationSec } }. The video is stored on
// Bulkimart's server; the product form then sends the URL in `videos`.
export async function uploadProductVideo(video, onProgress) {
  const fd = new FormData();
  fd.append('video', { uri: video.uri, name: video.name, type: 'video/mp4' });
  const body = await api.post('/api/products/media/video', fd, multipart(onProgress));
  if (!body?.data?.url) throw new Error(body?.message || 'Video upload failed');
  return body.data;
}

// Bulk upload (backend/controllers/bulkProduct.controller.js). mode: 'ecommerce' | 'quick'.
// GET /api/products/bulk/template-link → { path }: a signed 10-minute download link (no login header needed),
// opened in the phone's browser so the .xlsx lands in Downloads.
export async function getBulkTemplateLink(mode) {
  const body = await api.get('/api/products/bulk/template-link', { params: { mode } });
  if (!body?.path) throw new Error(body?.message || 'Could not create the template link');
  return body.path;
}

// POST /api/products/bulk/upload (excelFile, optional zipFile) →
// { successCount, failedCount, pendingCount, totalRows, products, errors }. A 400 carries body.meta.errors per row.
export function uploadBulkProducts(mode, sheet, zip, onProgress) {
  const fd = new FormData();
  fd.append('mode', mode);
  fd.append('excelFile', { uri: sheet.uri, name: sheet.name, type: sheet.type });
  if (zip) fd.append('zipFile', { uri: zip.uri, name: zip.name, type: zip.type });
  return api.post(`/api/products/bulk/upload?mode=${encodeURIComponent(mode)}`, fd, multipart(onProgress));
}

// PUT /api/products/:id. Attaching any image replaces the whole photo set; no images keeps the existing ones.
export const updateProduct = (id, formData, onProgress) => api.put(`/api/products/${requireId(id)}`, formData, multipart(onProgress));

// DELETE /api/products/:id (server soft-delete, ownership-checked)
export const deleteProduct = (id) => api.delete(`/api/products/${requireId(id)}`);

// Which delivery methods the product form may offer (Easy Ship / Self Delivery / FBB). null = not shown.
export const getDeliveryMethodOptions = () => api.get('/api/products/seller/delivery-methods')
  .then((body) => body?.data || null).catch(() => null);

// GET /api/products/:id/stock-history → { data: [{ reason, delta, stockAfter, variantName, createdAt }] }
export const getStockHistory = (id) => api.get(`/api/products/${requireId(id)}/stock-history`).then((body) => (Array.isArray(body?.data) ? body.data : []));

// PATCH /api/products/:id/stock { delta, variantId? } → { stock, product }. Atomic $inc on the server on that
// variant (the first one when variantId is omitted). 409 means stock changed in between.
export const adjustProductStock = (id, delta, variantId) => api.patch(`/api/products/${requireId(id)}/stock`, variantId ? { delta, variantId } : { delta });

// PATCH /api/products/:id/wholesale-pricing { variants:[{variantId, wholesalePricing}], version }
// → { success, message, variants, version }. 409 = product changed since it was loaded.
// Retail prices and the shared stock are not touched (services/sellerWholesaleOffers.service.js).
export const saveWholesalePricing = (id, variants, version) => api.patch(
  `/api/products/${requireId(id)}/wholesale-pricing`,
  { variants, version },
);
