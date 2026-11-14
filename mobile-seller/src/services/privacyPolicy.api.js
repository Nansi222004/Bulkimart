import { api } from './apiClient';

// GET /api/privacy-policy/seller-policy → { success, data: { roleTitle, summary, version, effectiveDate, updatedAt, sections: [{ id, title, content, points[] }] } }
// Public, admin-managed (backend/controllers/privacyPolicyController.js).
export async function getSellerPrivacyPolicy() {
  const body = await api.get('/api/privacy-policy/seller-policy');
  if (!body?.success || !body.data) throw new Error('Privacy policy is not available right now.');
  return body.data;
}
