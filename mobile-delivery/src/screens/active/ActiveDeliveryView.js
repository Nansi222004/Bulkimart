import React, { useEffect, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import AppInput from '../../components/AppInput';
import StatusPill from '../../components/StatusPill';
import NavigateButtons from '../../components/NavigateButtons';
import { InlineNotice } from '../../components/StateViews';
import { useDuty } from '../../context/DutyContext';
import { codDueRupees, formatRupees, validateCodCollection } from '../../utils/money';
import { stageLabel } from '../../utils/status';
import { colors, radius, spacing, type } from '../../theme';

const confirm = (title, message, okLabel, onOk, destructive) =>
  Alert.alert(title, message, [{ text: 'Back', style: 'cancel' }, { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: onOk }]);

/**
 * The active delivery (web ActiveDeliveryPage). Every step is a server call; the screen only
 * moves on after the server confirms, and it re-reads the delivery afterwards.
 *   pickup:  reached store -> item checklist -> confirm pickup (server sets picked_up)
 *   transit: reached customer -> send code (customer's phone only) -> code [+ exact COD cash] -> complete
 */
export default function ActiveDeliveryView({ navigation }) {
  const duty = useDuty();
  const order = duty.activeOrder;
  const [checked, setChecked] = useState({});
  const [otp, setOtp] = useState('');
  const [cash, setCash] = useState('');
  const [formError, setFormError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [working, setWorking] = useState('');
  const [codWarning, setCodWarning] = useState('');

  const orderId = order?.orderId ? String(order.orderId) : null;
  useEffect(() => { setChecked({}); setOtp(''); setCash(''); setFormError(''); }, [orderId]);

  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  const isTransit = order.step === 'transit';
  const isCod = order.paymentMethod === 'COD';
  const due = codDueRupees(order);
  const allChecked = items.length > 0 && items.every((_, i) => checked[i]);

  const act = async (key, fn) => { setWorking(key); try { return await fn(); } finally { setWorking(''); } };

  const onRefresh = async () => { setRefreshing(true); await duty.restoreActive(); setRefreshing(false); };

  const confirmPickup = () => {
    if (!allChecked) { setFormError('Check every item before confirming pickup.'); return; }
    setFormError('');
    confirm('Confirm pickup?', `All items for ${order.orderNo || 'this order'} are collected from the store.`, 'Confirm pickup', () => act('pickup', duty.confirmPickup));
  };

  const complete = () => {
    setFormError('');
    if (!/^\d{4}$/.test(otp)) { setFormError('Enter the 4-digit code from the customer.'); return; }
    if (isCod) {
      const check = validateCodCollection(cash, due);
      if (!check.ok) { setFormError(check.message); return; }
    }
    const go = () => act('complete', async () => {
      const result = await duty.completeDelivery(otp, cash);
      if (!result) return; // a request is already running
      if (!result.ok) setFormError(result.message || 'Could not complete the delivery.');
      if (result.codWarning) setCodWarning(result.codWarning);
    });
    if (isCod) confirm('Cash collected?', `You collected ${formatRupees(due)} in cash from the customer.`, 'Yes, complete', go);
    else go();
  };

  const resendCode = () => confirm('Send a new code?', 'The code the customer has now will stop working.', 'Send new code', () => act('otp', duty.sendDeliveryCode));

  return (
    <Screen edges={[]} refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={type.small}>Current delivery</Text>
          <Text style={type.title}>{order.orderNo || 'Order'}</Text>
        </View>
        <StatusPill status={order.stage} label={stageLabel(order.stage)} />
      </View>

      <View style={styles.steps}>
        <Text style={[styles.stepBadge, !isTransit && styles.stepActive]}>1 · Store pickup</Text>
        <Text style={[styles.stepBadge, isTransit && styles.stepActive]}>2 · Deliver to customer</Text>
      </View>

      {duty.tripSharing.error ? <InlineNotice tone="warning">{duty.tripSharing.error} The customer cannot see you on their map.</InlineNotice>
        : duty.tripSharing.on ? <Text style={type.small}>📍 Sharing your location with the customer while this delivery is active and the app is open.</Text> : null}

      {codWarning ? <InlineNotice tone="error">{codWarning}</InlineNotice> : null}

      {!isTransit ? (
        <>
          <Card title="🏪 Store">
            <Text style={type.heading}>{order.merchantName || 'Store'}</Text>
            <Text style={type.body}>{order.merchantAddress || 'Address unavailable'}</Text>
            <NavigateButtons point={order.merchantLocation} address={order.merchantAddress} />
          </Card>

          <Card title="Check the items">
            {items.length ? items.map((it, i) => (
              <Pressable key={`${it.name}-${i}`} onPress={() => setChecked((c) => ({ ...c, [i]: !c[i] }))} accessibilityRole="checkbox"
                accessibilityState={{ checked: Boolean(checked[i]) }} style={styles.checkRow}>
                <View style={[styles.box, checked[i] && styles.boxOn]}>{checked[i] ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Text style={[type.body, styles.flex]}><Text style={styles.qty}>{it.qty}×</Text> {it.name}</Text>
              </Pressable>
            )) : <InlineNotice tone="warning">The item list did not load. Pull down to refresh before confirming pickup.</InlineNotice>}
          </Card>

          {order.stage !== 'arrived_at_store' ? (
            <AppButton title="I have reached the store" variant="outline" loading={working === 'store'} onPress={() => act('store', duty.markArrivedAtStore)} />
          ) : null}
          <AppButton title="Confirm pickup" loading={working === 'pickup'} disabled={!allChecked} onPress={confirmPickup} />
          {formError ? <InlineNotice tone="error">{formError}</InlineNotice> : null}
          <AppButton title="Cancel delivery" variant="danger" loading={working === 'cancel'}
            onPress={() => confirm('Cancel this delivery?', 'Only possible before pickup. An account warning may apply.', 'Cancel delivery', () => act('cancel', duty.cancelActive), true)} />
        </>
      ) : (
        <>
          <Card title="👤 Customer">
            <Text style={type.heading}>{order.customerName || 'Customer'}</Text>
            <Text style={type.body}>{order.customerAddress || 'Address unavailable'}</Text>
            {order.landmarkImage ? (
              <View style={styles.landmark}>
                <Text style={type.label}>Nearby location photo from the customer</Text>
                <Image source={{ uri: order.landmarkImage }} style={styles.landmarkImage} accessibilityLabel="Customer location reference photo" />
              </View>
            ) : null}
            <NavigateButtons point={order.customerLocation} address={order.customerAddress} phone={order.customerPhone} callLabel="Call customer" />
          </Card>

          {order.stage !== 'arrived_at_customer' && !order.otpSent ? (
            <AppButton title="I have reached the customer" variant="outline" loading={working === 'arrive'} onPress={() => act('arrive', duty.markArrivedAtCustomer)} />
          ) : null}

          {!order.otpSent ? (
            <AppButton title="🔑 Send code to customer" variant="accent" loading={working === 'otp'} onPress={() => act('otp', duty.sendDeliveryCode)} />
          ) : (
            <InlineNotice>A 4-digit code is on the customer’s phone. Ask them to read it out.</InlineNotice>
          )}

          {order.payout?.tip > 0 ? <InlineNotice tone="success">🎉 This customer tipped {formatRupees(order.payout.tip)} — paid with your earnings.</InlineNotice> : null}

          {isCod ? (
            <View style={styles.codBox}>
              <Text style={styles.codLabel}>COLLECT CASH</Text>
              <Text style={styles.codAmount}>{formatRupees(due)}</Text>
              <Text style={type.small}>Rounded to the nearest rupee. Collect exactly this amount. This cash belongs to Bulkimart and must be handed over.</Text>
              <AppInput label="Cash collected (₹)" value={cash} onChangeText={(t) => setCash(t.replace(/\D/g, '').slice(0, 7))} keyboardType="number-pad" placeholder={due ? String(due) : ''} />
            </View>
          ) : (
            <InlineNotice tone="success">Prepaid order — do not collect any cash.</InlineNotice>
          )}

          <AppInput label="Customer’s 4-digit code" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 4))}
            keyboardType="number-pad" maxLength={4} style={styles.otp} placeholder="0000" />
          {formError ? <InlineNotice tone="error">{formError}</InlineNotice> : null}
          <AppButton title={isCod ? 'Verify code and complete (cash collected)' : 'Verify code and complete'} loading={working === 'complete'}
            disabled={otp.length !== 4 || (isCod && !cash)} onPress={complete} />
          {order.otpSent ? <AppButton small variant="ghost" title="Customer didn’t get the code? Send a new one" disabled={Boolean(working)} onPress={resendCode} /> : null}
        </>
      )}

      <AppButton title="💬 Delivery support" variant="ghost" onPress={() => navigation.navigate('Support', { orderId, orderNo: order.orderNo })} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  steps: { flexDirection: 'row', gap: spacing.sm },
  stepBadge: { flex: 1, textAlign: 'center', paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.border, fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  stepActive: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark, color: colors.white },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  box: { width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primaryDark },
  tick: { color: colors.white, fontWeight: '900', fontSize: 16 },
  qty: { fontWeight: '800' },
  landmark: { gap: spacing.xs },
  landmarkImage: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.surface, resizeMode: 'cover' },
  codBox: { backgroundColor: colors.orangeLight, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 2, borderColor: colors.orange },
  codLabel: { fontSize: 14, fontWeight: '800', color: colors.orangeDark, letterSpacing: 0.5 },
  codAmount: { fontSize: 40, fontWeight: '900', color: colors.deepBlue },
  otp: {},
});
