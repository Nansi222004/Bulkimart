// One theme for the whole app.
// - `base`: the web's fixed design tokens (frontend/src/index.css :root).
// - `themeFrom(tokens)`: the Storefront Studio theme, resolved exactly like the web's `themeStyle()` does for its
//   CSS variables (backend/shared/storefront.mjs). The published theme comes from the backend at runtime.
import { StyleSheet } from 'react-native';
import { resolveTokens } from '../shared/storefront';

export const base = {
  brandPrimary: '#08b9e8',
  brandPrimaryDark: '#078ccb',
  brandDeepBlue: '#073b78',
  brandOrange: '#ff8500',
  brandOrangeDark: '#f36b00',
  brandAquaLight: '#eaf9fe',
  brandOrangeLight: '#fff3e5',
  success: '#16a34a',
  error: '#dc2626',
  warning: '#f59e0b',
  textMuted: '#94a3b8',
  textWhite: '#ffffff',
  slate900: '#0f172a',
  slate700: '#334155',
  slate600: '#475569',
  slate500: '#64748b',
  slate400: '#94a3b8',
  slate300: '#cbd5e1',
  slate200: '#e2e8f0',
  slate100: '#f1f5f9',
  slate50: '#f8fafc',
  accentBlue: '#2563eb',
  accentBlueLight: '#eff6ff',
  radiusSm: 8,
  radiusMd: 14,
  radiusLg: 20,
};

export const fonts = {
  // The storefront shell uses the Studio font choice ('system' → the platform font, Roboto on Android).
  system: undefined,
  sans: 'sans-serif',
  serif: 'serif',
  // Explicit web fonts (embedded at build time by the expo-font plugin in app.json).
  outfit: 'Outfit',
  inter: 'Inter',
};

/** The variables `themeStyle()` defines, as plain values. */
export function themeFrom(tokens = {}) {
  const t = resolveTokens(tokens);
  return {
    tokens: t,
    // Raw Studio roles
    ...t,
    // Web aliases (`--primary`, `--text-primary`, …)
    brandPrimary: t.primary,
    brandPrimaryDark: t.secondary,
    brandOrange: t.action,
    brandOrangeDark: t.actionHover,
    brandOrangeLight: t.highlight,
    brandDeepBlue: t.text,
    brandAquaLight: t.highlight,
    primaryColor: t.action,
    primaryHover: t.actionHover,
    primaryLight: t.highlight,
    accentColor: t.action,
    focusRing: `${t.primary}40`,
    navActiveColor: t.navActive,
    navInactiveColor: t.navText,
    textPrimary: t.text,
    textSecondary: t.muted,
    borderColor: t.border,
    pageBackground: t.background,
    cardBackground: t.surface,
    headerBg: t.header,
    radius: t.card === 'square' ? 4 : 20,
    buttonRadius: t.button === 'pill' ? 99 : 10,
    fontFamily: { system: undefined, sans: 'sans-serif', serif: 'serif' }[t.font],
  };
}

export const shadows = StyleSheet.create({
  sm: { shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  lg: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  premium: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
});

/** `#rrggbb` + alpha (0–1) → `rgba(...)`; used where the web uses color-mix or translucent variants. */
export function alpha(hex, opacity) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value.slice(0, 6);
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}
