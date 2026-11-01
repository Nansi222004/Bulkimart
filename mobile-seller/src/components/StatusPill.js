import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { orderPill, radius } from '../theme';

export default function StatusPill({ status, label }) {
  const palette = orderPill[status] || { bg: '#f1f5f9', fg: '#475569' };
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.fg }]}>{label || status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '700' },
});
