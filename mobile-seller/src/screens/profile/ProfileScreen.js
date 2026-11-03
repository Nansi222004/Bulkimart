import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import Icon from '../../components/Icon';
import KeyValueRow from '../../components/KeyValueRow';
import { useAuth } from '../../context/AuthContext';
import usePinnedAddress from '../../hooks/usePinnedAddress';
import { deleteSellerAccount } from '../../services/settings.api';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/ProfileTab.jsx (read view).
const STATUSES = { approved: 'Approved seller', pending: 'Pending review', under_review: 'Under review', rejected: 'Rejected', suspended: 'Suspended', incomplete: 'Registration incomplete' };
const shown = (value) => value || 'Not provided';

function SectionTitle({ icon, title }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionIcon}><Icon name={icon} size={17} color={colors.primaryDark} /></View>
      <Text style={type.heading}>{title}</Text>
    </View>
  );
}

function ActionRow({ icon, label, onPress, tone = 'default', busy = false }) {
  const danger = tone === 'danger';
  const fg = danger ? colors.error : colors.text;
  return (
    <Pressable onPress={onPress} disabled={busy} accessibilityRole="button" android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
      <View style={[styles.actionIcon, danger && styles.actionIconDanger]}>
        {busy ? <ActivityIndicator size="small" color={fg} /> : <Icon name={icon} size={18} color={danger ? colors.error : colors.primaryDark} />}
      </View>
      <Text style={[styles.actionText, { color: fg }]}>{label}</Text>
      <Text style={[styles.chevron, danger && { color: colors.error }]}>›</Text>
    </Pressable>
  );
}

export default function ProfileScreen({ navigation }) {
  const { seller, refreshSeller, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);
  // Re-read /api/sellers/me after the editor closes. The first focus is skipped (the data is already current).
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    refreshSeller();
  }, [refreshSeller]));

  const store = seller?.storeDetails || {};
  const hasPin = Number.isFinite(store.lat) && Number.isFinite(store.lng);
  const pinned = usePinnedAddress(store.lat, store.lng);

  if (!seller) return null;
  const account = typeof seller.userId === 'object' && seller.userId ? seller.userId : {};
  const id = seller._id || seller.id;
  const typedAddress = [store.address, store.city, store.state, store.pincode].filter(Boolean).join(', ');

  const confirmSignOut = () => Alert.alert('Sign out', 'Sign out of Bulkimart Seller on this phone?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: signOut },
  ]);

  const runDelete = async () => {
    setDeleting(true);
    try {
      const body = await deleteSellerAccount();
      ToastAndroid.show(body?.message || 'Seller account deleted.', ToastAndroid.LONG);
      await signOut();
    } catch (e) {
      Alert.alert('Account not deleted', e?.message || 'Could not delete your seller account. Please try again.');
    } finally { setDeleting(false); }
  };

  const confirmDelete = () => Alert.alert(
    'Delete seller account?',
    'This permanently closes your store on Bulkimart and cannot be undone.\n\nAccounts with active orders, open returns or pending payouts cannot be deleted until those are settled.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: runDelete }],
  );

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{(store.name || seller.businessName || 'S').slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.flex}>
          <Text style={styles.heroSmall}>SELLER · {STATUSES[seller.status] || 'Status unavailable'}</Text>
          <Text style={type.title}>{shown(seller.businessName || account.name)}</Text>
          <Text style={type.body}>{shown(store.name)}</Text>
          <Text style={type.small} selectable>Seller ID: {id || 'Unavailable'}</Text>
        </View>
        <Pressable onPress={() => navigation.navigate('EditProfile')} accessibilityRole="button" accessibilityLabel="Edit profile"
          style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]} hitSlop={6}>
          <Icon name="edit" size={18} color={colors.primaryDark} />
        </Pressable>
      </View>

      <Card>
        <SectionTitle icon="user" title="Business profile" />
        {[['Seller identity', account.name || seller.businessName], ['Store name', store.name], ['Contact number', account.phone],
          ['Alternate phone', store.phone], ['Account email', account.email], ['Store email', store.email],
          ['Business email', seller.email], ['Store description', store.description]].map(([label, value]) => (
          <KeyValueRow key={label} label={label} value={shown(value)} />
        ))}
      </Card>

      <Card>
        <SectionTitle icon="mapPin" title="Store address" />
        <Text style={styles.addressLabel}>Address on file</Text>
        <Text style={styles.addressText} selectable>{typedAddress || 'Not provided'}</Text>

        <View style={styles.pinBox}>
          <View style={styles.pinHead}>
            <Icon name="mapPin" size={16} color={hasPin ? colors.success : colors.textMuted} />
            <Text style={styles.addressLabel}>{hasPin ? 'Pinned location' : 'Location pin'}</Text>
          </View>
          {!hasPin ? <Text style={type.small}>Not pinned yet. Pin your store from Store location in the menu.</Text>
            : pinned.loading ? <Text style={type.small}>Finding address…</Text>
              : <Text style={styles.addressText} selectable>{pinned.text || typedAddress || 'Pinned on the map'}</Text>}
          {hasPin ? (
            <Pressable onPress={() => Linking.openURL(`geo:${store.lat},${store.lng}?q=${store.lat},${store.lng}`)} accessibilityRole="link" style={styles.mapLink}>
              <Icon name="external" size={14} color={colors.primaryDark} />
              <Text style={styles.mapLinkText}>View on map</Text>
            </Pressable>
          ) : null}
        </View>
        <ActionRow icon="mapPin" label={hasPin ? 'Update store location' : 'Pin store location'} onPress={() => navigation.navigate('StoreLocation')} />
      </Card>

      <Card>
        <SectionTitle icon="shield" title="Security & trust" />
        <KeyValueRow label="Verification" value={STATUSES[seller.status] || 'Unavailable'} />
        <KeyValueRow label="Partner tier" value={seller.partnerTier || 'Unavailable'} />
        <KeyValueRow label="Region" value={[store.city, store.state].filter(Boolean).join(', ') || 'Unavailable'} />
        <KeyValueRow label="Sales channels" value={(seller.salesChannels || []).map((c) => (c === 'grocery' ? 'Quick Commerce' : c === 'ecommerce' ? 'Shop All' : c)).join(', ') || 'Unavailable'} />
        <Text style={type.small}>Account identity and approval cannot be changed through store profile editing.</Text>
      </Card>

      <Card>
        <SectionTitle icon="settings" title="Account" />
        <ActionRow icon="edit" label="Edit profile" onPress={() => navigation.navigate('EditProfile')} />
        <ActionRow icon="logout" label="Sign out" onPress={confirmSignOut} />
      </Card>

      <View style={styles.danger}>
        <View style={styles.dangerHead}>
          <Icon name="trash" size={18} color={colors.error} />
          <Text style={styles.dangerTitle}>Delete account</Text>
        </View>
        <Text style={styles.dangerText}>Permanently close your seller account and remove your store from Bulkimart. Settle active orders, returns and payouts first.</Text>
        <Pressable onPress={confirmDelete} disabled={deleting} accessibilityRole="button"
          style={({ pressed }) => [styles.dangerBtn, (pressed || deleting) && styles.pressed]}>
          {deleting ? <ActivityIndicator size="small" color={colors.white} /> : <Icon name="trash" size={17} color={colors.white} />}
          <Text style={styles.dangerBtnText}>{deleting ? 'Deleting…' : 'Delete my seller account'}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: spacing.lg, backgroundColor: colors.aquaLight, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: 24, fontWeight: '900' },
  heroSmall: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  flex: { flex: 1, gap: 2 },
  editBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  pressed: { opacity: 0.7 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  sectionIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  addressLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  addressText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  pinBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 6, marginTop: spacing.xs },
  pinHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 2 },
  mapLinkText: { color: colors.primaryDark, fontWeight: '700', fontSize: 13 },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10 },
  actionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  actionIconDanger: { backgroundColor: colors.errorLight },
  actionText: { flex: 1, fontSize: 15, fontWeight: '600' },
  chevron: { fontSize: 22, color: colors.textMuted },
  danger: { borderWidth: 1, borderColor: '#fecaca', backgroundColor: colors.errorLight, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  dangerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dangerTitle: { fontSize: 16, fontWeight: '800', color: colors.error },
  dangerText: { fontSize: 13, color: '#7f1d1d', lineHeight: 19 },
  dangerBtn: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.md, backgroundColor: colors.error, marginTop: spacing.xs },
  dangerBtnText: { color: colors.white, fontWeight: '800', fontSize: 15 },
});
