// Shared, closed vocabulary: no executable CSS or arbitrary HTML is accepted.
export const DEFAULT_TOKENS = { primary: '#087ea4', secondary: '#073b78', accent: '#ff8500', background: '#f3f9fc', surface: '#ffffff', text: '#172b4d', muted: '#526477', border: '#dce7ef', font: 'system', card: 'rounded', button: 'rounded', gradient: 'soft', decoration: 'none', motion: 'none' };
export const PRESETS = Object.fromEntries([
  ['Default Bulkimart', {}], ['Festive Celebration', { primary: '#8a2877', accent: '#f5b544' }],
  ['Diwali Celebration', { primary: '#813e14', accent: '#ffc247' }], ['Holi Colors', { primary: '#9b247e', accent: '#2fd3be' }],
  ['Eid Celebration', { primary: '#116b52', accent: '#e0bc62' }], ['Summer Sale', { primary: '#006b87', accent: '#ffba49' }],
  ['Monsoon Sale', { primary: '#285c84', accent: '#63cebc' }], ['New Year Celebration', { primary: '#423c85', accent: '#f6c768' }],
  ['Wholesale Business Sale', { primary: '#245379', accent: '#ff9c45' }], ['Custom Admin Theme', {}],
].map(([name, tokens]) => [name, { ...DEFAULT_TOKENS, ...tokens }]));
export const SCOPES = ['global', 'quick', 'shop-all'];
export const FREQUENCIES = ['launch', 'session', 'daily', 'version'];
export const SOURCES = ['recent', 'featured', 'category', 'price', 'campaign', 'wholesale'];
export function lifecycle(row, now = Date.now()) {
  if (row.status !== 'published') return row.status;
  if (row.endAt && new Date(row.endAt).getTime() <= now) return 'expired';
  if (row.startAt && new Date(row.startAt).getTime() > now) return 'scheduled';
  return 'active';
}
export const ranked = (a, b) => (b.priority || 0) - (a.priority || 0) || String(a._id || a.id).localeCompare(String(b._id || b.id));
export function themeStyle(tokens = {}) {
  const t = { ...DEFAULT_TOKENS, ...tokens };
  return { '--brand-primary': t.primary, '--brand-primary-dark': t.secondary, '--brand-orange': t.accent,
    '--primary': t.primary, '--primary-hover': t.secondary, '--nav-active-color': t.primary,
    '--text-primary': t.text, '--text-secondary': t.muted, '--border-color': t.border,
    '--page-background': t.background, '--surface-background': t.background, '--bg-page': t.background, '--bg-card': t.surface,
    '--sf-primary': t.primary, '--sf-secondary': t.secondary, '--sf-accent': t.accent, '--sf-background': t.background,
    '--sf-surface': t.surface, '--sf-text': t.text, '--sf-muted': t.muted, '--sf-border': t.border,
    '--sf-radius': t.card === 'square' ? '4px' : '20px', '--sf-button-radius': t.button === 'pill' ? '99px' : '10px',
    '--sf-gradient': t.gradient === 'none' ? t.primary : `linear-gradient(125deg, ${t.secondary}, ${t.primary})`,
    '--header-bg': t.gradient === 'none' ? t.primary : `linear-gradient(125deg, ${t.secondary}, ${t.primary})`,
    fontFamily: { system: 'system-ui, sans-serif', sans: 'Arial, sans-serif', serif: 'Georgia, serif' }[t.font] || 'system-ui, sans-serif' };
}
