import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './AppText';
import Card from './Card';
import AppButton from './AppButton';
import AppInput from './AppInput';
import { InlineNotice } from './StateViews';
import { useToast } from './Toast';
import * as deliveryApi from '../services/delivery.api';
import { formatDateTime } from '../utils/format';
import { formatRupees } from '../utils/money';
import { colors, radius, spacing, type } from '../theme';

// Same rupee style as the rest of the app (₹1,100 / ₹1,079.60).
const rupees = (paise) => formatRupees((Number(paise) || 0) / 100);
const LABEL = { parcel_earning: 'Parcel earning', parcel_cash_due: 'COD parcel cash', rider_cash_payment: 'Paid to Bulkimart', delivery_earning: 'Order earning', payout_reservation: 'Payout to bank', payout_settlement: 'Payout returned' };

/**
 * Wallet for COD parcels: the rider keeps their earning from the cash and owes Bulkimart
 * the rest. Later earnings clear it automatically; otherwise the rider pays by UPI or cash
 * and an admin approves it. `compact` is the short version for the Home screen.
 */
export default function WalletCard({ navigation, compact = false, reloadKey }) {
  const toast = useToast();
  const [wallet, setWallet] = useState(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [form, setForm] = useState({ amount: '', method: 'upi', reference: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try { setWallet(await deliveryApi.getWallet()); setError(''); }
    catch (e) { setError(e.message || 'Could not load your wallet'); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => navigation?.addListener?.('focus', load), [navigation, load]);

  if (compact) {
    if (!wallet?.owedPaise) return null;
    return (
      <Card title="You owe Bulkimart" onPress={() => navigation.navigate('Earnings')} style={styles.owingCard}
        right={<Text style={styles.owedSmall}>{rupees(wallet.owedPaise)}</Text>}>
        <Text style={type.body}>From COD parcel cash (after your earning). Your next earnings clear it, or pay by UPI / cash.</Text>
        {wallet.cashParcelsBlocked ? <InlineNotice tone="error">Limit reached: no new cash parcels until you pay or earn it back. Online parcels and orders still come.</InlineNotice> : null}
        <Text style={styles.link}>Open wallet ›</Text>
      </Card>
    );
  }

  const openPay = () => { setForm({ amount: (wallet.owedPaise / 100).toFixed(2), method: 'upi', reference: '', note: '' }); setPaying(true); };
  const submit = async () => {
    setBusy(true);
    try {
      await deliveryApi.payWallet({ amount: Number(form.amount), method: form.method, reference: form.reference.trim(), note: form.note.trim() });
      toast.show('Payment sent. Bulkimart will confirm it soon.', 'success');
      setPaying(false); load();
    } catch (e) { toast.show(e.message || 'Could not send the payment.', 'error'); }
    finally { setBusy(false); }
  };

  if (!wallet) return <Card title="Wallet">{error ? <InlineNotice tone="error">{error}</InlineNotice> : <Text style={type.small}>Loading…</Text>}</Card>;
  const owes = wallet.owedPaise > 0;
  const lastRejected = wallet.payments.find((p) => p.status === 'rejected' && !wallet.pendingPayment);
  const rows = showAll ? wallet.statement : wallet.statement.slice(0, 5);

  return (
    <Card title="Wallet" style={owes ? styles.owingCard : undefined}>
      <Text style={[styles.big, owes ? styles.negative : styles.positive]}>{owes ? `−${rupees(wallet.owedPaise)}` : rupees(wallet.balancePaise)}</Text>
      <Text style={type.small}>{owes ? `You owe Bulkimart ${rupees(wallet.owedPaise)} from COD parcel cash. It clears automatically from your next earnings, or pay it now.` : 'Nothing owed. COD parcel cash minus your earning shows here as an amount you owe.'}</Text>
      {wallet.cashParcelsBlocked ? <InlineNotice tone="error">You reached the {rupees(wallet.debtLimitPaise)} limit, so you get no new cash parcels until it comes down. Online parcels and orders still come.</InlineNotice> : null}

      {wallet.pendingPayment ? (
        <InlineNotice tone="info">Waiting for approval: {rupees(wallet.pendingPayment.amountPaise)} by {wallet.pendingPayment.method === 'upi' ? 'UPI' : 'cash'} (ref {wallet.pendingPayment.reference}), sent {formatDateTime(wallet.pendingPayment.createdAt)}.</InlineNotice>
      ) : lastRejected ? (
        <InlineNotice tone="warning">Your payment of {rupees(lastRejected.amountPaise)} was not approved: {lastRejected.rejectReason}</InlineNotice>
      ) : null}

      {owes && !wallet.pendingPayment && !paying ? <AppButton title="Pay to Bulkimart" onPress={openPay} /> : null}
      {paying ? (
        <View style={styles.form}>
          <View style={styles.methods} accessibilityRole="radiogroup">
            {[['upi', 'UPI'], ['cash', 'Cash']].map(([key, label]) => (
              <Pressable key={key} onPress={() => setForm((f) => ({ ...f, method: key }))} accessibilityRole="radio" accessibilityState={{ selected: form.method === key }}
                style={[styles.method, form.method === key && styles.methodOn]}>
                <Text style={[styles.methodText, form.method === key && styles.methodTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <AppInput label="Amount (₹)" keyboardType="decimal-pad" value={form.amount} onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))} hint={`You owe ${rupees(wallet.owedPaise)}. You can pay part of it.`} />
          <AppInput label={form.method === 'upi' ? 'UPI transaction ID / UTR' : 'Cash receipt number or who received it'} value={form.reference} autoCapitalize="characters"
            onChangeText={(v) => setForm((f) => ({ ...f, reference: v }))} hint={form.method === 'upi' ? 'Shown in your UPI app after paying.' : 'For example the hub receipt number.'} />
          <AppInput label="Note (optional)" value={form.note} onChangeText={(v) => setForm((f) => ({ ...f, note: v }))} />
          <AppButton title="Send for approval" loading={busy} disabled={busy || !(Number(form.amount) >= 1) || form.reference.trim().length < 4} onPress={submit} />
          <AppButton title="Cancel" variant="ghost" onPress={() => setPaying(false)} />
        </View>
      ) : null}

      {rows.length ? (
        <View style={styles.statement}>
          <Text style={type.label}>Recent activity</Text>
          {rows.map((s) => (
            <View key={s._id} style={styles.row}>
              <View style={styles.flex}>
                <Text style={styles.rowTitle}>{LABEL[s.type] || s.type}{s.onHold ? ' (on hold)' : ''}</Text>
                <Text style={type.small}>{formatDateTime(s.at)} · {s.description}</Text>
              </View>
              <Text style={[styles.amount, s.amountPaise < 0 ? styles.negative : styles.positive]}>{s.amountPaise < 0 ? '−' : '+'}{rupees(Math.abs(s.amountPaise))}</Text>
            </View>
          ))}
          {wallet.statement.length > 5 ? <AppButton small variant="ghost" title={showAll ? 'Show less' : 'Show all'} onPress={() => setShowAll((v) => !v)} /> : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  owingCard: { borderWidth: 2, borderColor: '#fca5a5', backgroundColor: colors.errorLight },
  owedSmall: { fontSize: 18, fontWeight: '800', color: colors.error },
  big: { fontSize: 30, fontWeight: '800' },
  negative: { color: colors.error },
  positive: { color: '#166534' },
  link: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  form: { gap: spacing.md, marginTop: spacing.sm },
  methods: { flexDirection: 'row', gap: spacing.sm },
  method: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.white },
  methodOn: { borderColor: colors.primaryDark, backgroundColor: colors.primaryDark },
  methodText: { fontSize: 15, fontWeight: '700', color: colors.text },
  methodTextOn: { color: colors.white },
  statement: { marginTop: spacing.sm, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  rowTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  amount: { fontSize: 15, fontWeight: '800' },
});
