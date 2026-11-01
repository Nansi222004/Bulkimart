import { api } from './apiClient';
import { UPLOAD_TIMEOUT_MS } from '../config/env';

// Contracts: backend/routes/seller.routes.js + controllers/seller.controller.js (startOnboarding … submitApplication),
// and the chain in frontend/src/modules/Seller/context/SellerContext.jsx::submitSellerApplication.

const multipart = (onProgress) => ({
  timeout: UPLOAD_TIMEOUT_MS,
  headers: { 'Content-Type': 'multipart/form-data' },
  transformRequest: (data) => data,
  onUploadProgress: onProgress ? (e) => { if (e.total) onProgress(Math.min(1, e.loaded / e.total)); } : undefined,
});
const file = (doc) => ({ uri: doc.uri, name: doc.name, type: doc.type });

// POST /api/sellers/start { salesChannels: ['ecommerce'|'grocery', ...] }
export const startOnboarding = (salesChannels) => api.post('/api/sellers/start', { salesChannels });

// PUT /api/sellers/step/1 { businessName, businessType, storeDetails{ name, description, address, landmark, city, state, pincode, phone, email } }
export const submitBusinessStep = (payload) => api.put('/api/sellers/step/1', payload);

// PUT /api/sellers/step/2 multipart: aadhaarNumber, aadhaarFront, aadhaarBack
export function submitAadhaarStep({ aadhaarNumber, front, back }, onProgress) {
  const fd = new FormData();
  fd.append('aadhaarNumber', aadhaarNumber);
  fd.append('aadhaarFront', file(front));
  fd.append('aadhaarBack', file(back));
  return api.put('/api/sellers/step/2', fd, multipart(onProgress));
}

// PUT /api/sellers/step/3 multipart: accountNo, ifsc, holderName, bankName, passbookUrl (file)
export function submitBankStep({ accountNo, ifsc, holderName, bankName, passbook }, onProgress) {
  const fd = new FormData();
  fd.append('accountNo', accountNo);
  fd.append('ifsc', ifsc);
  fd.append('holderName', holderName);
  fd.append('bankName', bankName);
  fd.append('passbookUrl', file(passbook));
  return api.put('/api/sellers/step/3', fd, multipart(onProgress));
}

// PUT /api/sellers/step/4 multipart: pan, gstChoice, gstin? | gstAssistanceConsent, gstContactName, gstAssistanceMessage?,
// pan_card? (file), trade_license? (file). Uploaded files are appended to Seller.documents on the server.
export function submitLegalStep({ pan, gst, panCard, tradeLicense }, onProgress) {
  const fd = new FormData();
  fd.append('pan', pan);
  fd.append('gstChoice', gst.choice);
  if (gst.choice === 'has_gstin') fd.append('gstin', gst.gstin);
  if (gst.choice === 'assistance') {
    fd.append('gstAssistanceConsent', String(gst.consent === true));
    fd.append('gstContactName', gst.contactName);
    fd.append('gstAssistanceMessage', gst.message || '');
  }
  if (panCard) fd.append('pan_card', file(panCard));
  if (tradeLicense) fd.append('trade_license', file(tradeLicense));
  return api.put('/api/sellers/step/4', fd, multipart(onProgress));
}

// POST /api/sellers/submit → status becomes 'pending'
export const submitApplication = () => api.post('/api/sellers/submit', {});

// GET /api/sellers/gst-assistance/capabilities → data { fee?: { amountPaise } }
export async function getGstAssistanceCapabilities() {
  const body = await api.get('/api/sellers/gst-assistance/capabilities');
  if (body?.success === false || !body?.data) throw new Error('Invalid GST assistance details');
  return body.data;
}
