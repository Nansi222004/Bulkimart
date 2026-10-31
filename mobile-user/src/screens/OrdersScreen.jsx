// Port of modules/User/pages/OrdersPage.jsx — "MY ORDERS" list with search, filters and the push opt-in prompt.
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as Notifications from 'expo-notifications';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { mediaUrl } from '../api/client';
import { session } from '../lib/storage';
import { deliveryLabelFor } from '../lib/deliveryLabel';
import { useRefreshHandler } from '../lib/refresh';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Text } from '../components/ui';
import { ChevronLeft, ChevronRight, SearchIcon } from '../components/icons';
import SelectField from '../components/SelectField';
import Svg, { Line } from 'react-native-svg';

export const CHANNEL_LABEL = { grocery: 'Quick', ecommerce: 'Shop All' };
export const STATUS_LABEL = {
  placed: 'Order Placed', confirmed: 'Confirmed', preparing: 'Confirmed', dispatched: 'Dispatched', out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered', cancelled: 'Cancelled', return_requested: 'Return Requested', returned: 'Returned', refunded: 'Refunded',
};
const STATUS_CLASS = { delivered: 'delivered', cancelled: 'cancelled', returned: 'cancelled', refunded: 'cancelled', placed: 'pending', confirmed: 'confirmed', preparing: 'confirmed', dispatched: 'shipped', out_for_delivery: 'shipped', return_requested: 'pending' };
const STATUS_COLOR = { delivered: '#172b4d', cancelled: '#172b4d', pending: '#b45309', confirmed: '#1d4ed8', shipped: '#166534' };

const FilterGlyph = ({ color }) => <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round">
  <Line x1="4" y1="21" x2="4" y2="14" /><Line x1="4" y1="10" x2="4" y2="3" /><Line x1="12" y1="21" x2="12" y2="12" /><Line x1="12" y1="8" x2="12" y2="3" /><Line x1="20" y1="21" x2="20" y2="16" /><Line x1="20" y1="12" x2="20" y2="3" /><Line x1="1" y1="14" x2="7" y2="14" /><Line x1="9" y1="8" x2="15" y2="8" /><Line x1="17" y1="16" x2="23" y2="16" />
</Svg>;

/** Notification permission not decided yet (web: Notification.permission === 'default'). */
function usePermissionUndecided() {
  const [undecided, setUndecided] = useState(false);
  const check = useCallback(() => { Notifications.getPermissionsAsync().then(r => setUndecided(r.status === 'undetermined' && r.canAskAgain !== false)).catch(() => {}); }, []);
  useEffect(() => { check(); }, [check]);
  return [undecided, check];
}

export default function OrdersScreen() {
  const theme = useAppTheme();
  const { setActiveNav, orders, ordersLoading, ordersError, setSelectedOrder, fetchOrders, requestPushPermission } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [pushDismissed, setPushDismissed] = useState(() => session.getItem('push_prompt_dismissed') === 'true');
  const [permissionUndecided, recheckPermission] = usePermissionUndecided();
  const [refreshing, setRefreshing] = useState(false);
  const bottom = useNavPadding(16);
  useRefreshHandler(fetchOrders);
  const showPushPrompt = permissionUndecided && !pushDismissed;
  const primary = theme.primaryColor;

  const rows = (orders || []).map(o => {
    const first = o.items?.[0] || {};
    const extra = (o.items?.length || 0) - 1;
    return {
      id: o._id, orderNo: o.orderNo, productName: extra > 0 ? `${first.name} +${extra} more` : (first.name || 'Order'),
      img: first.image || '', qty: o.items?.reduce((n, i) => n + i.qty, 0) || 0, total: o.pricing?.totalAmount ?? 0,
      status: STATUS_LABEL[o.status] || o.status, statusType: STATUS_CLASS[o.status] || 'pending',
      dateText: new Date(o.createdAt).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' }),
      channel: o.salesChannel === 'wholesale' ? 'Wholesale' : CHANNEL_LABEL[o.type] || 'Order', delivery: deliveryLabelFor(o), raw: o,
    };
  });
  const q = searchQuery.trim().toLowerCase();
  const filtered = rows.filter(o => (statusFilter === 'all' || o.raw.status === statusFilter || (statusFilter === 'confirmed' && o.raw.status === 'preparing'))
    && (channelFilter === 'all' || o.channel === channelFilter)
    && (!q || o.productName.toLowerCase().includes(q) || o.status.toLowerCase().includes(q) || (o.orderNo || '').toLowerCase().includes(q)));
  const onRefresh = async () => { setRefreshing(true); try { await fetchOrders(); } finally { setRefreshing(false); } };

  const header = <View>
    <View style={styles.headerRow}>
      <Pressable onPress={() => setActiveNav('home')} accessibilityLabel="Go back to Home" hitSlop={10}><ChevronLeft size={20} width={2.5} color={theme.textPrimary} /></Pressable>
      <Text style={styles.title}>MY ORDERS</Text>
      <View style={{ width: 20 }} />
    </View>
    <View style={{ height: 1, backgroundColor: '#f1f5f9' }} />
    {showPushPrompt && <View style={styles.push}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}><Text style={{ fontSize: 16 }}>🔔</Text><Text style={{ color: '#0369a1', fontSize: 12.5, flexShrink: 1, lineHeight: 18 }}>Enable notifications to get real-time order updates & delivery alerts.</Text></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={async () => { await requestPushPermission?.(); setPushDismissed(true); recheckPermission(); }} style={styles.enable}><Text style={{ color: '#fff', fontWeight: '600', fontSize: 12 }}>Enable</Text></Pressable>
        <Pressable onPress={() => { setPushDismissed(true); session.setItem('push_prompt_dismissed', 'true'); }} accessibilityLabel="Dismiss" hitSlop={8}><Text style={{ color: '#0369a1', fontWeight: '700', fontSize: 13 }}>✕</Text></Pressable>
      </View>
    </View>}
    <View style={styles.searchRow}>
      <View style={styles.searchWrap}>
        <SearchIcon size={16} width={2.5} color="#94a3b8" />
        <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search orders" placeholderTextColor="#94a3b8" style={[styles.searchInput, { color: theme.textPrimary }]} returnKeyType="search" />
      </View>
      <Pressable onPress={() => setFiltersOpen(v => !v)} accessibilityLabel="Open filters" accessibilityState={{ expanded: filtersOpen }} style={styles.filterBtn}>
        <FilterGlyph color={primary} /><Text style={{ color: primary, fontSize: 13, fontWeight: '800' }}>Filters</Text>
      </Pressable>
    </View>
    {filtersOpen && <View style={styles.filterPanel}>
      <SelectField label="Order status" value={statusFilter} onChange={setStatusFilter} style={{ flexGrow: 1, flexBasis: 140 }}
        options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUS_LABEL).filter(([value]) => value !== 'preparing').map(([value, label]) => ({ value, label }))]} />
      <SelectField label="Storefront" value={channelFilter} onChange={setChannelFilter} style={{ flexGrow: 1, flexBasis: 140 }}
        options={[{ value: 'all', label: 'All storefronts' }, ...[...Object.values(CHANNEL_LABEL), 'Wholesale'].map(label => ({ value: label, label }))]} />
      <Pressable onPress={() => { setStatusFilter('all'); setChannelFilter('all'); }} style={styles.panelBtn}><Text style={{ color: primary, fontWeight: '700' }}>Clear filters</Text></Pressable>
      <Pressable onPress={() => setFiltersOpen(false)} style={styles.panelBtn}><Text style={{ color: primary, fontWeight: '700' }}>Done</Text></Pressable>
    </View>}
  </View>;

  return <CustomerPage protectedPage headerColor="#ffffff" background="#ffffff">
    {header}
    <FlatList data={filtered} keyExtractor={o => String(o.id)} contentContainerStyle={{ paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.action]} />}
      ItemSeparatorComponent={() => <View style={{ height: 8, backgroundColor: '#f1f5f9' }} />}
      ListFooterComponent={<>
        {filtered.length > 0 && <View style={{ height: 8, backgroundColor: '#f1f5f9' }} />}
        {ordersLoading && <Text style={styles.empty}>Loading your orders…</Text>}
        {ordersError ? <Text style={styles.empty} accessibilityRole="alert">{ordersError} <Text onPress={fetchOrders} style={{ textDecorationLine: 'underline', fontWeight: '700' }}>Retry</Text></Text> : null}
        {!ordersLoading && !ordersError && filtered.length === 0 && <Text style={styles.empty}>{searchQuery ? `No orders match "${searchQuery}".` : statusFilter !== 'all' || channelFilter !== 'all' ? 'No orders match these filters.' : 'You have not placed any orders yet.'}</Text>}
      </>}
      renderItem={({ item: order }) => <Pressable onPress={() => setSelectedOrder(order.raw)} style={styles.card} accessibilityRole="button" accessibilityLabel={`${order.status}, ${order.productName}`}>
        <View style={[styles.imgBox, { borderColor: theme.border }]}>
          {order.img ? <Image source={{ uri: mediaUrl(order.img) }} style={{ width: '90%', height: '90%' }} contentFit="contain" /> : <View style={{ width: '90%', height: '90%', backgroundColor: theme.border }} />}
        </View>
        <View style={{ flex: 1, gap: 2.5, overflow: 'hidden' }}>
          <Text style={{ fontSize: 12.5, fontWeight: '800', color: STATUS_COLOR[order.statusType] || '#172b4d' }}>{order.status}</Text>
          <Text style={{ fontSize: 11, color: theme.textSecondary, fontWeight: '700' }}>{order.dateText}</Text>
          <Text style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: '600' }}>{order.orderNo}  •  Qty: {order.qty}  •  ₹{order.total}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Text style={[styles.badge, { backgroundColor: '#a855f7' }]}>{order.channel}</Text>
            {order.delivery && <Text style={[styles.badge, { backgroundColor: order.delivery.tone === 'sameday' ? '#dcfce7' : '#e2e8f0', color: order.delivery.tone === 'sameday' ? '#166534' : '#475569' }]}>{order.delivery.icon} {order.delivery.text}</Text>}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          {order.raw.paymentMethod === 'online' && order.raw.status === 'placed' && <Pressable onPress={() => setSelectedOrder(order.raw)} style={[styles.detailsBtn, { borderColor: theme.border }]}><Text style={{ color: theme.action, fontSize: 13, fontWeight: '700' }}>Order Details</Text></Pressable>}
          {order.raw.status === 'delivered' && <Pressable onPress={() => setSelectedOrder(order.raw)} style={[styles.rate, { borderColor: primary }]}><Text style={{ color: primary, fontSize: 10.5, fontWeight: '800' }}>⭐ Rate Items</Text></Pressable>}
          <ChevronRight size={18} width={2.5} color="#94a3b8" />
        </View>
      </Pressable>} />
  </CustomerPage>;
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: '#fff' },
  title: { fontSize: 14, fontWeight: '800', letterSpacing: 0.8 },
  push: { marginTop: 10, marginHorizontal: 16, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: 'rgba(20,110,180,0.1)', borderWidth: 1, borderColor: 'rgba(20,110,180,0.3)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  enable: { backgroundColor: '#0284c7', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6 },
  searchRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#fff', borderBottomWidth: 1.5, borderBottomColor: '#f1f5f9' },
  searchWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingVertical: 4, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 13, fontWeight: '600', paddingVertical: 6 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 4, minHeight: 44 },
  filterPanel: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  panelBtn: { minHeight: 44, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 12, justifyContent: 'center' },
  card: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 16, backgroundColor: '#fff' },
  imgBox: { width: 72, height: 72, borderRadius: 14, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  badge: { alignSelf: 'flex-start', color: '#fff', fontSize: 8.5, fontWeight: '800', paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 4, marginTop: 1.5, letterSpacing: 0.2, overflow: 'hidden' },
  detailsBtn: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, backgroundColor: '#fff', justifyContent: 'center' },
  rate: { borderWidth: 1.5, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 10 },
  empty: { paddingVertical: 40, paddingHorizontal: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12, fontWeight: '600' },
});
