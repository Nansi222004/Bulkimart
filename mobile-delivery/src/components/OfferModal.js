import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Vibration, View } from 'react-native';
import { Text } from './AppText';
import AppButton from './AppButton';
import KeyValueRow from './KeyValueRow';
import { colors, radius, spacing, type } from '../theme';
import { OFFER_WINDOW_SECONDS } from '../config/env';
import { formatRupees } from '../utils/money';
import { routePreviewUrl } from '../utils/location';

const km = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v} km` : '—');

/**
 * Incoming order offer (web OrderPingModal). The payout, distances and COD amount are the
 * server's figures, shown as sent. The countdown is the same 60 s client window the web uses;
 * running out calls /expire (not /decline), and the server decides what happens next.
 */
export function OrderOfferModal({ offer, onAccept, onDecline, onExpire }) {
  const [left, setLeft] = useState(OFFER_WINDOW_SECONDS);
  const [acting, setActing] = useState(false);
  const expired = useRef(false);
  const key = offer ? String(offer.orderId || offer._id) : null;

  useEffect(() => {
    if (!key) return undefined;
    setLeft(OFFER_WINDOW_SECONDS); expired.current = false; setActing(false);
    Vibration.vibrate([0, 600, 400, 600]);
    const t = setInterval(() => setLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => { clearInterval(t); Vibration.cancel(); };
  }, [key]);

  useEffect(() => {
    if (key && left === 0 && !expired.current) { expired.current = true; onExpire(offer); }
  }, [left, key, offer, onExpire]);

  if (!offer) return null;
  const payout = offer.payout || {};
  const isCod = offer.paymentMethod === 'COD';
  const preview = routePreviewUrl(offer.merchantLocation, offer.customerLocation);
  const run = async (fn) => { setActing(true); try { await fn(offer); } finally { setActing(false); } };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
              <Text style={styles.badge}>NEW DELIVERY REQUEST</Text>
              <Text style={[styles.timer, left <= 10 && styles.timerUrgent]} accessibilityLabel={`${left} seconds left`}>{left}s</Text>
            </View>
            <View style={styles.payBox}>
              <Text style={type.small}>Your payout</Text>
              <Text style={styles.pay}>{formatRupees(payout.total ?? null)}</Text>
              <Text style={type.small}>Base {formatRupees(payout.base ?? null)} + Distance {formatRupees(payout.distancePay ?? null)}{payout.tip > 0 ? ` + Tip ${formatRupees(payout.tip)}` : ''}</Text>
            </View>
            {payout.tip > 0 ? <Text style={styles.tip}>🎉 Customer is tipping {formatRupees(payout.tip)} — yours in full</Text> : null}
            <KeyValueRow label="To the store" value={km(offer.pickupDistance)} />
            <KeyValueRow label="Store to customer" value={km(offer.distance)} />
            {isCod && Number(offer.codFee) > 0 ? <KeyValueRow label={offer.codFeeLabel || 'COD Handling Fee'} value={`included · ${formatRupees(offer.codFee)}`} /> : null}
            <KeyValueRow label="Payment" value={isCod ? `Cash on delivery — collect ${formatRupees(offer.codAmount)}` : 'Prepaid — do not collect cash'} strong valueColor={isCod ? colors.orangeDark : colors.success} />
            <View style={styles.stop}>
              <Text style={type.label}>🏪 Pickup: {offer.merchantName || 'Store'}</Text>
              <Text style={type.small}>{offer.merchantAddress || 'Address shared after you accept'}</Text>
            </View>
            <View style={styles.stop}>
              <Text style={type.label}>🏠 Drop: {offer.customerName || 'Customer'}</Text>
              <Text style={type.small}>{offer.customerAddress || 'Address shared after you accept'}</Text>
            </View>
            {preview ? <AppButton small variant="ghost" title="View route in Maps ↗" onPress={() => Linking.openURL(preview).catch(() => {})} /> : null}
          </ScrollView>
          <View style={styles.actions}>
            <AppButton title="Decline" variant="danger" style={styles.decline} disabled={acting} onPress={() => run(onDecline)} />
            <AppButton title="Accept" style={styles.accept} loading={acting} onPress={() => run(onAccept)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Quick Commerce return pickup offer (web ReturnPickupPingModal). */
export function ReturnOfferModal({ offer, onAccept, onDecline, onExpire }) {
  const [left, setLeft] = useState(OFFER_WINDOW_SECONDS);
  const [acting, setActing] = useState(false);
  const expired = useRef(false);
  const key = offer?.returnId || null;

  useEffect(() => {
    if (!key) return undefined;
    setLeft(OFFER_WINDOW_SECONDS); expired.current = false; setActing(false);
    Vibration.vibrate([0, 500, 300, 500]);
    const t = setInterval(() => setLeft((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => { clearInterval(t); Vibration.cancel(); };
  }, [key]);

  useEffect(() => {
    if (key && left === 0 && !expired.current) { expired.current = true; onExpire(key); }
  }, [left, key, onExpire]);

  if (!offer) return null;
  const pickup = offer.pickupAddress || {};
  const pickupText = [pickup.line1, pickup.line2, pickup.city].filter(Boolean).join(', ');
  const run = async (fn) => { setActing(true); try { await fn(key); } finally { setActing(false); } };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.headerRow}>
              <Text style={styles.badge}>RETURN PICKUP REQUEST</Text>
              <Text style={[styles.timer, left <= 10 && styles.timerUrgent]}>{left}s</Text>
            </View>
            <Text style={type.heading}>{offer.returnNumber}</Text>
            <Text style={type.body}>{offer.productName}{offer.quantity ? ` × ${offer.quantity}` : ''}</Text>
            <KeyValueRow label="You to customer" value={km(offer.pickupDistanceKm)} />
            <KeyValueRow label="Customer to seller" value={km(offer.routeDistanceKm)} />
            <View style={styles.stop}><Text style={type.label}>1 · Collect from customer</Text><Text style={type.small}>{pickupText || 'Address shared after you accept'}</Text></View>
            <View style={styles.stop}><Text style={type.label}>2 · Drop at seller</Text><Text style={type.small}>{offer.sellerName || 'Seller'}</Text></View>
          </ScrollView>
          <View style={styles.actions}>
            <AppButton title="Decline" variant="danger" style={styles.decline} disabled={acting} onPress={() => run(onDecline)} />
            <AppButton title="Accept pickup" style={styles.accept} loading={acting} onPress={() => run(onAccept)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(7,59,120,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%' },
  content: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { fontSize: 14, fontWeight: '800', color: colors.orangeDark, letterSpacing: 0.5 },
  timer: { fontSize: 28, fontWeight: '800', color: colors.deepBlue },
  timerUrgent: { color: colors.error },
  payBox: { backgroundColor: colors.aquaLight, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', gap: 2 },
  pay: { fontSize: 36, fontWeight: '800', color: colors.deepBlue },
  tip: { fontSize: 15, fontWeight: '700', color: '#166534', backgroundColor: colors.successLight, padding: spacing.sm, borderRadius: radius.sm },
  stop: { gap: 2, paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  decline: { flex: 1 },
  accept: { flex: 2 },
});
