import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import ReasonPrompt from '../../components/ReasonPrompt';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import ReturnPickupSection from './ReturnPickupSection';
import { cancelReturnPickup, decideReturn, getSellerReturn, markReturnReceived, refreshReturnCourier } from '../../services/returns.api';
import {
  PICKUP_LABEL, RETURN_COLORS, RETURN_STATUS_LABEL, canArrangePickup, canCancelCourier, canCancelManualRequest,
  canDecide, canMarkReceived, formatDate, humanize, nextStep,
} from '../../utils/returns';
import { colors, radius, spacing, type } from '../../theme';

// Port of ReturnDetail + decision panel + pickup actions from SellerReturnsTab.jsx / ReturnPickupPanel.jsx.
// Refund amounts are shown exactly as the server sends them; nothing is calculated here.
const httpsUrl = (url) => { try { return new URL(url).protocol === 'https:' ? url : null; } catch { return null; } };
const POLL_MS = 20000;

export default function ReturnDetailScreen({ route, navigation }) {
  const { id, title } = route.params;
  const [ret, setRet] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { navigation.setOptions({ title: title || 'Return' }); }, [navigation, title]);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try { const data = await getSellerReturn(id); if (alive.current) { setRet(data); setError(''); } }
    catch (e) { if (alive.current && !silent) { setRet(null); setError(e.message || 'Could not load this return'); } }
    finally { if (alive.current && !silent) setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  // The web listens for pickup socket events; the app re-reads while the screen is open.
  useFocusEffect(useCallback(() => { const t = setInterval(() => load(true), POLL_MS); return () => clearInterval(t); }, [load]));

  const act = async (fn, okMessage) => {
    setBusy(true);
    try { const body = await fn(); ToastAndroid.show(body?.message || okMessage, ToastAndroid.LONG); }
    catch (e) { Alert.alert('Return', e.code === 'NETWORK' || e.code === 'TIMEOUT' ? 'Could not confirm the update; the screen will refresh before you retry.' : e.message || 'Could not update this return'); }
    finally { if (alive.current) { setBusy(false); await load(true); } }
  };

  const approve = () => Alert.alert('Approve return', 'Approve this return? You will then choose how to collect the item.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Approve', onPress: () => act(() => decideReturn(ret._id, 'APPROVED'), 'Return approved') },
  ]);
  const reject = async ({ reason }) => {
    if (reason.trim().length < 3) { Alert.alert('Reject return', 'Enter a reason for rejecting this return'); return; }
    await act(() => decideReturn(ret._id, 'REJECTED', reason.trim()), 'Return rejected');
    if (alive.current) setRejecting(false);
  };

  if (loading && !ret) return <LoadingView message="Loading return…" />;
  if (!ret) return <ErrorView message={error || 'Return unavailable'} onRetry={() => load()} />;

  const [bg, fg] = RETURN_COLORS[ret.status] || RETURN_COLORS.RETURN_REQUESTED;
  const address = ret.order?.pickupAddress;
  const rider = ret.pickup?.partnerId;
  const trackingUrl = httpsUrl(ret.trackingUrl);
  // Same as the web: the panel shows for approved/awaiting returns and the server's `stateReady` decides if a method can be chosen.
  const showMethodChoice = canArrangePickup(ret);

  return (
    <Screen onRefresh={() => load()} refreshing={false}>
      <Card>
        <View style={styles.head}>
          {ret.productImage ? <Image source={{ uri: ret.productImage }} style={styles.image} /> : null}
          <View style={styles.flex}>
            <Text style={type.heading}>{ret.productName}</Text>
            <Text style={type.small}>{ret.returnNumber ? `${ret.returnNumber} · ` : ''}Qty {ret.quantity}</Text>
            <Text style={[styles.badge, { backgroundColor: bg, color: fg }]}>{RETURN_STATUS_LABEL[ret.status] || ret.status}</Text>
          </View>
        </View>
        {nextStep(ret) ? <InlineNotice tone="info">{nextStep(ret)}</InlineNotice> : null}
        {ret.rejectionReason ? <InlineNotice tone="error">Rejected: {ret.rejectionReason}</InlineNotice> : null}
      </Card>

      {canDecide(ret) ? (
        <Card title="Your decision">
          <Text style={type.small}>Approving starts the pickup. Rejecting ends the return; the customer sees your reason.</Text>
          <AppButton title="Approve return" loading={busy} onPress={approve} />
          <AppButton title="Reject return" variant="danger" disabled={busy} onPress={() => setRejecting(true)} />
        </Card>
      ) : null}

      {showMethodChoice ? <ReturnPickupSection ret={ret} onChanged={() => load(true)} /> : null}

      <Card title="Customer's return reason">
        <KeyValueRow label="Reason" value={humanize(ret.reason) || '—'} />
        {ret.returnOptionSnapshot ? <KeyValueRow label="Bought with" value={ret.returnOptionSnapshot === 'EASY_RETURN' ? 'Easy Returns' : 'No Easy Returns (wrong/damaged/defective only)'} /> : null}
        <Text style={type.body}>{ret.customerDescription || 'No description provided'}</Text>
        {ret.attachments?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachments}>
            {ret.attachments.map((f) => {
              const url = httpsUrl(f.url);
              if (!url) return null;
              return f.mimeType === 'application/pdf'
                ? <Pressable key={f.url} accessibilityRole="link" onPress={() => Linking.openURL(url)} style={styles.pdf}><Text style={styles.pdfText}>📄 {f.fileName || 'Attachment (PDF)'}</Text></Pressable>
                : <Pressable key={f.url} accessibilityRole="imagebutton" accessibilityLabel={f.fileName || 'Return photo'} onPress={() => Linking.openURL(url)}><Image source={{ uri: url }} style={styles.photo} /></Pressable>;
            })}
          </ScrollView>
        ) : null}
      </Card>

      <Card title="Order">
        <KeyValueRow label="Order" value={ret.order?.orderNo || '—'} />
        <KeyValueRow label="Customer" value={ret.customerName || '—'} />
        <KeyValueRow label="Delivered" value={formatDate(ret.order?.deliveredAt)} />
        <KeyValueRow label="Unit price" value={ret.unitPriceSnapshot != null ? `₹${ret.unitPriceSnapshot}` : '—'} />
        <KeyValueRow label="Return window ends" value={formatDate(ret.returnEligibleUntilSnapshot)} />
        {address ? <KeyValueRow label="Pickup from" value={[address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(', ')} /> : null}
        {ret.order?._id ? <AppButton small variant="ghost" title="Open order" onPress={() => navigation.navigate('OrderDetail', { id: ret.order._id, orderNo: ret.order.orderNo })} /> : null}
      </Card>

      <Card title="Pickup">
        <KeyValueRow label="Method" value={ret.pickupMethod === 'SHIPROCKET' ? 'Shiprocket reverse pickup' : ret.pickupMethod === 'MANUAL' ? 'Local rider' : 'Not chosen yet'} />
        {ret.pickupMethod === 'MANUAL' ? <KeyValueRow label="Rider status" value={PICKUP_LABEL[ret.pickup?.status] || ret.pickup?.status || '—'} /> : null}
        {rider?.userId?.name ? <KeyValueRow label="Rider" value={`${rider.userId.name}${rider.userId.phone ? ` · ${rider.userId.phone}` : ''}${rider.vehicleNo ? ` · ${rider.vehicleNo}` : ''}`} /> : null}
        {!rider && ret.pickup?.requestedRiderId?.userId?.name ? <KeyValueRow label="Requested rider" value={`${ret.pickup.requestedRiderId.userId.name} · Awaiting acceptance`} /> : null}
        {ret.pickupMethod === 'SHIPROCKET' ? (
          <>
            <KeyValueRow label="Courier" value={ret.courierName || '—'} />
            <KeyValueRow label="AWB" value={ret.awbNumber || 'Booking confirmation pending'} />
            <KeyValueRow label="Tracking" value={ret.reverseBooking?.trackingState || ret.reverseBooking?.state || '—'} />
            {ret.reverseBooking?.error ? <InlineNotice tone="warning">{ret.reverseBooking.error}</InlineNotice> : null}
            {trackingUrl ? <AppButton small variant="outline" title="Track courier" onPress={() => Linking.openURL(trackingUrl)} /> : null}
            <AppButton small variant="outline" title="Refresh courier tracking" disabled={busy} onPress={() => act(() => refreshReturnCourier(ret._id), 'Tracking refreshed')} />
          </>
        ) : null}
        <KeyValueRow label="Picked up" value={formatDate(ret.pickedUpAt)} />
        <KeyValueRow label="You confirmed receipt" value={formatDate(ret.pickup?.sellerConfirmedReceivedAt)} />
        {canCancelManualRequest(ret) ? (
          <AppButton small variant="danger" title="Cancel rider request" disabled={busy}
            onPress={() => Alert.alert('Cancel rider request', 'Cancel this pickup request so you can choose again?', [{ text: 'No', style: 'cancel' }, { text: 'Cancel request', onPress: () => act(() => cancelReturnPickup(ret._id), 'Pickup request cancelled') }])} />
        ) : null}
        {canCancelCourier(ret) ? (
          <AppButton small variant="danger" title="Request courier cancellation" disabled={busy}
            onPress={() => Alert.alert('Cancel courier', 'Ask Shiprocket to cancel this reverse pickup?', [{ text: 'No', style: 'cancel' }, { text: 'Request cancellation', onPress: () => act(() => cancelReturnPickup(ret._id), 'Cancellation requested') }])} />
        ) : null}
        {canMarkReceived(ret) ? (
          <AppButton title="Mark received" loading={busy}
            onPress={() => Alert.alert('Mark received', 'Confirm the returned item has reached your store?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Mark received', onPress: () => act(() => markReturnReceived(ret._id), 'Marked as received') }])} />
        ) : null}
        <Text style={type.small}>The pickup OTP is shared between the customer and the rider; sellers do not handle it.</Text>
      </Card>

      {(ret.refundStatus || ret.refundAmount != null || ret.restockDecision) ? (
        <Card title="Inspection & refund">
          <KeyValueRow label="Restock decision" value={ret.restockDecision ? humanize(ret.restockDecision).toLowerCase() : '—'} />
          <KeyValueRow label="Customer refund" value={ret.refundAmount != null ? `₹${ret.refundAmount}` : '—'} />
          <KeyValueRow label="Refund status" value={ret.refundStatus || '—'} />
          <KeyValueRow label="Refunded on" value={formatDate(ret.refundedAt)} />
        </Card>
      ) : null}

      {ret.history?.length ? (
        <Card title="Timeline">
          {ret.history.map((h, i) => (
            <View key={i} style={styles.step}>
              <Text style={type.label}>{RETURN_STATUS_LABEL[h.toStatus] || h.toStatus}{h.comment ? ` — ${h.comment}` : ''}</Text>
              <Text style={type.small}>{formatDate(h.timestamp)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <ReasonPrompt visible={rejecting} busy={busy} title="Reject return"
        message="Why are you rejecting this return? The customer will see this."
        fields={[{ key: 'reason', label: 'Rejection reason', multiline: true }]} confirmLabel="Confirm rejection"
        onCancel={() => setRejecting(false)} onSubmit={reject} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: spacing.md },
  image: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface },
  flex: { flex: 1, gap: 4 },
  badge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  attachments: { gap: spacing.sm },
  photo: { width: 84, height: 84, borderRadius: radius.sm, backgroundColor: colors.surface },
  pdf: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.errorLight, justifyContent: 'center' },
  pdfText: { color: colors.error, fontWeight: '700', fontSize: 12 },
  step: { borderLeftWidth: 2, borderLeftColor: '#cde9ed', paddingLeft: spacing.md, paddingVertical: 4 },
});
