import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppInput from '../../components/AppInput';
import ChipRow from '../../components/ChipRow';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import useSellerChannel, { CHANNEL_LABEL } from '../../hooks/useSellerChannel';
import { listSellerOrders } from '../../services/seller.api';
import { sellerTimeline } from '../../utils/orderAmounts';
import { orderMoney } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of TrackOrderTab.jsx. Everything shown comes from the seller orders list; the only
// delivery estimate the backend sends sellers is `promisedBy` (same-day), so no ETA is invented.
const STATUS_LABEL = {
  placed: 'Order placed', confirmed: 'Payment confirmed', preparing: 'Being prepared', dispatched: 'Dispatched from you',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled', return_requested: 'Return requested',
  returned: 'Returned', refunded: 'Refunded',
};
const FILTERS = [{ value: 'ACTIVE', label: 'Active' }, { value: 'COMPLETED', label: 'Completed' }, { value: 'ALL', label: 'All' }];
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const deliveredAtOf = (o) => o.deliveryAssignment?.completedAt || [...(o.timeline || [])].reverse().find((t) => t.status === 'delivered')?.timestamp;
const isToday = (d) => Boolean(d) && new Date(d).toDateString() === new Date().toDateString();
const partnerName = (o) => o.deliveryPartner?.name || o.deliveryAssignment?.rider?.name || o.shiprocket?.courier
  || o.fulfillment?.courierName || o.fulfillment?.trackingPartner || o.fulfillment?.partnerName || (o.deliveryType === 'shiprocket' ? 'Shiprocket' : '') || '';
const partnerPhone = (o) => o.deliveryPartner?.phone || o.deliveryAssignment?.rider?.phone || '';
const httpsUrl = (url) => { try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; } };

function TrackCard({ order, open, onToggle, onOpenOrder }) {
  const trail = sellerTimeline(order.timeline).reverse(); // newest first
  const partner = partnerName(order);
  const phone = partnerPhone(order);
  const ship = order.shiprocket;
  const trackingUrl = httpsUrl(ship?.trackingUrl);
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={onToggle} style={styles.cardHead}>
        <View style={styles.flex}>
          <Text style={type.label}>{order.orderNo}</Text>
          <Text style={type.small}>{order.customer?.name || 'Customer'} · {order.customer?.city || '—'} {order.customer?.pincode || ''}</Text>
          <Text style={type.small}>{order.itemCount} item{order.itemCount === 1 ? '' : 's'} · {orderMoney(order.subtotal)}</Text>
          {partner ? <Text style={styles.partner}>🚚 Partner: {partner}{phone ? ` (${phone})` : ''}</Text> : null}
          {ship?.awb ? <Text style={type.small}>AWB {ship.awb}{ship.status ? ` · ${ship.status}` : ''}</Text> : null}
          {order.promisedBy ? <Text style={styles.promise}>⚡ Promised by {fmt(order.promisedBy)}</Text> : null}
        </View>
        <View style={styles.right}>
          <Text style={styles.status}>{STATUS_LABEL[order.status] || order.status}</Text>
          <Text style={styles.toggle}>{open ? 'Hide trail ▲' : 'Show trail ▼'}</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.trail}>
          {trail.length ? trail.map((t, i) => (
            <View key={`${t.status}-${i}`} style={styles.step}>
              <View style={[styles.dot, i === 0 && styles.dotActive]} />
              <View style={styles.flex}>
                <Text style={[type.label, i === 0 && { color: '#1d4ed8' }]}>{t.note && trail[i + 1]?.status === t.status ? t.note : STATUS_LABEL[t.status] || t.status}</Text>
                {t.note && trail[i + 1]?.status !== t.status ? <Text style={type.small}>{t.note}</Text> : null}
                <Text style={styles.time}>{fmt(t.timestamp)}</Text>
              </View>
            </View>
          )) : <Text style={type.small}>No status history recorded yet.</Text>}
          {ship?.webhookEvents?.length ? (
            <Text style={type.small}>Latest courier event: {ship.webhookEvents.at(-1)?.status} · {fmt(ship.webhookEvents.at(-1)?.receivedAt)}</Text>
          ) : null}
          <Text style={type.small}>Deliver to: {[order.shippingAddress?.line1, order.shippingAddress?.line2].filter(Boolean).join(', ')} {order.shippingAddress?.city} {order.shippingAddress?.pincode}</Text>
          <View style={styles.links}>
            {trackingUrl ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL(trackingUrl)}><Text style={styles.link}>Track shipment ↗</Text></Pressable> : null}
            {phone ? <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${phone}`)}><Text style={styles.link}>Call partner</Text></Pressable> : null}
            <Pressable accessibilityRole="link" onPress={onOpenOrder}><Text style={styles.link}>Order details ›</Text></Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function TrackOrdersScreen({ navigation }) {
  const { channels, channel, setChannel, isHybrid } = useSellerChannel();
  const [filter, setFilter] = useState('ACTIVE');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState(null);

  const loader = useCallback(async () => {
    const body = await listSellerOrders({ status: 'all', limit: 100 });
    return Array.isArray(body?.data) ? body.data : [];
  }, []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  const channelOrders = useMemo(() => (data || []).filter((o) => (!isHybrid || !o.channel ? true : o.channel === channel)), [data, channel, isHybrid]);
  const counts = useMemo(() => ({
    onTheWay: channelOrders.filter((o) => ['dispatched', 'out_for_delivery'].includes(o.status)).length,
    atStore: channelOrders.filter((o) => ['placed', 'confirmed', 'preparing'].includes(o.status)).length,
    today: channelOrders.filter((o) => o.status === 'delivered' && isToday(deliveredAtOf(o))).length,
  }), [channelOrders]);
  const shown = useMemo(() => {
    const q = search.toLowerCase().trim();
    return channelOrders.filter((o) => {
      const tab = filter === 'ACTIVE' ? ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery'].includes(o.status)
        : filter === 'COMPLETED' ? ['delivered', 'cancelled', 'returned', 'refunded'].includes(o.status) : true;
      return tab && (!q || (o.orderNo || '').toLowerCase().includes(q) || (o.customer?.name || '').toLowerCase().includes(q)
        || (o.shippingAddress?.city || '').toLowerCase().includes(q) || partnerName(o).toLowerCase().includes(q)
        || partnerPhone(o).includes(q) || (o.shiprocket?.awb || '').toLowerCase().includes(q));
    });
  }, [channelOrders, filter, search]);

  if (loading && !data) return <LoadingView message="Loading live tracking data…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  const header = (
    <View style={styles.header}>
      {isHybrid ? <ChipRow value={channel} onChange={setChannel} accessibilityLabel="Storefront" options={channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} /> : null}
      <View style={styles.kpis}>
        <Kpi label="On the way" value={counts.onTheWay} />
        <Kpi label="At store" value={counts.atStore} />
        <Kpi label="Delivered today" value={counts.today} />
      </View>
      <ChipRow value={filter} onChange={setFilter} options={FILTERS} accessibilityLabel="Tracking filter" />
      <AppInput placeholder="Search order, customer, city, partner or AWB" value={search} onChangeText={setSearch} autoCorrect={false} />
    </View>
  );

  return (
    <FlatList
      data={shown}
      keyExtractor={(item) => String(item._id)}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<EmptyView title={filter === 'ACTIVE' ? 'Nothing in transit' : 'No tracking records found'}
        message={filter === 'ACTIVE' ? 'Orders you have not yet handed over, and those on their way to the customer, show up here.' : 'No order tracking records found for the selected filter.'} />}
      renderItem={({ item }) => (
        <TrackCard order={item} open={openId === item._id} onToggle={() => setOpenId(openId === item._id ? null : item._id)}
          onOpenOrder={() => navigation.navigate('OrderDetail', { id: item._id, orderNo: item.orderNo })} />
      )}
    />
  );
}

function Kpi({ label, value }) {
  return <View style={styles.kpi}><Text style={styles.kpiValue}>{value}</Text><Text style={type.small}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, paddingBottom: spacing.xxl },
  header: { gap: spacing.md },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: 'center' },
  kpiValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  cardHead: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 6 },
  status: { fontSize: 11, fontWeight: '800', backgroundColor: '#f1f5f9', color: colors.text, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  toggle: { fontSize: 11, fontWeight: '700', color: '#3b82f6' },
  partner: { fontSize: 12, color: '#0369a1', fontWeight: '700' },
  promise: { fontSize: 12, color: '#166534', fontWeight: '700' },
  trail: { borderTopWidth: 1, borderTopColor: '#f1f5f9', marginTop: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6, backgroundColor: '#cbd5e1' },
  dotActive: { backgroundColor: '#3b82f6' },
  time: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginTop: spacing.sm },
  link: { color: colors.primaryDark, fontWeight: '700', paddingVertical: 6 },
});
