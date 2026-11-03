import React, { useState } from 'react';
import { Alert, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { loadSellerFinances, payoutIntent } from '../../services/finance';
import { requestPayout } from '../../services/seller.api';
import { useAuth } from '../../context/AuthContext';
import { PAYOUT_STATUSES, validPayoutAmount } from '../../utils/financeRead';
import { money } from '../../utils/format';
import { colors, radius, spacing } from '../../theme';

// Port of MoneyRequestTab.jsx + SellerContext.handleRequestPayout.
// It creates a payout REQUEST: Bulkimart checks the bank account and pays manually outside the app.
// Do not submit this against production during testing.
export default function PayoutRequestScreen({ navigation }) {
  const { sellerId } = useAuth();
  const { data, error, loading, reload } = useApiResource(loadSellerFinances, []);
  const [amountText, setAmountText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  if (loading && !data) return <LoadingView message="Loading payout balances…" />;
  if (!data) {
    return <ErrorView message={error || 'Payout balances have not loaded yet.'}
      note="Payout balances and requests are unavailable. No zero balance or empty history has been confirmed." onRetry={reload} retryLabel="Refresh" />;
  }

  const { summary } = data;
  const balances = summary.balances;
  const eligible = balances.eligible;
  const minimum = Number(summary.payoutPolicy?.minimum || 0);
  const weekly = summary.payoutPolicy?.schedule === 'weekly';
  const amount = Number(amountText);
  const blocked = submitting || !summary.payoutActionsEnabled || eligible <= 0;

  const submit = () => {
    setFormError('');
    if (!amountText.trim() || !validPayoutAmount(amount)) { setFormError('Enter an amount with at most two decimals.'); return; }
    if (amount > eligible) { setFormError(`You can request up to ${money(eligible)}.`); return; }
    if (minimum > 0 && amount < minimum) { setFormError(`The minimum payout is ${money(minimum)}.`); return; }
    Alert.alert('Request payout', `Request ${money(amount)} to the bank account in your profile?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Request', onPress: send },
    ]);
  };

  const send = async () => {
    setSubmitting(true);
    try {
      const intent = await payoutIntent(sellerId, amount);
      const body = await requestPayout(amount, intent.key);
      // The server must confirm exactly this request, otherwise the key is kept for a safe retry.
      if (body?.success !== true || !body.data?._id || body.data.amount !== amount || !PAYOUT_STATUSES.includes(body.data.status)) {
        throw new Error(body?.message || 'Payout request could not be confirmed; retry uses the same request reference');
      }
      await intent.complete();
      ToastAndroid.show('Payout request submitted.', ToastAndroid.LONG);
      navigation.goBack();
    } catch (e) {
      setFormError(e.message || 'Payout request could not be confirmed; retry uses the same request reference');
    } finally { setSubmitting(false); }
  };

  const buttonTitle = submitting ? 'Submitting request…'
    : eligible <= 0 ? 'No eligible balance'
      : !summary.payoutActionsEnabled ? 'Payout requests are currently disabled'
        : 'Request payout';

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>AVAILABLE TO WITHDRAW</Text>
        <Text style={styles.heroValue}>{money(eligible)}</Text>
        <Text style={styles.heroHint}>On hold: {money(balances.held)} · Pending: {money(balances.pending)} · Already requested: {money(balances.reserved)}</Text>
      </View>
      <InlineNotice tone="info">Only money that is “Available to withdraw” can be requested. Earnings on hold become available when the order’s return window ends.</InlineNotice>

      <Card>
        {weekly ? <InlineNotice tone="info">Payouts are sent automatically every week, so there is nothing to request. Your full available balance is included in the next weekly payout.</InlineNotice> : null}
        <AppInput label="Amount" keyboardType="decimal-pad" placeholder="0.00" value={amountText}
          onChangeText={(text) => setAmountText(text.replace(/[^0-9.]/g, ''))} editable={!blocked}
          hint={`Up to ${money(eligible)}${minimum > 0 ? `; at least ${money(minimum)}` : ''}. Money goes to the bank account in your profile.`}
          error={formError} />
        <AppButton title={buttonTitle} onPress={submit} loading={submitting} disabled={blocked} />
        <Text style={styles.footnote}>Bulkimart checks your bank account, then sends the money manually outside this app. You will see “Paid” with the bank reference once it is done.</Text>
      </Card>

      <Card title="Requests">
        {summary.payouts.length ? summary.payouts.map((p) => (
          <KeyValueRow key={p._id} label={`${p.payoutNo} · ${p.status === 'APPROVED' ? 'Paid' : p.status === 'PENDING' ? 'Being processed' : 'Rejected'}`} value={money(p.amount)} />
        )) : <Text style={styles.footnote}>No payout requests.</Text>}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: '#0891b2', borderRadius: radius.lg, padding: spacing.xl, gap: 4 },
  heroLabel: { color: colors.white, fontSize: 11, fontWeight: '700' },
  heroValue: { color: colors.white, fontSize: 32, fontWeight: '900' },
  heroHint: { color: colors.white, fontSize: 12 },
  footnote: { fontSize: 12, color: colors.textSecondary },
});
