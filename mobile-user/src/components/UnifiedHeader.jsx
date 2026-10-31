// Port of UnifiedHeader.jsx + HeaderCategories.jsx (mobile layout).
// Split in two because the web header is sticky with a negative top: the brand row and the Quick/ShopAll switcher
// scroll away, the search bar and category tabs stay pinned. Screens put <HeaderTop/> and <HeaderPinned/> as the
// first two children of a ScrollView with stickyHeaderIndices={[1]} (see HeaderScrollView).
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { House, MessageCircle, CircleArrowRight, Flame, LayoutGrid } from 'lucide-react-native';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { useAppTheme } from '../theme/ThemeContext';
import { alpha } from '../theme';
import { mediaUrl } from '../api/client';
import { useNotifications } from '../hooks/useNotifications';
import { Text } from './ui';
import { BellIcon, BoltIcon, CartIcon, HeartIcon, MicIcon, PinIcon, SearchIcon } from './icons';
import { ImageSearchButton } from './ImageSearchSheet';
import NotificationDrawer from './NotificationDrawer';
import Celebration from './Celebration';
import { hasFestiveHeader } from './storefront/HeroBanner';

const logoIcon = require('../../assets/images/logo-icon-transparent.png');

function useHeaderEffect() {
  const { effect, theme } = useStorefront();
  const { activeNav } = useUser();
  return activeNav === 'home' && hasFestiveHeader(theme) ? null : effect;
}

function ActionButton({ label, onPress, children, badge, dot }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.actionBtn} hitSlop={4}>
    <View style={[styles.actionCircle, { backgroundColor: theme.search }]}>{children}</View>
    {badge ? <Text style={[styles.badge, { backgroundColor: theme.badge, color: theme.badgeText, borderColor: theme.surface }]}>{badge}</Text> : null}
    {dot ? <View style={[styles.dot, { backgroundColor: theme.badge, borderColor: theme.surface }]} /> : null}
  </Pressable>;
}

export function HeaderTop() {
  const theme = useAppTheme();
  const effect = useHeaderEffect();
  const { activeMode, setActiveMode, setActiveSubNav, getCartCount, setActiveNav, location, setShowLocationModal, wishlist } = useUser();
  const cartCount = getCartCount();
  const wishlistCount = wishlist?.size || 0;
  const [showNotifications, setShowNotifications] = useState(false);
  const { unreadCount } = useNotifications({ autoFetch: false });
  const fg = theme.headerText;
  const switchMode = mode => { setActiveMode(mode); setActiveSubNav(mode === 'quick' ? 'grocery--home' : 'ecommerce--smart-buy'); };
  return <View style={{ backgroundColor: theme.header, overflow: 'hidden' }}>
    {effect && <Celebration effect={effect} />}
    <View style={styles.primaryRow}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={styles.brand} accessibilityLabel="Bulkimart — Sabse Smart Bulkimart">
          <View style={[styles.brandTile, { backgroundColor: theme.search }]}><Image source={logoIcon} style={{ width: '100%', height: '100%' }} contentFit="contain" /></View>
          <View>
            <Text style={[styles.brandName, { color: fg }]}>Bulkimart</Text>
            <Text style={[styles.tagline, { color: fg }]}>Sabse Smart Bulkimart</Text>
          </View>
        </View>
        <Pressable style={styles.address} onPress={() => setShowLocationModal(true)} accessibilityRole="button" accessibilityLabel={`Change delivery location. Current location: ${location || 'Select your location'}`}>
          <PinIcon size={16} color={fg} width={2.2} />
          <View style={{ flexShrink: 1 }}>
            <Text style={[styles.addressLabel, { color: fg }]}>DELIVER TO</Text>
            <Text numberOfLines={1} style={[styles.addressTitle, { color: fg }]}>{location || 'Select your location'}</Text>
          </View>
        </Pressable>
      </View>
      <View style={styles.actions}>
        <ActionButton label="Wishlist" onPress={() => setActiveNav('wishlist')} badge={wishlistCount > 0 ? wishlistCount : null}>
          <HeartIcon size={20} width={2.3} color={wishlistCount > 0 ? '#ef4444' : theme.searchText} filled={wishlistCount > 0} />
        </ActionButton>
        <ActionButton label="Notifications" onPress={() => setShowNotifications(true)} dot={unreadCount > 0}><BellIcon size={20} width={2.3} color={theme.searchText} /></ActionButton>
        <ActionButton label={`Cart with ${cartCount} items`} onPress={() => setActiveNav('cart')} badge={cartCount > 0 ? cartCount : null}><CartIcon size={21} width={2.3} color={theme.searchText} /></ActionButton>
      </View>
    </View>
    <View style={styles.switcher} accessibilityRole="tablist" accessibilityLabel="Storefront">
      {[['quick', 'Quick'], ['shop-all', 'ShopAll']].map(([mode, label]) => {
        const active = activeMode === mode;
        return <Pressable key={mode} onPress={() => switchMode(mode)} accessibilityRole="tab" accessibilityState={{ selected: active }}
          style={[styles.switchBtn, { borderRadius: theme.buttonRadius }, active ? { backgroundColor: theme.highlight, borderColor: 'transparent' } : { borderColor: alpha(fg, 0.35) }]}>
          {mode === 'quick' && <BoltIcon size={14} color={active ? theme.highlightText : fg} />}
          <Text style={[styles.switchText, { color: active ? theme.highlightText : fg }]}>{label}</Text>
        </Pressable>;
      })}
    </View>
    <NotificationDrawer isOpen={showNotifications} onClose={() => setShowNotifications(false)} />
  </View>;
}

function SubNavItem({ label, active, onPress, icon }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.subItem}>
    <View style={styles.subIcon}>{icon}</View>
    <Text numberOfLines={2} style={[styles.subLabel, { fontWeight: active ? '800' : '600' }]}>{label}</Text>
    {active && <View style={[styles.activeLine, { backgroundColor: theme.accent }]} />}
  </Pressable>;
}

function CategoryTabArtwork({ category }) {
  const [failed, setFailed] = useState(false);
  const source = category.icon || category.image;
  const photo = !category.icon && !!category.image;
  if (!source || failed) return <LayoutGrid size={18} color="#fff" strokeWidth={2.2} />;
  return photo
    ? <Image source={{ uri: mediaUrl(source) }} style={styles.tabPhoto} contentFit="cover" onError={() => setFailed(true)} />
    : <Image source={{ uri: mediaUrl(source) }} style={{ width: 18, height: 18 }} contentFit="contain" tintColor="#ffffff" onError={() => setFailed(true)} />;
}

export function HeaderPinned() {
  const theme = useAppTheme();
  const effect = useHeaderEffect();
  const { headerCategories = [] } = useStorefront();
  const { activeMode, activeSubNav, setActiveSubNav, setActiveNav, openVoiceSearch, openImageSearch } = useUser();
  const items = [
    ...(activeMode === 'shop-all'
      ? [{ id: 'ecommerce--smart-buy', label: 'Smart Buy', Icon: CircleArrowRight }, { id: 'ecommerce--hot-deals', label: 'Hot Deals', Icon: Flame }]
      : [{ id: 'grocery--home', label: 'My Home', Icon: House }, { id: 'coupons', label: 'Coupons', Icon: MessageCircle }]),
    { id: 'explore-more', label: 'All categories', Icon: LayoutGrid },
  ];
  const tab = item => <SubNavItem key={item.id} label={item.label} active={activeSubNav === item.id} icon={<item.Icon size={18} color="#fff" strokeWidth={2.2} />}
    onPress={() => (item.id === 'explore-more' ? setActiveNav('categories') : setActiveSubNav(item.id))} />;
  return <View style={{ backgroundColor: theme.header, overflow: 'hidden' }}>
    {effect && <Celebration effect={effect} />}
    <View style={{ paddingTop: 8, paddingHorizontal: 12 }}>
      <View style={[styles.searchPill, { backgroundColor: theme.search, borderRadius: theme.buttonRadius }]}>
        <Pressable style={styles.searchTap} onPress={() => setActiveNav('search')} accessibilityRole="search" accessibilityLabel="Open search">
          <SearchIcon size={18} width={2.5} color={theme.searchText} />
          <Text numberOfLines={1} style={[styles.searchPlaceholder, { color: theme.searchText }]}>Search products and categories</Text>
        </Pressable>
        <ImageSearchButton onPress={openImageSearch} />
        <Pressable onPress={openVoiceSearch} accessibilityRole="button" accessibilityLabel="Start voice search" style={styles.mic} hitSlop={6}><MicIcon size={18} width={2.2} color={theme.searchText} /></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 7 }} contentContainerStyle={{ gap: 4, minWidth: '100%' }}>
        {tab(items[0])}
        {headerCategories.map(category => <SubNavItem key={category._id} label={category.name} active={activeSubNav === category.slug}
          icon={<CategoryTabArtwork category={category} />} onPress={() => setActiveSubNav(category.slug)} />)}
        {items.slice(1).map(tab)}
      </ScrollView>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  primaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 76, paddingTop: 4, paddingBottom: 4, paddingHorizontal: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  brandTile: { width: 54, height: 46, borderRadius: 12, padding: 3, overflow: 'hidden' },
  brandName: { fontSize: 17, fontWeight: '900', letterSpacing: -0.35 },
  tagline: { marginTop: 1, fontSize: 9, fontWeight: '600' },
  address: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 1, paddingLeft: 2 },
  addressLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.55 },
  addressTitle: { fontSize: 10, fontWeight: '700', lineHeight: 12 },
  actions: { flexDirection: 'row', alignSelf: 'flex-start', marginTop: 3, gap: 2 },
  actionBtn: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center' },
  actionCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -1, right: -1, minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 999, borderWidth: 1, fontSize: 9, fontWeight: '900', textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', lineHeight: 15 },
  dot: { position: 'absolute', top: 1, right: 1, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  switcher: { flexDirection: 'row', gap: 6, paddingVertical: 8, paddingHorizontal: 12 },
  switchBtn: { flex: 1, height: 36, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  switchText: { fontSize: 13, fontWeight: '800' },
  searchPill: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingLeft: 13, paddingRight: 10, elevation: 3, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
  searchTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 34 },
  searchPlaceholder: { flex: 1, fontSize: 13.5, opacity: 0.8 },
  mic: { padding: 3, alignItems: 'center', justifyContent: 'center' },
  subItem: { minWidth: 68, maxWidth: 96, flexGrow: 1, alignItems: 'center', gap: 4, paddingTop: 4, paddingBottom: 9, paddingHorizontal: 4 },
  subIcon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  subLabel: { color: '#fff', fontSize: 10, lineHeight: 11.5, textAlign: 'center', maxWidth: 70, textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 2, textShadowOffset: { width: 0, height: 1 } },
  activeLine: { position: 'absolute', bottom: 1, width: 28, height: 3, borderRadius: 999 },
  tabPhoto: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
});
