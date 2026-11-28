import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import KeyValueRow from '../../components/KeyValueRow';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { describeFbbRates, getSellerFbb, startFbbPayment } from '../../services/fbb.api';
import { openRazorpayCheckout } from '../../services/razorpay';
import { money } from '../../utils/format';
import { spacing, type } from '../../theme';
import FbbSendStock from './FbbSendStock';

// Native port of frontend/src/modules/Seller/components/FbbTab.jsx: the seller's read-only view of Fulfilled by
// Bulkimart — warehouse stock, receipts with discrepancies, charges and what is owed (payable in advance).
const CHARGE_LABEL = { storage: 'Storage', packaging: 'Packaging', fulfillment: 'Fulfilment' };
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN') : '—');

export default function FbbScreen() {
  const loader = useCallback(() => getSellerFbb(), []);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (loading && !data) return <LoadingView message="Loading Fulfilled by Bulkimart…" />;
  if (!data) return <ErrorView message={error || 'Fulfilled by Bulkimart is unavailable'} onRetry={reload} />;
  const { obligation, stock, receipts, charges, rates } = data;
  const outstanding = Number(obligation.outstanding || 0);

  const pay = async () => {
    setBusy(true); setMessage('');
    try {
      const started = await startFbbPayment(Number(amount));
      if (started?.status !== 'paid') {
        const result = await openRazorpayCheckout(started?.checkout);
        setMessage(result.ok ? 'Payment verified.' : result.message || 'Payment pending. Check again before retrying.');
      }
      setAmount('');
      await reload();
    } catch (e) { setMessage(e.message || 'Could not start the payment'); } finally { setBusy(false); }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text style={type.small}>Bulkimart stores, packs and ships these products from its warehouse. Stock changes only when the warehouse receives, sells or inspects returned units; ask Bulkimart support for any correction.</Text>
      {!data.available ? <InlineNotice tone="info">Fulfilled by Bulkimart is closed to new listings and orders right now. Existing stock, orders and charges continue as usual.</InlineNotice> : null}

      <FbbSendStock data={data} onChanged={reload} />

      <Card title="What you owe">
        <View style={styles.rows}>
          <KeyValueRow label="Charged" value={money(obligation.charged)} />
          <KeyValueRow label="Reversed" value={money(obligation.reversed)} />
          <KeyValueRow label="Paid in advance" value={money(obligation.paidInAdvance)} />
          <KeyValueRow label="Deducted from earnings" value={money(obligation.settledFromEarnings)} />
          <KeyValueRow label="Outstanding" value={money(obligation.outstanding)} />
          <KeyValueRow label="Advance credit" value={money(obligation.advanceCredit)} />
        </View>
        <Text style={type.small}>Anything outstanding is deducted from your eligible earnings before your next payout. You can also pay it now.</Text>
        {outstanding > 0 ? (
          <View style={styles.rows}>
            <AppInput label="Amount (₹)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} editable={!busy} />
            <AppButton title="Use full amount" variant="outline" small disabled={busy} onPress={() => setAmount(String(outstanding))} />
            <AppButton title={busy ? 'Processing…' : 'Pay now'} disabled={busy || !(Number(amount) > 0) || Number(amount) > outstanding} onPress={pay} />
          </View>
        ) : null}
        {message ? <Text style={type.small}>{message}</Text> : null}
      </Card>

      <Card title="Current rates"><Text style={type.small}>{describeFbbRates(rates)}</Text></Card>

      <Card title="Warehouse stock">
        {!stock.length ? <Text style={type.small}>No stock in the warehouse yet.</Text> : stock.map((row) => (
          <View key={`${row.productId}:${row.variantId}`} style={styles.item}>
            <Text style={type.body}>{row.productName}{row.variantName ? ` (${row.variantName})` : ''}</Text>
            <Text style={type.small}>{row.warehouse?.name} · For sale {row.sellable} · Reserved {row.reserved} · Awaiting inspection {row.quarantine || 0} · Damaged {row.damaged}</Text>
          </View>
        ))}
      </Card>

      <Card title="Receipts">
        {!receipts.length ? <Text style={type.small}>No receipts yet.</Text> : receipts.map((receipt) => (
          <View key={receipt._id} style={styles.item}>
            <Text style={type.body}>{receipt.receiptNo} · {receipt.status === 'posted' ? `received ${day(receipt.postedAt)}` : 'being checked'}</Text>
            {receipt.lines.map((line) => (
              <Text key={line._id} style={type.small}>
                {line.productName}{line.variantName ? ` (${line.variantName})` : ''}: expected {line.expectedQty}, received {line.receivedQty}, accepted {line.acceptedQty}, damaged {line.damagedQty}, rejected {line.rejectedQty}, missing {line.missingQty}{line.note ? ` — ${line.note}` : ''}
              </Text>
            ))}
          </View>
        ))}
        <Text style={type.small}>Only accepted units are for sale and charged storage.</Text>
      </Card>

      <Card title="Charges">
        {!charges.rows.length ? <Text style={type.small}>No charges yet.</Text> : charges.rows.map((row) => (
          <KeyValueRow key={row._id} label={`${day(row.createdAt)} · ${CHARGE_LABEL[row.type] || row.type} ${row.orderId?.orderNo || row.receiptId?.receiptNo || ''}${row.status === 'reversed' ? ' (reversed)' : ''}`} value={money(row.amount)} />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rows: { gap: spacing.sm, marginBottom: spacing.sm },
  item: { paddingVertical: spacing.xs },
});
