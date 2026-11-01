import { DefaultTheme } from '@react-navigation/native';

// Tokens copied from frontend/src/index.css so the app matches the web brand.
export const colors = {
  primary: '#08b9e8',
  primaryDark: '#078ccb',
  deepBlue: '#073b78',
  orange: '#ff8500',
  orangeDark: '#f36b00',
  aquaLight: '#eaf9fe',
  orangeLight: '#fff3e5',
  background: '#ffffff',
  surface: '#f7fafc',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#172b4d',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  white: '#ffffff',
  success: '#16a34a',
  successLight: '#dcfce7',
  error: '#dc2626',
  errorLight: '#fef2f2',
  warning: '#f59e0b',
  warningLight: '#fffbeb',
  info: '#2563eb',
  infoLight: '#eff6ff',
  chart: '#1b7a37',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const type = {
  title: { fontSize: 22, fontWeight: '800', color: colors.text },
  heading: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.text },
  small: { fontSize: 12, color: colors.textSecondary },
  label: { fontSize: 13, fontWeight: '600', color: colors.text },
  amount: { fontSize: 24, fontWeight: '800', color: colors.text },
};

// Same pill colours as the web OrdersTab.
export const orderPill = {
  placed: { bg: '#fef3c7', fg: '#92400e' },
  confirmed: { bg: '#dbeafe', fg: '#1e40af' },
  preparing: { bg: '#e0e7ff', fg: '#3730a3' },
  ready_for_pickup: { bg: '#e0e7ff', fg: '#3730a3' },
  dispatched: { bg: '#ede9fe', fg: '#6d28d9' },
  out_for_delivery: { bg: '#ede9fe', fg: '#6d28d9' },
  delivered: { bg: '#dcfce7', fg: '#166534' },
  cancelled: { bg: '#fee2e2', fg: '#b91c1c' },
  return_requested: { bg: '#fef3c7', fg: '#92400e' },
  returned: { bg: '#fee2e2', fg: '#b91c1c' },
  refunded: { bg: '#f1f5f9', fg: '#475569' },
};

export const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primaryDark,
    background: colors.surface,
    card: colors.background,
    text: colors.text,
    border: colors.border,
    notification: colors.orange,
  },
};
