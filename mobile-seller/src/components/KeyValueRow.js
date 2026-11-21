import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { colors, spacing } from '../theme';

export default function KeyValueRow({ label, value, strong, valueColor }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong, valueColor && { color: valueColor }]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 4 },
  // The label keeps its own width (up to 45%) so a long value, e.g. a full address, wraps instead of
  // squeezing the label off the row; the value takes the rest, right-aligned.
  label: { flexShrink: 0, maxWidth: '45%', fontSize: 13, color: colors.textSecondary },
  value: { flex: 1, fontSize: 13, color: colors.text, textAlign: 'right' },
  strong: { fontWeight: '800', color: colors.text, fontSize: 14 },
});
