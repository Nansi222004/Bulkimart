import { api } from './apiClient';

// Contracts: backend/controllers/seller.controller.js getSellerFaqs / answerSellerFaq (approved sellers),
// and frontend/src/modules/Seller/components/FaqsTab.jsx.

// GET /api/sellers/faqs → { success, data: { faqs: [{ _id, productId, productName, userName, question, answer, status:'unanswered'|'answered', createdAt, answeredAt }] } }
export async function listSellerFaqs() {
  const body = await api.get('/api/sellers/faqs');
  return Array.isArray(body?.data?.faqs) ? body.data.faqs : [];
}

// PATCH /api/sellers/faqs/:faqId/answer { answer } (non-empty). Scoped server-side to this seller's products.
export const answerSellerFaq = (faqId, answer) => {
  if (!/^[a-f\d]{24}$/i.test(String(faqId))) throw new Error('Invalid question reference');
  return api.patch(`/api/sellers/faqs/${encodeURIComponent(faqId)}/answer`, { answer });
};
