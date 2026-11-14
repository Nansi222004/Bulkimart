import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Profile → Help: an Emergency SOS banner, then a settings-style list
 * (icon tile, title, one-line description, chevron) instead of a stack of outline buttons.
 */
function HelpRow({ icon, tint, title, subtitle, onPress, last }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={subtitle}
      android_ripple={{ color: 'rgba(0,0,0,0.05)' }} style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      <View style={[styles.iconTile, { backgroundColor: tint }]}><Text style={styles.icon}>{icon}</Text></View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function HelpCard({ sos, navigation }) {
  const call = () => Linking.openURL(`tel:${String(sos).replace(/[^\d+]/g, '')}`).catch(() => {});
  const rows = [
    { icon: '💬', tint: colors.aquaLight, title: 'Chat with support', subtitle: 'Talk to the Bulkimart team now', onPress: () => navigation.navigate('SupportChat') },
    { icon: '🎫', tint: colors.orangeLight, title: 'Support tickets', subtitle: 'Raise or track a request', onPress: () => navigation.navigate('Support') },
    { icon: '🔔', tint: colors.infoLight, title: 'Notifications', subtitle: 'Offers, payouts and updates', onPress: () => navigation.navigate('Notifications') },
    { icon: '🔒', tint: colors.successLight, title: 'Privacy policy', subtitle: 'How we use your data', onPress: () => navigation.navigate('PrivacyPolicy') },
  ];
  return (
    <View style={styles.card}>
      <Text style={type.heading}>Help & support</Text>

      <Pressable onPress={call} accessibilityRole="button" accessibilityLabel={`Emergency SOS, call ${sos}`}
        android_ripple={{ color: 'rgba(255,255,255,0.2)' }} style={({ pressed }) => [styles.sos, pressed && { opacity: 0.9 }]}>
        <View style={styles.sosIcon}><Text style={styles.icon}>🚨</Text></View>
        <View style={styles.rowText}>
          <Text style={styles.sosTitle}>Emergency SOS</Text>
          <Text style={styles.sosSub}>Tap to call {sos}</Text>
        </View>
        <View style={styles.callPill}><Text style={styles.callText}>Call</Text></View>
      </Pressable>

      <View style={styles.list}>
        {rows.map((r, i) => <HelpRow key={r.title} {...r} last={i === rows.length - 1} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  sos: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.error, borderRadius: radius.md, padding: spacing.md, overflow: 'hidden' },
  sosIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sosTitle: { fontSize: 16, fontWeight: '800', color: colors.white },
  sosSub: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  callPill: { backgroundColor: colors.white, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14 },
  callText: { fontSize: 14, fontWeight: '800', color: colors.error },
  list: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.card },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  pressed: { backgroundColor: colors.surface },
  iconTile: { width: 40, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 20 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  chevron: { fontSize: 26, color: colors.textMuted, marginTop: -2 },
});
