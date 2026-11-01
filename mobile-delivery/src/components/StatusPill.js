import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, stagePill } from '../theme';

const TONES = {
  neutral: { bg: '#f1f5f9', fg: '#475569' },
  success: { bg: '#dcfce7', fg: '#166534' },
  warning: { bg: '#fef3c7', fg: '#92400e' },
  danger: { bg: '#fee2e2', fg: '#b91c1c' },
  info: { bg: '#dbeafe', fg: '#1e40af' },
};

export default function StatusPill({ status, label, tone }) {
  const palette = (tone && TONES[tone]) || stagePill[status] || TONES.neutral;
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      <Text style={[styles.text, { color: palette.fg }]}>{label || status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  text: { fontSize: 13, fontWeight: '700' },
});
