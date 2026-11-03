import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { InlineNotice } from '../../components/StateViews';
import { getShiprocketFee, startShiprocketFeePayment } from '../../services/fulfillment.api';
import { openRazorpayCheckout } from '../../services/razorpay';
import { orderMoney } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Native port of frontend/src/modules/Seller/components/ShiprocketFeePayment.jsx.
// Quick Commerce orders: the seller pays Bulkimart the remaining freight + service fee before a Shiprocket shipment.
export default function ShiprocketFeeCard({ orderId, provider = {}, onPaid }) {
  const [record, setRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try { setRecord(await getShiprocketFee(orderId)); } catch (e) { setMessage(e.message || 'Could not load the seller fee'); }
  }, [orderId]);
  useEffect(() => { refresh(); }, [refresh]);

  const snapshot = record?.snapshot || provider.feeCollection?.snapshot;
  const estimate = provider.quote?.optionB;
  const status = record?.payment?.status || provider.feeCollection?.status;
  const total = snapshot?.vendorDeliveryFeeObligation ?? estimate?.vendorDeliveryFeeObligation;
  const live = provider.activation?.enabled && provider.activation?.ready;
  const money = (value) => (value == null ? 'Unavailable' : orderMoney(value));

  const pay = async () => {
    setBusy(true); setMessage('');
    try {
      const data = await startShiprocketFeePayment(orderId, total, snapshot?.serviceFee?.version || provider.quote?.feeRule?.version);
      if (data.status !== 'paid') {
        const result = await openRazorpayCheckout(data.checkout);
        setMessage(result.ok ? 'Payment verified. You can now create the Shiprocket shipment.' : result.message);
      }
      await refresh();
      await onPaid?.();
    } catch (e) {
      setMessage(e.message || 'Could not start the payment');
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.box}>
      <Text style={type.label}>Seller payment breakdown</Text>
      <Text style={type.small}>For Quick Commerce orders you pay Bulkimart for Shiprocket shipping. Your customer is not charged anything extra.</Text>
      <KeyValueRow label="Estimated Shiprocket freight" value={money(snapshot?.eligibleCourierFreight ?? estimate?.eligibleCourierFreight)} />
      <KeyValueRow label="Paid by customer (delivery charge)" value={money(snapshot?.customerFreightContribution ?? estimate?.customerFreightContribution)} />
      <KeyValueRow label="Your remaining freight" value={money(snapshot?.vendorFreightShare ?? estimate?.vendorFreightShare)} />
      <KeyValueRow label="Bulkimart service fee" value={money(snapshot?.serviceFee?.netAmount ?? estimate?.serviceFeeNet)} />
      <KeyValueRow label="GST on service fee" value={money(snapshot?.serviceFee?.taxAmount ?? estimate?.applicableTax)} />
      <KeyValueRow label="Total payable by you" value={money(total)} strong />
      <Text style={type.small}>Payment: {status === 'paid' ? 'Paid' : !status || status === 'not_started' ? 'Not started' : status}</Text>

      {!live ? (
        <InlineNotice tone="warning">Shiprocket for Quick Commerce is not switched on by Bulkimart yet. No payment will be collected.</InlineNotice>
      ) : status !== 'paid' ? (
        <>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: reviewed }} disabled={busy}
            onPress={() => setReviewed((v) => !v)} style={styles.check}>
            <View style={[styles.box16, reviewed && styles.box16On]}>{reviewed ? <Text style={styles.tick}>✓</Text> : null}</View>
            <Text style={[type.small, styles.flex]}>I have reviewed the freight, service fee, GST and total payable.</Text>
          </Pressable>
          <AppButton title={`Pay ${money(total)} to Bulkimart`} loading={busy} disabled={!reviewed || total == null || !provider.available} onPress={pay} />
        </>
      ) : (
        <InlineNotice tone="success">Payment verified. Enter the package size below and create the shipment.</InlineNotice>
      )}
      <AppButton small variant="ghost" title="Check payment status" disabled={busy} onPress={async () => { await refresh(); await onPaid?.(); }} />
      {message ? <InlineNotice tone={/verified/i.test(message) ? 'success' : 'warning'}>{message}</InlineNotice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  box16: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: colors.primaryDark, alignItems: 'center', justifyContent: 'center' },
  box16On: { backgroundColor: colors.primaryDark },
  tick: { color: colors.white, fontWeight: '800', fontSize: 13 },
  flex: { flex: 1 },
});
