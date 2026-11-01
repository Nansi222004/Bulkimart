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

// PUT /api/products/:id. Attaching any image replaces the whole photo set; no images keeps the existing ones.
export const updateProduct = (id, formData, onProgress) => api.put(`/api/products/${requireId(id)}`, formData, multipart(onProgress));

// DELETE /api/products/:id (server soft-delete, ownership-checked)
export const deleteProduct = (id) => api.delete(`/api/products/${requireId(id)}`);

// PATCH /api/products/:id/stock { delta } → { stock, product }. Atomic $inc on the server,
// which applies to the first variant. 409 means stock changed in between.
export const adjustProductStock = (id, delta) => api.patch(`/api/products/${requireId(id)}/stock`, { delta });

// PATCH /api/products/:id/wholesale-pricing { variants:[{variantId, wholesalePricing}], version }
// → { success, message, variants, version }. 409 = product changed since it was loaded.
// Retail prices and the shared stock are not touched (services/sellerWholesaleOffers.service.js).
export const saveWholesalePricing = (id, variants, version) => api.patch(
  `/api/products/${requireId(id)}/wholesale-pricing`,
  { variants, version },
);
