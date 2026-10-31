// Port of LandingPage.jsx (activeNav 'home'): header, announcement, festive header, hero, discovery shortcuts,
// service cards, popular categories, Studio sections (or "Fresh finds for you"), and the storefront's own body
// for the selected sub-nav tab.
import React, { useCallback, useState } from 'react';
import { BackHandler, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Svg, { Line, Path, Polyline } from 'react-native-svg';
import { useUser } from '../context/UserContext';
import { useStorefront } from '../context/StorefrontContext';
import { useAppTheme } from '../theme/ThemeContext';
import { clearCatalogCache } from '../hooks/useProducts';
import { clearCategoryCache } from '../hooks/useCategoryTree';
import { emit, EVENTS } from '../lib/events';
import { useRefreshHandler, runRefresh } from '../lib/refresh';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { HeaderTop, HeaderPinned } from '../components/UnifiedHeader';
import HeroBanner, { StorefrontFestiveHeader } from '../components/storefront/HeroBanner';
import { HomeServiceEntries } from '../components/services/ServiceEntries';
import {
  HOME_NEAR_END, QuickActions, PopularCategories, StorefrontSections, StorefrontAnnouncement, TopProducts,
  VegetablesSection, MilkSection, ElectronicsSection, MensWearSection, WomenWearSection, ChildWearSection,
  CouponsSection, FashionSection, GroceriesSection, DynamicCategorySection,
} from '../components/home/HomeSections';
import { Text } from '../components/ui';

const isSlug = subNav => /^(grocery|ecommerce)--/.test(subNav || '');

function StorefrontBody({ activeMode, activeSubNav, hasSections }) {
  const homeTab = ['home', 'grocery--home', 'smart-buy', 'ecommerce--smart-buy'].includes(activeSubNav);
  if (homeTab && hasSections) return null;
  const s = String(activeSubNav || '');
  const isGroceries = s === 'groceries' || s.endsWith('--groceries');
  const isElectronics = s === 'electronics' || s.endsWith('--electronics');
  const isCoupons = s === 'coupons' || s.endsWith('--coupons') || s === 'hot-deals' || s.endsWith('--hot-deals');
  const isFashion = s === 'garments' || s === 'fashion' || s.endsWith('--garments') || s.endsWith('--fashion') || s.endsWith('--clothing-and-handlooms');
  const shopAllDefault = <><ElectronicsSection /><MensWearSection /><WomenWearSection /><ChildWearSection /></>;
  if (activeMode === 'quick') {
    if (s === 'grocery--home') return <><VegetablesSection /><MilkSection /></>;
    if (isSlug(s)) return <DynamicCategorySection channel="grocery" slug={s} />;
    if (isGroceries) return <GroceriesSection />;
    if (isElectronics) return <ElectronicsSection />;
    if (isCoupons) return <CouponsSection />;
    if (isFashion) return <FashionSection />;
    return null;
  }
  if (isCoupons) return <CouponsSection />;
  if (isFashion) return <><MensWearSection /><WomenWearSection /><ChildWearSection /></>;
  if (s === 'ecommerce--smart-buy') return shopAllDefault;
  if (isSlug(s)) return isElectronics ? <ElectronicsSection /> : <DynamicCategorySection channel="ecommerce" slug={s} />;
  return shopAllDefault;
}

function ExitDialog({ visible, onCancel, onExit }) {
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
    <View style={styles.exitOverlay}>
      <View style={styles.exitCard} accessibilityViewIsModal>
        <View style={styles.exitIcon}>
          <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></Svg>
        </View>
        <Text style={styles.exitTitle}>Exit Bulkimart?</Text>
        <Text style={styles.exitText}>Are you sure you want to exit the application?</Text>
        <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
          <Pressable onPress={onCancel} style={[styles.exitBtn, { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }]}><Text style={{ color: '#475569', fontWeight: '600', fontSize: 14 }}>Cancel</Text></Pressable>
          <Pressable onPress={onExit} style={[styles.exitBtn, { backgroundColor: '#dc2626' }]}><Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Exit</Text></Pressable>
        </View>
      </View>
    </View>
  </Modal>;
}

export default function HomeScreen() {
  const theme = useAppTheme();
  const experience = useStorefront();
  const { activeMode, activeSubNav, popSubNav, fetchOrders, refreshCart, cartChannel } = useUser();
  const [contentKey, setContentKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const bottom = useNavPadding(30);

  useRefreshHandler(async () => {
    clearCatalogCache(); clearCategoryCache();
    emit(EVENTS.SOFT_REFRESH);
    await Promise.allSettled([fetchOrders?.(), refreshCart?.(cartChannel)]);
    setContentKey(key => key + 1);
  });
  const onRefresh = async () => { setRefreshing(true); try { await runRefresh(); } finally { setRefreshing(false); } };

  // Android back on Home: previous sub-nav tab first, then "Exit Bulkimart?" (web exit guard).
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (popSubNav()) return true;
      setConfirmExit(true);
      return true;
    });
    return () => sub.remove();
  }, [popSubNav]));

  const showDashboard = activeMode === 'shop-all' || activeSubNav === 'grocery--home';
  return <CustomerPage headerColor={theme.header} cartBar>
    <ScrollView stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.action]} />}
      onScroll={e => { const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent; if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 600) emit(HOME_NEAR_END); }}
      scrollEventThrottle={250} contentContainerStyle={{ paddingBottom: bottom, backgroundColor: theme.pageBackground }}>
      <HeaderTop />
      <HeaderPinned />
      <View key={contentKey} style={{ backgroundColor: theme.background, paddingTop: 12, paddingBottom: 28, gap: 20 }}>
        <StorefrontAnnouncement />
        <StorefrontFestiveHeader />
        <HeroBanner />
        {showDashboard && <>
          <QuickActions />
          <HomeServiceEntries />
          <PopularCategories />
          {experience.sections.length ? <StorefrontSections /> : <TopProducts />}
        </>}
        <StorefrontBody activeMode={activeMode} activeSubNav={activeSubNav} hasSections={experience.sections.length > 0} />
      </View>
    </ScrollView>
    <ExitDialog visible={confirmExit} onCancel={() => setConfirmExit(false)} onExit={() => { setConfirmExit(false); BackHandler.exitApp(); }} />
  </CustomerPage>;
}

const styles = StyleSheet.create({
  exitOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  exitCard: { width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, paddingTop: 24, paddingHorizontal: 20, paddingBottom: 20, alignItems: 'center', elevation: 12 },
  exitIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  exitTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  exitText: { fontSize: 14, color: '#64748b', lineHeight: 20, marginBottom: 20, textAlign: 'center' },
  exitBtn: { flex: 1, padding: 12, borderRadius: 12, alignItems: 'center' },
});
