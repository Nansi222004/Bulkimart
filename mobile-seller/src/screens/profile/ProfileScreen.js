import React, { useCallback, useRef } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { useAuth } from '../../context/AuthContext';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/ProfileTab.jsx (read view).
const STATUSES = { approved: 'Approved seller', pending: 'Pending review', under_review: 'Under review', rejected: 'Rejected', suspended: 'Suspended', incomplete: 'Registration incomplete' };
const shown = (value) => value || 'Not provided';

export default function ProfileScreen({ navigation }) {
  const { seller, refreshSeller, signOut } = useAuth();
  // Re-read /api/sellers/me after the editor closes. The first focus is skipped (the data is already current).
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    refreshSeller();
  }, [refreshSeller]));

  if (!seller) return null;
  const store = seller.storeDetails || {};
  const account = typeof seller.userId === 'object' && seller.userId ? seller.userId : {};
  const id = seller._id || seller.id;

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
      </View>
      <AppButton title="Edit profile" variant="outline" onPress={() => navigation.navigate('EditProfile')} />

      <Card title="Business profile">
        {[['Seller identity', account.name || seller.businessName], ['Store name', store.name], ['Contact number', account.phone],
          ['Alternate phone', store.phone], ['Account email', account.email], ['Store email', store.email],
          ['Business email', seller.email], ['Store description', store.description]].map(([label, value]) => (
          <KeyValueRow key={label} label={label} value={shown(value)} />
        ))}
      </Card>

      <Card title="Store address">
        {[['Address', store.address], ['City / district', store.city], ['State', store.state], ['Pincode', store.pincode],
          ['Location pin', Number.isFinite(store.lat) && Number.isFinite(store.lng) ? `${store.lat}, ${store.lng}` : null]].map(([label, value]) => (
          <KeyValueRow key={label} label={label} value={shown(value)} />
        ))}
        <Text style={type.small}>Updating the location pin from your phone arrives in a later version.</Text>
      </Card>

      <Card title="Security & trust">
        <KeyValueRow label="Verification" value={STATUSES[seller.status] || 'Unavailable'} />
        <KeyValueRow label="Partner tier" value={seller.partnerTier || 'Unavailable'} />
        <KeyValueRow label="Region" value={[store.city, store.state].filter(Boolean).join(', ') || 'Unavailable'} />
        <KeyValueRow label="Sales channels" value={(seller.salesChannels || []).map((c) => (c === 'grocery' ? 'Quick Commerce' : c === 'ecommerce' ? 'Shop All' : c)).join(', ') || 'Unavailable'} />
        <Text style={type.small}>Account identity and approval cannot be changed through store profile editing.</Text>
      </Card>
      <AppButton title="Sign out" variant="danger" onPress={() => Alert.alert('Sign out', 'Sign out of Bulkimart Seller on this phone?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: signOut },
      ])} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: spacing.lg, backgroundColor: colors.aquaLight, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: 24, fontWeight: '900' },
  heroSmall: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  flex: { flex: 1, gap: 2 },
});
