// Shared building blocks used on more than one screen.
import React, { useEffect } from 'react';
import { ActivityIndicator, BackHandler, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View } from 'react-native';
import { useAppTheme } from '../theme/ThemeContext';
import { base } from '../theme';

/** Text in the storefront font (Studio "system" = platform font). */
export function Text({ style, ...props }) {
  const theme = useAppTheme();
  return <RNText {...props} style={[{ color: theme.textPrimary }, theme.fontFamily ? { fontFamily: theme.fontFamily } : null, style]} />;
}

/** Outfit/Inter where the web CSS names them explicitly. */
export const outfit = weight => ({ fontFamily: 'Outfit', fontWeight: String(weight || 400) });
export const inter = weight => ({ fontFamily: 'Inter', fontWeight: String(weight || 400) });

export function Button({ title, onPress, disabled, busy, variant = 'primary', style, textStyle, children, accessibilityLabel, icon }) {
  const theme = useAppTheme();
  const palette = {
    primary: { bg: theme.action, fg: theme.actionText, border: theme.action },
    secondary: { bg: '#ffffff', fg: theme.textPrimary, border: base.slate300 },
    soft: { bg: theme.highlight, fg: theme.highlightText, border: theme.highlight },
    danger: { bg: '#b91c1c', fg: '#ffffff', border: '#b91c1c' },
    ghost: { bg: 'transparent', fg: theme.action, border: 'transparent' },
    dark: { bg: base.brandDeepBlue, fg: '#ffffff', border: base.brandDeepBlue },
  }[variant];
  const inactive = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} accessibilityState={{ disabled: !!inactive, busy: !!busy }}
    onPress={inactive ? undefined : onPress}
    style={({ pressed }) => [styles.button, { backgroundColor: palette.bg, borderColor: palette.border, borderRadius: theme.buttonRadius, opacity: inactive ? 0.6 : pressed ? 0.85 : 1 }, style]}>
    {icon}
    {children || <Text style={[styles.buttonText, { color: palette.fg }, textStyle]}>{title}</Text>}
  </Pressable>;
}

export function Spinner({ color, size = 'small', style }) {
  const theme = useAppTheme();
  return <ActivityIndicator color={color || theme.action} size={size} style={style} />;
}

/** Loading state shown as text, as the web does ("Loading…" with role=status). */
export function LoadingState({ label = 'Loading…', style }) {
  return <View style={[styles.state, style]} accessibilityRole="progressbar" accessibilityLabel={label}>
    <Spinner />
    <Text style={styles.stateText}>{label}</Text>
  </View>;
}

export function ErrorState({ message, onRetry, retryLabel = 'Retry', style }) {
  return <View style={[styles.state, style]} accessibilityRole="alert">
    <Text style={[styles.stateText, { color: '#991b1b' }]}>{message}</Text>
    {onRetry && <Button title={retryLabel} variant="secondary" onPress={onRetry} style={{ marginTop: 10, alignSelf: 'center' }} />}
  </View>;
}

export function EmptyState({ title, message, action, onAction, icon, style }) {
  return <View style={[styles.state, style]}>
    {icon}
    {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
    {message ? <Text style={styles.stateText}>{message}</Text> : null}
    {action && <Button title={action} onPress={onAction} style={{ marginTop: 14, alignSelf: 'center', paddingHorizontal: 22 }} />}
  </View>;
}

export function Field({ label, error, style, inputStyle, multiline, ...props }) {
  const theme = useAppTheme();
  return <View style={[{ marginBottom: 14 }, style]}>
    {label ? <Text style={styles.label}>{label}</Text> : null}
    <TextInput placeholderTextColor={base.textMuted} {...props} multiline={multiline}
      style={[styles.input, { borderColor: error ? base.error : theme.borderColor, color: theme.textPrimary }, multiline && { minHeight: 90, textAlignVertical: 'top' }, inputStyle]} />
    {error ? <Text style={styles.fieldError}>{error}</Text> : null}
  </View>;
}

/** Closes on the Android back button before anything else does (web: Escape / back closes the top modal). */
export function useBackClose(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose?.(); return true; });
    return () => sub.remove();
  }, [open, onClose]);
}

/** Bottom sheet / centred dialog on a dimmed backdrop. */
export function Sheet({ visible, onClose, children, position = 'bottom', style, dismissable = true, avoidKeyboard = true }) {
  const content = <View style={[position === 'bottom' ? styles.sheet : styles.dialog, style]}>{children}</View>;
  return <Modal visible={visible} transparent animationType={position === 'bottom' ? 'slide' : 'fade'} statusBarTranslucent navigationBarTranslucent onRequestClose={() => { if (dismissable) onClose?.(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={avoidKeyboard} style={[styles.backdrop, position === 'center' && styles.backdropCenter]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={dismissable ? onClose : undefined} accessibilityLabel="Close" />
      {content}
    </KeyboardAvoidingView>
  </Modal>;
}

/** A scrollable form body that keeps the focused input above the keyboard. */
export function FormScroll({ children, contentContainerStyle, ...props }) {
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={contentContainerStyle} {...props}>{children}</ScrollView>
  </KeyboardAvoidingView>;
}

export const money = value => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '₹0';
  return '₹' + number.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
};

const styles = StyleSheet.create({
  button: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  buttonText: { fontSize: 14, fontWeight: '700', textAlign: 'center' },
  state: { padding: 24, alignItems: 'center', justifyContent: 'center' },
  stateText: { marginTop: 8, fontSize: 13, color: base.slate500, textAlign: 'center', lineHeight: 19 },
  emptyTitle: { marginTop: 10, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  label: { fontSize: 12, fontWeight: '700', color: base.slate600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, backgroundColor: '#ffffff' },
  fieldError: { color: base.error, fontSize: 12, marginTop: 5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  backdropCenter: { justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { backgroundColor: '#ffffff', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '92%', paddingBottom: 16 },
  dialog: { backgroundColor: '#ffffff', borderRadius: 18, width: '100%', maxWidth: 420, maxHeight: '90%' },
});
