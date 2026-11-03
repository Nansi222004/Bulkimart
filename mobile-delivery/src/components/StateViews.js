import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import AppButton from './AppButton';
import { colors, radius, spacing, type } from '../theme';

export function LoadingView({ message = 'Loading…' }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.primaryDark} />
      <Text style={[type.small, styles.gapTop]}>{message}</Text>
    </View>
  );
}

// An error is never shown as an empty or zero state.
export function ErrorView({ message, note, onRetry, retryLabel = 'Retry' }) {
  return (
    <View style={styles.center}>
      <View style={styles.errorBox} accessibilityRole="alert">
        <Text style={styles.errorText}>{message || 'Something went wrong.'}</Text>
        {note ? <Text style={[type.small, styles.gapTop]}>{note}</Text> : null}
      </View>
      {onRetry ? <AppButton title={retryLabel} variant="outline" onPress={onRetry} style={styles.gapTop} /> : null}
    </View>
  );
}

export function EmptyView({ title, message, action }) {
  return (
    <View style={styles.center}>
      <Text style={type.heading}>{title}</Text>
      {message ? <Text style={[type.small, styles.centerText, styles.gapTop]}>{message}</Text> : null}
      {action ? <View style={styles.gapTop}>{action}</View> : null}
    </View>
  );
}

export function InlineNotice({ tone = 'info', children }) {
  const palette = {
    info: [colors.infoLight, '#1e40af'], warning: [colors.warningLight, '#92400e'],
    error: [colors.errorLight, '#991b1b'], success: [colors.successLight, '#166534'],
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: palette[0] }]} accessibilityRole={tone === 'error' ? 'alert' : undefined}>
      <Text style={{ color: palette[1], fontSize: 13, lineHeight: 19 }}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 220 },
  centerText: { textAlign: 'center' },
  gapTop: { marginTop: spacing.md },
  errorBox: { backgroundColor: colors.errorLight, borderRadius: radius.md, padding: spacing.lg, alignSelf: 'stretch' },
  errorText: { color: '#991b1b', fontSize: 14, fontWeight: '600' },
  notice: { borderRadius: radius.md, padding: spacing.md },
});
