// Shared, closed vocabulary: no executable CSS or arbitrary HTML is accepted.
export const DEFAULT_TOKENS = {
  primary: '#B50918', secondary: '#79000B', accent: '#FFD45A', background: '#FFF9F4', surface: '#FFFFFF',
  text: '#252525', muted: '#706B68', border: '#E9E1DC', header: '#79000B', headerText: '#FFFFFF',
  search: '#FFFFFF', searchText: '#252525', action: '#D91430', actionText: '#FFFFFF', actionHover: '#B50918',
  badge: '#D91430', badgeText: '#FFFFFF', highlight: '#FFF0B3', highlightText: '#79000B',
  promotion: '#E6F5EF', promotionText: '#075E46', categorySurface: '#FFF0B3', categoryFrame: '#FFD45A',
  productBorder: '#E9E1DC', navSurface: '#FFFFFF', navText: '#706B68', navActive: '#B50918',
  font: 'system', card: 'rounded', button: 'rounded', category: 'framed', product: 'elevated',
  gradient: 'soft', decoration: 'lights', motion: 'none',
};
export const COLOR_KEYS = Object.keys(DEFAULT_TOKENS).filter(key => DEFAULT_TOKENS[key].startsWith('#'));
// Older published themes keep their intentional palette; new component roles derive from it.
export function resolveTokens(input = {}) {
  const t = { ...DEFAULT_TOKENS, ...input };
  for (const [key, parent] of Object.entries({ header: 'secondary', action: 'primary', actionHover: 'secondary', badge: 'primary', navActive: 'primary', search: 'surface', searchText: 'text', navSurface: 'surface', navText: 'muted', productBorder: 'border', categoryFrame: 'accent' })) {
    if (input[key] == null && input[parent] != null) t[key] = input[parent];
  }
  return t;
}
export const PRESETS = Object.fromEntries([
  ['Default Bulkimart', {}], ['Classic Aqua', { primary: '#087ea4', secondary: '#073b78', accent: '#ff8500', background: '#f3f9fc', text: '#172b4d', muted: '#526477', border: '#dce7ef', categorySurface: '#EAF9FE', highlight: '#FFF4E6', decoration: 'none' }], ['Festive Celebration', { primary: '#8a2877', accent: '#f5b544' }],
  ['Diwali Celebration', { primary: '#813e14', accent: '#ffc247' }], ['Holi Colors', { primary: '#9b247e', accent: '#2fd3be' }],
  ['Eid Celebration', { primary: '#116b52', accent: '#e0bc62' }], ['Summer Sale', { primary: '#006b87', accent: '#ffba49' }],
  ['Monsoon Sale', { primary: '#285c84', accent: '#63cebc' }], ['New Year Celebration', { primary: '#423c85', accent: '#f6c768' }],
  ['Wholesale Business Sale', { primary: '#245379', accent: '#ff9c45' }], ['Custom Admin Theme', {}],
].map(([name, tokens]) => [name, resolveTokens(tokens)]));
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
  const t = resolveTokens(tokens);
  return { ...Object.fromEntries(COLOR_KEYS.map(key => [`--sf-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, t[key]])),
    '--brand-primary': t.primary, '--brand-primary-dark': t.secondary, '--brand-orange': t.action,
    '--brand-orange-dark': t.actionHover, '--brand-orange-light': t.highlight, '--brand-deep-blue': t.text, '--brand-aqua-light': t.highlight,
    '--primary': t.action, '--primary-hover': t.actionHover, '--primary-light': t.highlight, '--accent': t.action, '--accent-hover': t.actionHover,
    '--focus-ring': `${t.primary}40`, '--nav-active-color': t.navActive, '--nav-inactive-color': t.navText,
    '--text-primary': t.text, '--text-secondary': t.muted, '--border-color': t.border,
    '--page-background': t.background, '--surface-background': t.background, '--bg-page': t.background, '--bg-card': t.surface,
    '--sf-primary': t.primary, '--sf-secondary': t.secondary, '--sf-accent': t.accent, '--sf-background': t.background,
    '--sf-surface': t.surface, '--sf-text': t.text, '--sf-muted': t.muted, '--sf-border': t.border,
    '--sf-radius': t.card === 'square' ? '4px' : '20px', '--sf-button-radius': t.button === 'pill' ? '99px' : '10px',
    '--sf-gradient': t.gradient === 'none' ? t.primary : `linear-gradient(125deg, ${t.secondary}, ${t.primary})`,
    '--header-bg': t.header,
    fontFamily: { system: 'system-ui, sans-serif', sans: 'Arial, sans-serif', serif: 'Georgia, serif' }[t.font] || 'system-ui, sans-serif' };
}
