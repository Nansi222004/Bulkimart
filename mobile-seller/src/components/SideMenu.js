import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Dimensions, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import Icon from './Icon';
import { MENU_SECTIONS, WEB_ONLY_NOTE } from '../navigation/menuItems';
import { colors, radius, spacing } from '../theme';

const WIDTH = Math.min(340, Math.round(Dimensions.get('window').width * 0.84));
const STATUS = { approved: 'Approved seller', pending: 'Pending review', under_review: 'Under review', suspended: 'Suspended' };

// Slide-in sidebar from the left. No extra native dependency (plain Modal + Animated).
export default function SideMenu({ visible, onClose, onNavigate }) {
  const insets = useSafeAreaInsets();
  const { seller, signOut } = useAuth();
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(slide, { toValue: visible ? 1 : 0, duration: 220, useNativeDriver: true })
      .start(({ finished }) => { if (finished && !visible) setMounted(false); });
  }, [visible, slide]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  const go = (route) => { onClose(); setTimeout(() => onNavigate(route), 180); };
  const confirmSignOut = () => Alert.alert('Sign out', 'Sign out of Bulkimart Seller on this phone?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out', style: 'destructive', onPress: () => { onClose(); signOut(); } },
  ]);

  if (!mounted) return null;
  const translateX = slide.interpolate({ inputRange: [0, 1], outputRange: [-WIDTH, 0] });
  const store = seller?.storeDetails?.name || seller?.businessName || 'Your store';

  return (
    <Modal transparent visible={mounted} onRequestClose={onClose} statusBarTranslucent animationType="none">
      <View style={styles.root}>
      <Animated.View style={[styles.backdrop, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View style={[styles.panel, { width: WIDTH, paddingTop: insets.top, paddingBottom: insets.bottom, transform: [{ translateX }] }]}>
        <View style={styles.top}>
          <Image source={require('../assets/seller-logo.png')} style={styles.logo} resizeMode="contain" accessibilityLabel="Bulkimart Seller" />
          <View style={styles.flex}>
            <Text style={styles.store} numberOfLines={2}>{store}</Text>
            <Text style={styles.status}>{STATUS[seller?.status] || 'Seller'}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close menu" style={styles.close}>
            <Icon name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>
        <View style={styles.accent} />
        <ScrollView contentContainerStyle={styles.scroll}>
          {MENU_SECTIONS.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
              {section.items.map((item) => (
                <Pressable key={item.route} onPress={() => go(item.route)} accessibilityRole="button" accessibilityHint={item.hint}
                  android_ripple={{ color: 'rgba(7,140,203,0.08)' }} style={styles.item}>
                  <View style={styles.glyphBox}><Icon name={item.icon} size={19} color={colors.primaryDark} /></View>
                  <View style={styles.flex}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.itemHint} numberOfLines={1}>{item.hint}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ))}
          <Text style={styles.note}>{WEB_ONLY_NOTE}</Text>
          <Pressable onPress={confirmSignOut} accessibilityRole="button" style={styles.signOut}>
            <Icon name="logout" size={18} color={colors.error} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Explicit full-screen size: inside a transparent Modal the root can otherwise measure 0 wide.
  root: { width: Dimensions.get('screen').width, height: Dimensions.get('screen').height },
  backdrop: { position: 'absolute', top: 0, left: 0, width: Dimensions.get('screen').width, height: Dimensions.get('screen').height, backgroundColor: 'rgba(7,59,120,0.35)' },
  panel: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.white, borderTopRightRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden', elevation: 12 },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  logo: { width: 64, height: 64, borderRadius: radius.md },
  flex: { flex: 1 },
  store: { fontSize: 17, fontWeight: '800', color: colors.deepBlue },
  status: { fontSize: 12, color: colors.success, fontWeight: '700', marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  accent: { height: 3, backgroundColor: colors.orange, opacity: 0.85 },
  scroll: { paddingVertical: spacing.md },
  section: { marginBottom: spacing.sm },
  sectionTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: colors.textMuted, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  glyphBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  itemHint: { fontSize: 12, color: colors.textSecondary },
  note: { fontSize: 12, color: colors.textSecondary, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  signOut: { margin: spacing.lg, minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.error, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: spacing.sm },
  signOutText: { color: colors.error, fontWeight: '800', fontSize: 15 },
});
