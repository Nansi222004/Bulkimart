import { DefaultTheme } from '@react-navigation/native';

// Bulkimart light theme. Tokens copied from frontend/src/index.css (same as the seller app).
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
  textSecondary: '#52657b',
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
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

// Riders read this while working outdoors: sizes are one step larger than the seller app.
export const type = {
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 16, color: colors.text, lineHeight: 22 },
  small: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  amount: { fontSize: 28, fontWeight: '800', color: colors.text },
};

// Delivery stages (backend/models/Delivery.js status enum) and their pill colours.
export const stagePill = {
  assigned: { bg: '#dbeafe', fg: '#1e40af' },
  accepted: { bg: '#dbeafe', fg: '#1e40af' },
  arrived_at_store: { bg: '#e0e7ff', fg: '#3730a3' },
  picked_up: { bg: '#ede9fe', fg: '#6d28d9' },
  in_transit: { bg: '#ede9fe', fg: '#6d28d9' },
  arrived_at_customer: { bg: '#fef3c7', fg: '#92400e' },
  delivered: { bg: '#dcfce7', fg: '#166534' },
  rejected: { bg: '#fee2e2', fg: '#b91c1c' },
  failed: { bg: '#fee2e2', fg: '#b91c1c' },
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
