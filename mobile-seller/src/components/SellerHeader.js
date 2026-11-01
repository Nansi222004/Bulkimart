import React, { useCallback, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { getUnreadCount } from '../services/notifications.api';
import SideMenu from './SideMenu';
import { colors, radius, spacing } from '../theme';

// Branded header for the main tabs: menu button (opens the sidebar), seller logo, screen title + store name, notification bell.
// The unread badge comes from the server and refreshes whenever a tab gains focus.
export default function SellerHeader({ title }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { seller } = useAuth();
  const [unread, setUnread] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const storeName = seller?.storeDetails?.name;

  useFocusEffect(useCallback(() => {
    let alive = true;
    getUnreadCount()
      .then((body) => { const n = body?.data?.count ?? body?.count; if (alive) setUnread(Number.isSafeInteger(n) ? n : null); })
      .catch(() => { if (alive) setUnread(null); });
    return () => { alive = false; };
  }, []));

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.row}>
        <Pressable onPress={() => setMenuOpen(true)} style={({ pressed }) => [styles.menuBtn, pressed && styles.pressed]}
          accessibilityRole="button" accessibilityLabel="Open menu" hitSlop={8}>
          <View style={styles.bar} /><View style={[styles.bar, styles.barShort]} /><View style={styles.bar} />
        </Pressable>
        <View style={styles.logoBox}>
          <Image source={require('../assets/seller-mark.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Bulkimart Seller" />
        </View>
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.store} numberOfLines={1}>{storeName || 'Bulkimart Seller'}</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('Notifications')}
          style={({ pressed }) => [styles.bell, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          hitSlop={8}
        >
          <Text style={styles.bellGlyph}>🔔</Text>
          {unread ? <View style={styles.badge}><Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text></View> : null}
        </Pressable>
      </View>
      <View style={styles.accent} />
      <SideMenu visible={menuOpen} onClose={closeMenu} onNavigate={(route) => navigation.navigate(route)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  menuBtn: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 5 },
  bar: { width: 22, height: 2.5, borderRadius: 2, backgroundColor: colors.deepBlue },
  barShort: { width: 16, alignSelf: 'center', backgroundColor: colors.orange },
  logoBox: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 38, height: 28 },
  titles: { flex: 1 },
  title: { fontSize: 20, fontWeight: '800', color: colors.deepBlue },
  store: { fontSize: 13, color: colors.textSecondary, marginTop: 1 },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  bellGlyph: { fontSize: 20 },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.orange, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  accent: { height: 3, backgroundColor: colors.orange, opacity: 0.85 },
});
