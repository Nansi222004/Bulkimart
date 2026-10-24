export const EFFECT_PRESETS = ['snowfall', 'confetti', 'petals', 'sparkles'];
export const DEFAULT_EFFECT = { enabled: false, preset: 'confetti', colors: ['#FFD45A', '#B50918', '#FFFFFF'], speed: 1, density: 40, opacity: 0.6, duration: 15, scope: 'homepage', campaignId: '', startAt: null, endAt: null };
export function effectActive(effect, now = Date.now()) {
  return !!effect?.enabled && (!effect.startAt || Date.parse(effect.startAt) <= now) && (!effect.endAt || Date.parse(effect.endAt) > now);
}
export function effectApplies(effect, { activeNav, selectedCampaignId, selectedProduct, selectedOrder, reviewProductId, productDetailLoading } = {}) {
  if (effect.scope === 'storefront') return true;
  if (effect.scope === 'campaign') return !!selectedCampaignId && String(selectedCampaignId) === effect.campaignId;
  return effect.scope === 'homepage' && activeNav === 'home' && !selectedCampaignId && !selectedProduct && !selectedOrder && !reviewProductId && !productDetailLoading;
}
