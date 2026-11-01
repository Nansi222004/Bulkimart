import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import StatusPill from '../../components/StatusPill';
import NavigateButtons from '../../components/NavigateButtons';
import { InlineNotice } from '../../components/StateViews';
import { useDuty } from '../../context/DutyContext';
import { returnStatus } from '../../utils/status';
import { formatDateTime } from '../../utils/format';
import { formatRupees } from '../../utils/money';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Quick Commerce reverse pickups (web ReturnPickupsPage), customer -> rider -> seller.
 * Backed by /api/delivery/return-pickups/*. The rider confirms the customer handover with the
 * customer's 4-digit pickup code (server-verified). The seller confirms receipt on their side;
 * the rider app has no "delivered to seller" button because the backend has none for riders.
 */
export function stopsOf(r) {
  const customer = r.pickup?.deliveryId?.pickupLocation || r.orderId?.shippingAddress;
  const seller = r.pickup?.deliveryId?.dropLocation || r.sellerId?.storeDetails;
  const customerAddress = customer?.address || [customer?.line1, customer?.line2, customer?.city, customer?.state, customer?.pincode].filter(Boolean).join(', ');
  const sellerName = seller?.name || r.sellerId?.businessName || r.sellerId?.storeDetails?.name || 'Seller';
  const sellerAddress = [seller?.address, seller?.city, seller?.state, seller?.pincode].filter(Boolean).join(', ');
  return {
    customerName: customer?.name || 'Customer', customerPhone: r.orderId?.shippingAddress?.phone || null, customerAddress, customerPoint: customer,
    sellerName, sellerAddress, sellerPoint: seller,
  };
}

const km = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v} km` : null);

function ProductThumb({ r, size = 56 }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: radius.md };
  return r.productImage && !failed
    ? <Image source={{ uri: r.productImage }} style={[styles.thumb, box]} onError={() => setFailed(true)} accessibilityIgnoresInvertColors />
    : <View style={[styles.thumb, styles.thumbEmpty, box]}><Text style={styles.thumbIcon}>📦</Text></View>;
}

// Pickup -> drop, drawn as two dots joined by a line.
function Route({ from, to, fromLabel = 'Pick up', toLabel = 'Drop at' }) {
  return (
    <View style={styles.route}>
      <View style={styles.rail}>
        <View style={[styles.dot, styles.dotFrom]} />
        <View style={styles.railLine} />
        <View style={[styles.dot, styles.dotTo]} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.routeLabel}>{fromLabel}</Text>
        <Text style={styles.routeText} numberOfLines={2}>{from || '—'}</Text>
        <Text style={[styles.routeLabel, styles.routeGap]}>{toLabel}</Text>
        <Text style={styles.routeText} numberOfLines={2}>{to || '—'}</Text>
      </View>
    </View>
  );
}

function ReturnCard({ r, children, onPress, highlight }) {
  const s = returnStatus(r.pickup?.status);
  const body = (
    <>
      <View style={styles.cardTop}>
        <ProductThumb r={r} />
        <View style={styles.flex}>
          <Text style={styles.cardTitle} numberOfLines={2}>{r.productName || 'Returned item'}</Text>
          <Text style={type.small}>{r.returnNumber}{r.quantity ? ` · Qty ${r.quantity}` : ''}</Text>
        </View>
      </View>
      {children}
    </>
  );
  const style = [styles.card, highlight && styles.cardHighlight];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...style, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${r.returnNumber}, ${s.label}`}>
      {body}
    </Pressable>
  );
}

function Empty({ icon, title, message }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}><Text style={styles.emptyGlyph}>{icon}</Text></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={[type.small, styles.center]}>{message}</Text>
    </View>
  );
}

const TABS = [
  { key: 'pending', label: 'New' },
  { key: 'active', label: 'Active' },
  { key: 'history', label: 'Completed' },
];

export function ReturnPickupsScreen({ navigation }) {
  const duty = useDuty();
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const { pending, active, history } = duty.returnPickups;
  // Open on whatever needs the rider: new offers first, then work in progress.
  const [tab, setTab] = useState(pending.length ? 'pending' : active.length ? 'active' : 'pending');
  const counts = useMemo(() => ({ pending: pending.length, active: active.length, history: history.length }), [pending.length, active.length, history.length]);

  const onRefresh = useCallback(async () => { setRefreshing(true); await duty.loadReturnPickups(); setRefreshing(false); }, [duty]);
  useEffect(() => { duty.loadReturnPickups(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id, fn) => { setBusyId(id); try { await fn(id); } finally { setBusyId(null); } };

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}
            style={[styles.tab, tab === t.key && styles.tabOn]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            <View style={[styles.count, tab === t.key && styles.countOn, t.key === 'pending' && counts.pending > 0 && styles.countAlert]}>
              <Text style={[styles.countText, (tab === t.key || (t.key === 'pending' && counts.pending > 0)) && styles.countTextOn]}>{counts[t.key]}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {tab === 'pending' ? (
        <>
          {!duty.online ? <InlineNotice tone="warning">You are offline. New return pickup requests reach you only while you are online.</InlineNotice> : null}
          {!pending.length ? (
            <Empty icon="↩️" title="No new requests" message="When a customer returns an item near you, the request appears here and pops up on screen." />
          ) : pending.map((r) => {
            const stops = stopsOf(r);
            const busy = busyId === String(r._id);
            return (
              <ReturnCard key={r._id} r={r} highlight>
                <StatusPill tone="warning" label="New request" />
                <Route from={stops.customerAddress || stops.customerName} to={stops.sellerName} />
                {(km(r.pickupDistanceKm) || km(r.routeDistanceKm)) ? (
                  <View style={styles.chips}>
                    {km(r.pickupDistanceKm) ? <Text style={styles.chip}>You → customer {km(r.pickupDistanceKm)}</Text> : null}
                    {km(r.routeDistanceKm) ? <Text style={styles.chip}>Customer → seller {km(r.routeDistanceKm)}</Text> : null}
                  </View>
                ) : null}
                <View style={styles.row}>
                  <AppButton title="Decline" variant="danger" style={styles.flex} disabled={busy} onPress={() => act(String(r._id), duty.declineReturn)} />
                  <AppButton title="Accept" style={styles.flex2} loading={busy} onPress={() => act(String(r._id), duty.acceptReturn)} />
                </View>
              </ReturnCard>
            );
          })}
        </>
      ) : null}

      {tab === 'active' ? (
        !active.length ? (
          <Empty icon="🛵" title="No active pickups" message="Pickups you accept appear here until the seller receives the item." />
        ) : active.map((r) => {
          const s = returnStatus(r.pickup?.status), stops = stopsOf(r);
          const pickedUp = r.pickup?.status === 'PICKED_UP';
          return (
            <ReturnCard key={r._id} r={r} onPress={() => navigation.navigate('ReturnDetail', { id: String(r._id) })}>
              <StatusPill tone={s.tone} label={s.label} />
              <Route from={stops.customerAddress || stops.customerName} to={`${stops.sellerName}${stops.sellerAddress ? `, ${stops.sellerAddress}` : ''}`} />
              <View style={styles.openRow}>
                <Text style={styles.nextStep}>{pickedUp ? 'Next: hand the item to the seller' : 'Next: collect the item from the customer'}</Text>
                <Text style={styles.open}>Open ›</Text>
              </View>
            </ReturnCard>
          );
        })
      ) : null}

      {tab === 'history' ? (
        !history.length ? (
          <Empty icon="✅" title="No completed pickups yet" message="Return pickups you hand over to sellers appear here with what each trip earned." />
        ) : history.map((r) => {
          const trip = r.pickup?.deliveryId;
          const earned = Number(trip?.partnerEarnings);
          return (
            <ReturnCard key={r._id} r={r}>
              <View style={styles.doneRow}>
                <StatusPill tone="success" label="Delivered to seller" />
                <Text style={[styles.earned, !Number.isFinite(earned) && styles.earnedPending]}>{Number.isFinite(earned) ? formatRupees(earned) : 'Earning pending'}</Text>
              </View>
              <Text style={type.small}>To {r.sellerId?.businessName || r.sellerId?.storeDetails?.name || 'seller'} · {formatDateTime(r.pickup?.sellerConfirmedReceivedAt || trip?.endTime || r.updatedAt)}</Text>
            </ReturnCard>
          );
        })
      ) : null}
    </Screen>
  );
}

function Step({ n, title, done, current, children }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepRail}>
        <View style={[styles.stepBadge, done && styles.stepDone, current && styles.stepCurrent]}>
          <Text style={[styles.stepNum, (done || current) && styles.stepNumOn]}>{done ? '✓' : n}</Text>
        </View>
      </View>
      <View style={[styles.stepBody, current && styles.stepBodyCurrent]}>
        <Text style={[styles.stepTitle, done && styles.stepTitleDone]}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

export function ReturnDetailScreen({ route, navigation }) {
  const duty = useDuty();
  const id = route.params?.id;
  const r = duty.returnPickups.active.find((x) => String(x._id) === String(id));
  const done = duty.returnPickups.history.find((x) => String(x._id) === String(id));
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => { setRefreshing(true); await duty.loadReturnPickups(); setRefreshing(false); };

  if (!r) {
    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <Empty icon={done ? '✅' : 'ℹ️'} title={done ? 'Delivered to seller' : 'Pickup unavailable'}
          message={done ? `${done.returnNumber} has been handed over to the seller.` : 'This return pickup is no longer assigned to you.'} />
        <AppButton title="Back to return pickups" variant="outline" onPress={() => navigation.goBack()} />
      </Screen>
    );
  }
  const s = returnStatus(r.pickup?.status), stops = stopsOf(r), pickedUp = r.pickup?.status === 'PICKED_UP';
  const run = async (key, fn) => { setBusy(key); try { await fn(); } finally { setBusy(''); } };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <ReturnCard r={r}>
        <StatusPill tone={s.tone} label={s.label} />
      </ReturnCard>
      {duty.tripSharing.on ? <Text style={type.small}>📍 Sharing your location with the customer while this pickup is active and the app is open.</Text>
        : duty.tripSharing.error ? <InlineNotice tone="warning">{duty.tripSharing.error}</InlineNotice> : null}

      <Step n={1} title="Collect from customer" done={pickedUp} current={!pickedUp}>
        <Text style={styles.stopName}>{stops.customerName}</Text>
        <Text style={type.body}>{stops.customerAddress || 'Address unavailable'}</Text>
        {!pickedUp ? <NavigateButtons point={stops.customerPoint} address={stops.customerAddress} phone={stops.customerPhone} callLabel="Call customer" /> : null}
      </Step>

      {r.pickup?.status === 'ASSIGNED' ? (
        <Step n={2} title="Confirm with the customer’s code" current>
          <Text style={type.body}>Check the item, then ask the customer for their 4-digit pickup code. If they don’t have it, send it.</Text>
          <AppButton title="Send pickup code to customer" variant="outline" loading={busy === 'send'} onPress={() => run('send', () => duty.sendReturnCode(String(r._id)))} />
          <AppInput label="Customer’s pickup code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} placeholder="0000" />
          <AppButton title="Confirm pickup" loading={busy === 'verify'} disabled={code.length !== 4}
            onPress={() => run('verify', async () => { const res = await duty.confirmReturnPickup(String(r._id), code); if (res?.ok) setCode(''); })} />
        </Step>
      ) : null}

      <Step n={pickedUp ? 2 : 3} title="Hand over to seller" current={pickedUp}>
        <Text style={styles.stopName}>{stops.sellerName}</Text>
        <Text style={type.body}>{stops.sellerAddress || 'Address unavailable'}</Text>
        {pickedUp ? <NavigateButtons point={stops.sellerPoint} address={stops.sellerAddress} /> : null}
        {pickedUp ? <Text style={type.small}>The seller marks the item received; it then moves to Completed.</Text> : null}
      </Step>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex2: { flex: 2 },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm },

  tabs: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: radius.md },
  tabOn: { backgroundColor: colors.primaryDark },
  tabText: { fontSize: 15, fontWeight: '700', color: colors.textSecondary },
  tabTextOn: { color: colors.white },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  countOn: { backgroundColor: 'rgba(255,255,255,0.25)' },
  countAlert: { backgroundColor: colors.orange },
  countText: { fontSize: 12, fontWeight: '800', color: colors.textSecondary },
  countTextOn: { color: colors.white },

  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md },
  cardHighlight: { borderColor: colors.orange, borderWidth: 2 },
  pressed: { opacity: 0.85 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  thumb: { backgroundColor: colors.surface },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.aquaLight },
  thumbIcon: { fontSize: 26 },

  route: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center', paddingTop: 5, width: 14 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  dotFrom: { backgroundColor: colors.primaryDark },
  dotTo: { backgroundColor: colors.orange },
  railLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 3, minHeight: 24 },
  routeLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  routeGap: { marginTop: spacing.sm },
  routeText: { fontSize: 15, color: colors.text, lineHeight: 21 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { fontSize: 13, fontWeight: '600', color: colors.deepBlue, backgroundColor: colors.aquaLight, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, overflow: 'hidden' },

  openRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  nextStep: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  open: { fontSize: 16, fontWeight: '800', color: colors.primaryDark },

  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earned: { fontSize: 18, fontWeight: '800', color: '#166534' },
  earnedPending: { fontSize: 14, color: colors.textSecondary },

  empty: { alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.xxl, paddingHorizontal: spacing.xl, gap: spacing.sm },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.aquaLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  emptyGlyph: { fontSize: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: colors.text },

  step: { flexDirection: 'row', gap: spacing.md },
  stepRail: { alignItems: 'center', width: 32 },
  stepBadge: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  stepCurrent: { borderColor: colors.primaryDark, backgroundColor: colors.primaryDark },
  stepDone: { borderColor: colors.success, backgroundColor: colors.success },
  stepNum: { fontSize: 15, fontWeight: '800', color: colors.textSecondary },
  stepNumOn: { color: colors.white },
  stepBody: { flex: 1, backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.sm },
  stepBodyCurrent: { borderColor: colors.primary, borderWidth: 2 },
  stepTitle: { fontSize: 17, fontWeight: '800', color: colors.deepBlue },
  stepTitleDone: { color: colors.success },
  stopName: { fontSize: 16, fontWeight: '700', color: colors.text },
});
