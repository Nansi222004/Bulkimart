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
  label: { flex: 1, fontSize: 14, color: colors.textSecondary },
  value: { flexShrink: 1, fontSize: 14, color: colors.text, textAlign: 'right' },
  strong: { fontWeight: '800', color: colors.text, fontSize: 14 },
});
