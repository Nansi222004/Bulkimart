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
// Admin-built animations: a named motion, shape and palette stored with the effect that uses them.
export const CUSTOM_MOTIONS = { fall: 'Falling', rise: 'Rising', twinkle: 'Twinkling', burst: 'Bursting' };
export const CUSTOM_SHAPES = { circle: 'Circle', star: 'Star', heart: 'Heart', petal: 'Petal', diamond: 'Diamond', square: 'Square', emoji: 'Emoji / symbol' };
export const MAX_CUSTOM = 4;
export const DEFAULT_CUSTOM = { id: '', name: '', motion: 'fall', shape: 'star', emoji: '', colors: ['#FFD700', '#FF8A00'] };
export const isCustomId = id => typeof id === 'string' && /^custom-[a-z0-9]{1,24}$/.test(id);
export const effectLabel = (effect, preset) => EFFECT_LABELS[preset] || effect?.customs?.find(c => c.id === preset)?.name || 'Custom animation';
export const DEFAULT_EFFECT = { enabled: false, preset: 'confetti', presets: [], customs: [], colors: EFFECT_COLORS.confetti, speed: 1, density: 40, opacity: 0.6, duration: 0, scope: 'homepage', campaignId: '', startAt: null, endAt: null,
  intensity: 'medium', size: 1, direction: 'down', reducedMotion: 'hide' };
// Older configurations only carry `preset`.
export function effectPresets(effect) {
  return Array.isArray(effect?.presets) && effect.presets.length ? effect.presets : effect?.preset ? [effect.preset] : [];
}
// The first built-in preset uses the effect colours; other built-ins keep their own palette.
export const primaryPreset = effect => effectPresets(effect).find(p => EFFECT_PRESETS.includes(p));
// One renderer config per preset. Custom animations carry their definition and colours.
export function effectLayers(effect) {
  const primary = primaryPreset(effect);
  return effectPresets(effect).flatMap(preset => {
    const custom = effect.customs?.find(c => c.id === preset);
    if (custom) return [{ ...effect, preset: 'custom', custom, colors: custom.colors }];
    return EFFECT_COLORS[preset] ? [{ ...effect, preset, colors: preset === primary ? effect.colors : [...EFFECT_COLORS[preset]] }] : [];
  });
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
