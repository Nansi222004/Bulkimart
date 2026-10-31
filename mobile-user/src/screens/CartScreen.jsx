// Port of modules/User/pages/CartPage.jsx — one basket across Quick Commerce, E-Commerce and Wholesale.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { request } from '../api/client';
import { emit, EVENTS } from '../lib/events';
import { captureUserSession, isCurrentUserSession } from '../lib/session';
import { useRefreshHandler, runRefresh } from '../lib/refresh';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Spinner, Text } from '../components/ui';
import { AppliedCoupon, BasketGroups, BasketSummary, CartAlert, CartEmptyState, CouponThresholdProgress, PrimaryButton, SecondaryButton } from '../components/cart/CartUI';

const logoIcon = require('../../assets/images/logo-icon-transparent.png');
const channelKey = group => (group.salesChannel === 'wholesale' ? 'wholesale' : group.channel);

export default function CartScreen() {
  const theme = useAppTheme();
  const params = useLocalSearchParams();
  const { getDeliveryPoint, getPricingPoint, setActiveNav, refreshCart, addToWishlist, couponCode, appliedCoupon, availableCoupons, removeCoupon, couponNotice, serverCart, cartChannel, switchCartChannel, cartLoading } = useUser();
  const navigate = usePromotionNavigation();
  const basket = useUnifiedCart((getPricingPoint || getDeliveryPoint)?.(), couponCode, 'basket');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [refreshing, setRefreshing] = useState(false);
  const lock = useRef(false);
  const scroll = useRef(null);
  const groupY = useRef({});
  const focusedWholesale = useRef(false);
  const bottom = useNavPadding(16);
  const data = basket.data;
  const groups = data?.groups || [];
  const items = groups.flatMap(group => group.items);
  const digital = items.filter(item => item.fulfillmentType === 'digital');
  const mixedDigital = digital.length > 0 && digital.length !== items.length;
  const singleRetail = groups.length === 1 && groups[0].salesChannel !== 'wholesale';
  const channelQuoteReady = singleRetail && groups[0].channel === cartChannel && serverCart?.channel === cartChannel && serverCart.items?.length > 0 && Boolean(serverCart.pricing);
  const summaryData = singleRetail ? { ...data, totals: channelQuoteReady && data?.totals ? serverCart.pricing : null } : data;
  const pricingPending = singleRetail && (cartLoading || !channelQuoteReady);
  const refreshPrices = async () => { await Promise.all([basket.reload(), refreshCart?.()]); };
  useRefreshHandler(refreshPrices);
  useEffect(() => { if (singleRetail && groups[0].channel !== cartChannel) switchCartChannel(groups[0].channel); }, [singleRetail, groups[0]?.channel, cartChannel, switchCartChannel]); // eslint-disable-line react-hooks/exhaustive-deps
  const shopMore = offer => {
    if (offer.shopMore?.type === 'product') navigate({ type: 'PRODUCT', id: offer.shopMore.id });
    else if (offer.shopMore?.type === 'category') navigate({ type: 'CATEGORY', id: offer.shopMore.id, slug: offer.shopMore.id });
    else setActiveNav('categories');
  };
  const scrollToChannel = channel => { const y = groupY.current[channel]; if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }); };
  useEffect(() => {
    if (focusedWholesale.current || !data || params.channel !== 'wholesale') return undefined;
    const timer = setTimeout(() => { if (groupY.current.wholesale !== undefined) { scrollToChannel('wholesale'); focusedWholesale.current = true; } }, 300);
    return () => clearTimeout(timer);
  }, [data, params.channel]);
  const mutate = async (path, method, body) => {
    if (lock.current || basket.loading) return;
    lock.current = true; setBusy(true); setError('');
    const snapshot = captureUserSession();
    try {
      const { ok, body: result } = await request(path, { method, body });
      if (!isCurrentUserSession(snapshot)) return;
      if (!ok) throw new Error(result.message || 'Could not update your cart');
      await basket.reload();
      emit(EVENTS.CART_CHANGED);
      refreshCart?.();
    } catch (err) { if (isCurrentUserSession(snapshot)) setError(err.message); } finally { lock.current = false; setBusy(false); }
  };
  const pathFor = (item, group) => `/api/cart/${group.salesChannel === 'wholesale' ? 'wholesale/' : ''}${item.itemId}`;
  const remove = (item, group) => mutate(pathFor(item, group), 'DELETE');
  const channels = [...new Set(groups.map(channelKey))];
  const onRefresh = async () => { setRefreshing(true); try { await runRefresh(); } finally { setRefreshing(false); } };

  return <CustomerPage headerColor="#ffffff">
    <View style={[styles.heading, { borderBottomColor: theme.border }]}>
      <View style={styles.headingInner}>
        <View style={styles.logo}><Image source={logoIcon} style={{ width: '100%', height: '100%' }} contentFit="contain" /></View>
        <View style={{ flex: 1 }}><Text style={styles.brand}>Bulkimart</Text><Text style={styles.h1}>Shopping Cart</Text></View>
        <Pressable onPress={() => setActiveNav('home')} accessibilityLabel="Continue shopping" style={[styles.continue, { borderColor: theme.border, backgroundColor: theme.pageBackground }]}><Text style={{ color: theme.primaryColor, fontSize: 12, fontWeight: '700' }}>Shop →</Text></Pressable>
      </View>
      <Text style={styles.sub}>Quick Commerce, E-Commerce and Wholesale in one basket.</Text>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={{ padding: 12, paddingTop: 16, gap: 16, paddingBottom: bottom }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.action]} />}>
      {(error || basket.error) ? <CartAlert action={<SecondaryButton title="Refresh prices" onPress={refreshPrices} disabled={busy || basket.loading || cartLoading} style={{ alignSelf: 'flex-start' }} />}>{error || basket.error}</CartAlert> : null}
      {basket.loading && !data && <View style={[styles.loading, { borderColor: theme.border }]} accessibilityLiveRegion="polite"><Spinner /><Text style={{ color: theme.muted, fontSize: 14 }}>Refreshing your basket…</Text></View>}
      {data?.warnings?.map(message => <CartAlert key={message}>{message}</CartAlert>)}
      {!basket.loading && data && !items.length && <CartEmptyState onBrowse={() => setActiveNav('home')} />}
      {items.length > 0 && <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel="Basket channels">
          {channels.map(channel => <Pressable key={channel} onPress={() => scrollToChannel(channel)} style={[styles.anchor, { borderColor: theme.border }]}><Text style={{ color: theme.primaryColor, fontSize: 13, fontWeight: '600' }}>{channel === 'wholesale' ? 'Wholesale' : channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}</Text></Pressable>)}
          <SecondaryButton title="Refresh prices" disabled={busy || basket.loading || cartLoading} onPress={refreshPrices} />
        </View>
        {mixedDigital && <CartAlert>Digital and physical products require separate checkout. Remove one type before ordering.</CartAlert>}
        {groups.map((group, index) => <View key={group.key} onLayout={e => { if (groups.findIndex(other => channelKey(other) === channelKey(group)) === index) groupY.current[channelKey(group)] = e.nativeEvent.layout.y; }}>
          <BasketGroups groups={[group]} showTotals={groups.length > 1} busy={busy || basket.loading}
            onQuantity={(item, section, qty) => mutate(pathFor(item, section), 'PUT', { qty })}
            onRemove={remove}
            onMessage={(item, message) => mutate(`/api/cart/items/${item.itemId}/message`, 'PATCH', { additionalMessage: message })}
            onWishlist={async (item, section) => { const result = await addToWishlist(item.productId); if (result.ok) await remove(item, section); else setError(result.message); }}
            onMode={async (section, mode) => { const result = await basket.setGroupMode(section, mode); if (!result.ok) setError(result.message); else await refreshCart?.(); }} />
        </View>)}
        <View style={{ gap: 16 }}>
          <BasketSummary data={summaryData} />
          {pricingPending && <Text style={styles.note} accessibilityLiveRegion="polite">Updating payment summary…</Text>}
          {singleRetail && groups[0].channel === cartChannel && <>
            <CouponThresholdProgress offers={availableCoupons} appliedCode={appliedCoupon?.code} onShopMore={shopMore} />
            {couponNotice ? <Text style={{ marginVertical: 8, color: theme.primary, fontSize: 12, fontWeight: '600' }}>{couponNotice}</Text> : null}
            {appliedCoupon && <AppliedCoupon code={appliedCoupon.code} detail={serverCart.pricing?.couponFreeShipping ? 'Free delivery' : `Saved ₹${Number(serverCart.pricing?.couponDiscount || 0).toLocaleString('en-IN')}`} onRemove={removeCoupon} />}
          </>}
          <PrimaryButton title="Proceed to Checkout" disabled={busy || basket.loading || pricingPending || data.valid === false || mixedDigital || !summaryData?.totals} onPress={() => setActiveNav('checkout')} />
          <Text style={styles.note}>Review your delivery address and payment at checkout.</Text>
        </View>
      </>}
    </ScrollView>
  </CustomerPage>;
}

const styles = StyleSheet.create({
  heading: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: '#fff', borderBottomWidth: 1 },
  headingInner: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  logo: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#fff' },
  brand: { fontFamily: 'Outfit', fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.5 },
  h1: { fontFamily: 'Outfit', fontSize: 20, fontWeight: '700', lineHeight: 26, color: '#172b4d' },
  continue: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, justifyContent: 'center' },
  sub: { fontFamily: 'Outfit', marginTop: 8, color: '#64748b', fontSize: 13, lineHeight: 19 },
  loading: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, backgroundColor: '#fff' },
  anchor: { paddingVertical: 10, paddingHorizontal: 14, minHeight: 44, borderWidth: 1, borderRadius: 24, backgroundColor: '#fff', justifyContent: 'center' },
  note: { textAlign: 'center', fontSize: 12, color: '#64748b' },
});
