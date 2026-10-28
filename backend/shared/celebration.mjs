// Closed animation vocabulary shared by validation, the renderer and Admin.
// confetti and sparkles remain for previously published configurations.
export const EFFECT_PRESETS = ['lights', 'snowfall', 'petals', 'fireworks', 'confetti', 'sparkles'];
export const EFFECT_LABELS = { lights: 'Festive lights', snowfall: 'Snowfall', petals: 'Flower petals', fireworks: 'Fireworks', confetti: 'Confetti', sparkles: 'Golden sparkles' };
export const EFFECT_COLORS = { lights: ['#FFD45A', '#FF8A00', '#FF4D4D'], snowfall: ['#FFFFFF', '#DDEEFF'], petals: ['#FFB7C5', '#FF69B4'], fireworks: ['#FFD45A', '#FF6B6B', '#7FDBFF'], confetti: ['#FFD45A', '#B50918', '#FFFFFF'], sparkles: ['#FFD700', '#FFF1A8'] };
// Falling presets drift; lights and fireworks have their own motion.
export const DRIFTING_PRESETS = ['snowfall', 'petals', 'confetti', 'sparkles'];
export const INTENSITY = { low: 0.5, medium: 1, high: 1.5 };
export const MAX_PARTICLES = 100;
// Up to MAX_COMBINED presets can play together; the first one is `preset` and uses `colors`.
export const MAX_COMBINED = 3;
export const DEFAULT_EFFECT = { enabled: false, preset: 'confetti', presets: [], colors: EFFECT_COLORS.confetti, speed: 1, density: 40, opacity: 0.6, duration: 15, scope: 'homepage', campaignId: '', startAt: null, endAt: null,
  intensity: 'medium', size: 1, direction: 'down', reducedMotion: 'hide' };
// Older configurations only carry `preset`.
export function effectPresets(effect) {
  return Array.isArray(effect?.presets) && effect.presets.length ? effect.presets : effect?.preset ? [effect.preset] : [];
}
// One renderer config per preset; extra presets keep their own palette.
export function effectLayers(effect) {
  return effectPresets(effect).map((preset, i) => ({ ...effect, preset, colors: i === 0 ? effect.colors : [...EFFECT_COLORS[preset]] }));
}
// duration 0 loops while the header is visible; otherwise seconds per viewing.
export function particleCount(effect) {
  return Math.min(MAX_PARTICLES, Math.max(1, Math.round((effect.density || 1) * (INTENSITY[effect.intensity] || 1))));
}
export function effectActive(effect, now = Date.now()) {
  return !!effect?.enabled && (!effect.startAt || Date.parse(effect.startAt) <= now) && (!effect.endAt || Date.parse(effect.endAt) > now);
}
export function effectApplies(effect, { activeNav, selectedCampaignId, selectedProduct, selectedOrder, reviewProductId, productDetailLoading } = {}) {
  if (effect.scope === 'storefront') return true;
  if (effect.scope === 'campaign') return !!selectedCampaignId && String(selectedCampaignId) === effect.campaignId;
  return effect.scope === 'homepage' && activeNav === 'home' && !selectedCampaignId && !selectedProduct && !selectedOrder && !reviewProductId && !productDetailLoading;
}
