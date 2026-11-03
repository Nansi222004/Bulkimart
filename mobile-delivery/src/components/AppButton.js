import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Text } from './AppText';
import { colors, radius, spacing } from '../theme';

const VARIANTS = {
  primary: { bg: colors.primaryDark, fg: colors.white, border: colors.primaryDark },
  accent: { bg: colors.orange, fg: colors.white, border: colors.orange },
  outline: { bg: colors.white, fg: colors.primaryDark, border: colors.primaryDark },
  danger: { bg: colors.white, fg: colors.error, border: colors.error },
  ghost: { bg: 'transparent', fg: colors.primaryDark, border: 'transparent' },
};

export default function AppButton({ title, onPress, variant = 'primary', loading = false, disabled = false, small = false, style, accessibilityLabel }) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={inactive ? undefined : onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.08)' }}
      style={({ pressed }) => [
        styles.base, small && styles.small,
        { backgroundColor: v.bg, borderColor: v.border, opacity: inactive ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : <Text style={[styles.text, small && styles.smallText, { color: v.fg }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  small: { minHeight: 38, paddingHorizontal: spacing.md },
  text: { fontSize: 16, fontWeight: '700' },
  smallText: { fontSize: 13 },
});
