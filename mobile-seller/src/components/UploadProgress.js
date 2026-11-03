import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import { colors, radius, type } from '../theme';

// progress: 0..1, or null when the size is unknown.
export default function UploadProgress({ progress, label = 'Uploading' }) {
  const pct = progress == null ? null : Math.round(progress * 100);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={pct == null ? undefined : { min: 0, max: 100, now: pct }} style={styles.wrap}>
      <Text style={type.small}>{label}{pct == null ? '…' : ` ${pct}%`}{pct === 100 ? ' · waiting for the server' : ''}</Text>
      <View style={styles.track}><View style={[styles.bar, { width: `${pct ?? 15}%` }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  bar: { height: 8, backgroundColor: colors.primaryDark },
});
