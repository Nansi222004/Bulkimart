import { api } from './apiClient';

// Contracts: backend/controllers/campaign.controller.js listCampaignsForSeller / getCampaignForSeller /
// accept|reject|withdrawCampaignParticipation (approved sellers), and the web CampaignOffersTab.jsx.
// A product is sold at the campaign price only after the seller accepts it.
const checkId = (id) => {
  if (!/^[a-f\d]{24}$/i.test(String(id))) throw new Error('Invalid campaign reference');
  return encodeURIComponent(id);
};

// GET /api/sellers/campaigns → [{ campaignId, name, discountValue, startAt, endAt, lifecycle, eligible, pending, accepted, rejected }]
export async function listCampaignOffers() {
  const body = await api.get('/api/sellers/campaigns');
  return Array.isArray(body?.data) ? body.data : [];
}

// GET /api/sellers/campaigns/:id → { name, discountValue, startAt, endAt, lifecycle, products: [{ productId, name, currentPrice, dealPrice, status }] }
export async function getCampaignOffer(id) {
  const body = await api.get(`/api/sellers/campaigns/${checkId(id)}`);
  return body?.data || null;
}

// PATCH accept|reject|withdraw { productIds }
export const decideCampaignOffer = (id, action, productIds) => {
  if (!['accept', 'reject', 'withdraw'].includes(action)) throw new Error('Unknown action');
  return api.patch(`/api/sellers/campaigns/${checkId(id)}/${action}`, { productIds });
};
