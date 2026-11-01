import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AppInput from '../../components/AppInput';
import StatusPill from '../../components/StatusPill';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { listSellerOrders } from '../../services/seller.api';
import { useAuth } from '../../context/AuthContext';
import { ORDER_LABEL, ORDER_TABS, matchesOrderTab, sellerOrderTotal } from '../../utils/orderAmounts';
import { dateTime, orderMoney } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/OrdersTab.jsx (list part).
// The server returns only this seller's lines from each order.
// All statuses are loaded once and the tabs filter locally, as on web.
const SCOPES = [
  { value: 'all', label: 'All storefronts' },
  { value: 'ecommerce', label: 'Shop All' },
  { value: 'grocery', label: 'Quick Commerce' },
];

const Chip = ({ label, active, onPress, count }) => (
  <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}>
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}{count != null ? ` (${count})` : ''}</Text>
  </Pressable>
);

function OrderCard({ order, onPress }) {
  const total = sellerOrderTotal(order);
  const returnReason = order.returnReason || order.returnRequest?.reason;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Order ${order.orderNo}`} onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.05)' }} style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.orderNo}>{order.orderNo}{order.salesChannel === 'wholesale' ? ' · Wholesale' : ''}</Text>
        <StatusPill status={order.status} label={order.displayStatus || ORDER_LABEL[order.status] || order.status} />
      </View>
      <View style={styles.rowBetween}>
        <View style={styles.flex}>
          <Text style={type.label}>{order.customer?.name || 'Customer'}</Text>
          <Text style={type.small}>
            {dateTime(order.placedAt)} • {order.itemCount} item{order.itemCount === 1 ? '' : 's'}{order.customer?.city ? ` • ${order.customer.city}` : ''}
          </Text>
        </View>
        <View style={styles.amountBox}>
          <Text style={type.small}>{total.label}</Text>
          <Text style={styles.amount}>{orderMoney(total.value)}</Text>
          {order.sellerAmounts?.totalDiscount > 0 ? <Text style={type.small}>Discount: {orderMoney(order.sellerAmounts.totalDiscount)}</Text> : null}
        </View>
      </View>
      {order.deliveryMode === 'same_day' ? (
        <Text style={styles.sameDay}>⚡ Same-day — a rider collects this{order.promisedBy ? ` · by ${new Date(order.promisedBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}</Text>
      ) : null}
      {order.shiprocket?.awb ? <Text style={type.small}>📦 {order.shiprocket.courier} • {order.shiprocket.awb}</Text> : null}
      {(returnReason || order.returnDescription || order.returnRequest) ? (
        <Text style={styles.returnNote}>↩️ Return requested: {String(returnReason || '').replace(/_/g, ' ')}</Text>
      ) : null}
    </Pressable>
  );
}

export default function OrdersScreen({ navigation, route }) {
  const { salesChannels } = useAuth();
  const isHybrid = salesChannels.includes('ecommerce') && salesChannels.includes('grocery');
  const [tab, setTab] = useState(route.params?.tab || 'all');
  const [scope, setScope] = useState('all');
  const [search, setSearch] = useState('');

  // The dashboard deep-links here with a tab.
  useEffect(() => { if (route.params?.tab) setTab(route.params.tab); }, [route.params?.tab]);

  const loader = useCallback(async () => {
    const body = await listSellerOrders({ type: scope === 'all' ? undefined : scope, status: 'all', limit: 100 });
    return Array.isArray(body?.data) ? body.data : [];
  }, [scope]);
  const { data: orders, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  // Re-read when coming back from an order detail, where the status may have changed.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    refresh();
  }, [refresh]));

  const list = useMemo(() => orders || [], [orders]);
  const counts = useMemo(() => ({
    pending: list.filter((o) => ['placed', 'confirmed', 'preparing'].includes(o.status)).length,
    delivered: list.filter((o) => o.status === 'delivered').length,
  }), [list]);
  const shown = useMemo(() => {
    const query = search.toLowerCase().trim();
    return list.filter((o) => matchesOrderTab(o, tab)
      && (!query || (o.orderNo || '').toLowerCase().includes(query) || (o.customer?.name || '').toLowerCase().includes(query)));
  }, [list, tab, search]);

  const header = (
    <View style={styles.header}>
      <View style={styles.summary}>
        <View style={styles.summaryItem}><Text style={styles.summaryValue}>{list.length}</Text><Text style={type.small}>Total</Text></View>
        <View style={styles.summaryItem}><Text style={[styles.summaryValue, { color: colors.orange }]}>{counts.pending}</Text><Text style={type.small}>Pending</Text></View>
        <View style={styles.summaryItem}><Text style={[styles.summaryValue, { color: colors.success }]}>{counts.delivered}</Text><Text style={type.small}>Delivered</Text></View>
      </View>
      {isHybrid ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {SCOPES.map((s) => <Chip key={s.value} label={s.label} active={scope === s.value} onPress={() => setScope(s.value)} />)}
        </ScrollView>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        {ORDER_TABS.map((t) => <Chip key={t.value} label={t.label} active={tab === t.value} onPress={() => setTab(t.value)} />)}
      </ScrollView>
      <AppInput placeholder="Search order number or customer" value={search} onChangeText={setSearch} returnKeyType="search" autoCorrect={false} />
    </View>
  );

  if (loading && !orders) return <LoadingView message="Loading your orders…" />;
  if (error && !orders) return <ErrorView message={error} onRetry={reload} />;

  return (
    <FlatList
      data={shown}
      keyExtractor={(item) => String(item._id)}
      renderItem={({ item }) => <OrderCard order={item} onPress={() => navigation.navigate('OrderDetail', { id: item._id, orderNo: item.orderNo })} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyView title="No orders" message={list.length ? 'No orders match this filter.' : 'New orders will appear here.'} />}
      contentContainerStyle={styles.listContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={10}
      windowSize={7}
      style={styles.list}
    />
  );
}

const styles = StyleSheet.create({
  list: { backgroundColor: colors.surface },
  listContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { gap: spacing.md },
  summary: { flexDirection: 'row', gap: spacing.sm },
  summaryItem: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  chips: { gap: spacing.sm },
  chip: { paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipActive: { borderColor: colors.primaryDark, backgroundColor: colors.aquaLight },
  chipText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.primaryDark },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  flex: { flex: 1 },
  orderNo: { fontSize: 14, fontWeight: '800', color: colors.deepBlue, flexShrink: 1 },
  amountBox: { alignItems: 'flex-end' },
  amount: { fontSize: 16, fontWeight: '800', color: colors.text },
  sameDay: { fontSize: 12, color: '#166534', fontWeight: '800' },
  returnNote: { fontSize: 12, color: '#c2410c', backgroundColor: '#fff7ed', padding: 8, borderRadius: radius.sm },
});
