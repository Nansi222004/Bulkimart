import React, { useCallback, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import KeyValueRow from '../../components/KeyValueRow';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { loadSellerFinances } from '../../services/finance';
import { money, titleCase } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/EarningsTab.jsx.
// Every amount comes from /api/sellers/finances/{summary,ledger}. Nothing is calculated here.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BUCKETS = { pending: 'Pending', held: 'On hold', eligible: 'Available', reserved: 'Payout requested', settled: 'Paid' };

const settlementStatus = (order) => {
  if (order.financialPosting === 'held') return 'Earned — on hold until the return window ends';
  if (order.financialPosting === 'eligible') return 'Available to withdraw';
  if (order.financialPosting === 'reversed') return 'Refunded to customer';
  if (order.snapshotVersion !== 2) return 'Awaiting finance review: original commission details missing for this older order';
  if (order.snapshotState === 'held_discount_policy') return 'On hold: Bulkimart finance is reviewing the discount on this order';
  if (order.snapshotState !== 'configured') return 'On hold: no commission rate was set when ordered';
  return order.paymentMethod === 'cod' ? 'Waiting for the cash to reach Bulkimart' : 'Waiting for payment confirmation';
};

const payoutLabel = (status) => (status === 'APPROVED' ? 'Paid' : status === 'PENDING' ? 'Being processed' : 'Rejected');

export default function EarningsScreen({ navigation }) {
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loadSellerFinances, []);
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    refresh();
  }, [refresh]));

  if (loading && !data) return <LoadingView message="Loading authoritative seller ledger…" />;
  if (!data) {
    return (
      <ErrorView message={error || 'Seller finances have not loaded yet.'}
        note="Balances, ledger history and payout requests are unavailable. This does not mean your balances are zero."
        onRetry={reload} retryLabel="Refresh" />
    );
  }

  const { summary, entries } = data;
  const balances = summary.balances;
  const sales = summary.deliveredSales;
  const policy = summary.payoutPolicy;
  const metrics = summary.salesMetrics;
  // Counts only (no amounts), same fallbacks as the web.
  const pendingNetOrders = metrics?.netEarningsPendingOrders ?? sales?.orders?.filter((o) => !Number.isFinite(o.sellerAmounts?.netEarnings)).length ?? 0;
  const unpostedOrders = summary.coverage?.unpostedOrders ?? sales?.orders?.filter((o) => !['held', 'eligible', 'reversed'].includes(o.financialPosting)).length ?? 0;
  const courier = balances.courierObligations;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text style={type.small}>For each item you get the full item price minus Bulkimart’s commission, GST on that commission, and any TCS/TDS. Coupons are paid by Bulkimart, not by you.</Text>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <View style={styles.hero}>
        <Text style={styles.heroLabel}>AVAILABLE TO WITHDRAW</Text>
        <Text style={styles.heroValue}>{money(balances.eligible)}</Text>
        <AppButton title="Request payout" variant="accent" disabled={!summary.payoutActionsEnabled}
          onPress={() => navigation.navigate('PayoutRequest')} />
        {!summary.payoutActionsEnabled ? <Text style={styles.heroHint}>Nothing available to withdraw yet</Text> : null}
      </View>

      <Card title="Completed product sales">
        <Text style={styles.big}>{money(metrics ? metrics.totalRevenue : sales?.grossAmount)}</Text>
        <Text style={type.small}>{metrics?.completedOrders ?? sales?.orderCount ?? 0} delivered orders across all storefronts · {metrics ? 'after customer discounts' : 'before deductions'}</Text>
        {Number.isFinite(metrics?.grossSales) && Number.isFinite(metrics?.customerDiscounts)
          ? <Text style={type.small}>Gross product sales: {money(metrics.grossSales)} · Customer discounts: {money(metrics.customerDiscounts)}</Text> : null}
        {summary.salesByChannel
          ? <Text style={type.small}>Shop All: {money(summary.salesByChannel.ecommerce?.revenue)} · Quick Commerce: {money(summary.salesByChannel.grocery?.revenue)}</Text> : null}
      </Card>

      <Card title="Net earnings">
        <Text style={styles.big}>{pendingNetOrders > 0 ? 'Awaiting calculation' : money(metrics?.netEarnings)}</Text>
        {pendingNetOrders > 0
          ? <Text style={type.small}>{pendingNetOrders} delivered {pendingNetOrders === 1 ? 'order needs' : 'orders need'} original commission details or financial adjustments reviewed. This is not a zero earning.</Text>
          : <Text style={type.small}>After the commission and deductions recorded for each completed order.</Text>}
        {pendingNetOrders > 0 && metrics?.netEarningsCalculatedOrders > 0
          ? <Text style={type.small}>Calculated subtotal: {money(metrics.knownNetEarnings)} from {metrics.netEarningsCalculatedOrders} orders.</Text> : null}
      </Card>

      {unpostedOrders > 0 ? (
        <InlineNotice tone="warning">
          {unpostedOrders} delivered {unpostedOrders === 1 ? 'order has' : 'orders have'} not been posted to your settlement balance. The amounts below show posted funds only. Bulkimart finance must verify the original commission and payment or COD records before posting them.
        </InlineNotice>
      ) : null}

      <Card title="Posted settlement balances">
        <KeyValueRow label="On hold (waiting for the return window to end)" value={money(balances.held)} valueColor="#d97706" />
        <KeyValueRow label="Available to withdraw" value={money(balances.eligible)} valueColor={colors.success} />
        <KeyValueRow label="Paid to you" value={money(balances.settled)} />
        <KeyValueRow label="Posted earnings" value={money(balances.earnedEarnings)} />
        <KeyValueRow label="Same-day incentives" value={money(balances.sameDayIncentives)} />
        <KeyValueRow label="Payout requested" value={money(balances.reserved)} />
        <KeyValueRow label="Pending" value={money(balances.pending)} />
        {courier?.charged > 0 ? (
          <Text style={type.small}>
            {`Shiprocket charges you prepaid: ${money(courier.charged)} charged · ${money(courier.paid)} paid · ${money(courier.outstanding)} still to pay. Includes courier ${money(balances.quickFreightObligations)} and Bulkimart service fees ${money(balances.bulkimartServiceFees)}. These are paid separately and are not taken from your earnings.`}
          </Text>
        ) : null}
        {policy ? (
          <Text style={type.small}>
            Payouts: {policy.schedule === 'weekly' ? `sent automatically every ${WEEKDAYS[policy.weekday]}` : 'request them any time'}{policy.minimum > 0 ? ` · minimum ${money(policy.minimum)}` : ''}
          </Text>
        ) : null}
      </Card>

      {summary.coverage ? (
        <InlineNotice tone="info">
          How it works: an order is delivered → once payment (or COD cash) reaches Bulkimart, your earning appears as “On hold” → after the return window it becomes “Available” → you withdraw it. Older orders from before this system need a finance review; contact support with the order number.
        </InlineNotice>
      ) : null}

      {sales ? (
        <Card title="Delivered orders">
          <Text style={type.label}>{sales.orderCount} delivered orders · {money(sales.grossAmount)} item sales</Text>
          {sales.orders?.length ? sales.orders.map((order) => (
            <View key={order._id} style={styles.orderRow}>
              <Text style={type.label}>{order.orderNo}</Text>
              <KeyValueRow label="Item sales" value={money(order.grossAmount)} />
              <KeyValueRow label="Customer discount" value={money(order.sellerAmounts?.totalDiscount)} />
              <KeyValueRow label="Product GST (in price)" value={money(order.productGst)} />
              <KeyValueRow label="Admin commission" value={money(order.sellerAmounts?.commission)} />
              <KeyValueRow label="GST on commission" value={money(order.sellerAmounts?.commissionTax)} />
              <KeyValueRow label="TCS" value={money(order.sellerAmounts?.tcs)} />
              <KeyValueRow label="TDS" value={money(order.sellerAmounts?.tds)} />
              <KeyValueRow strong label="Net earning" value={money(order.sellerAmounts?.netEarnings)} />
              <Text style={type.small}>{settlementStatus(order)}</Text>
            </View>
          )) : <Text style={type.small}>No delivered orders yet.</Text>}
          {sales.orderCount > (sales.orders?.length || 0) ? <Text style={type.small}>Showing the latest {sales.orders.length} delivered orders. See Orders for the full list.</Text> : null}
        </Card>
      ) : null}

      <Card title="Tax withheld (TCS / TDS)" onPress={() => navigation.navigate('TaxStatement')} right={<Text style={styles.link}>View ›</Text>}>
        <Text style={type.small}>Monthly TCS and TDS deposited with the government in your name.</Text>
      </Card>

      <Card title="Statement (latest 50 entries)">
        {entries.length ? entries.map((entry) => (
          <View key={entry._id} style={styles.entry}>
            <View style={styles.entryHead}>
              <Text style={[type.label, styles.flex]}>{entry.description}</Text>
              <Text style={[styles.entryAmount, { color: entry.direction === 'credit' ? '#15803d' : '#b91c1c' }]}>
                {entry.direction === 'credit' ? '+' : '−'}{money(entry.amount)}
              </Text>
            </View>
            <Text style={type.small}>{new Date(entry.createdAt).toLocaleString('en-IN')} · {entry.reference || entry.entryNo} · {BUCKETS[entry.bucket] || titleCase(entry.bucket)}</Text>
          </View>
        )) : <Text style={type.small}>No earnings have been posted to the ledger yet. Check the delivered-order settlement status above.</Text>}
      </Card>

      <Card title="Payout requests" onPress={() => navigation.navigate('PayoutHistory')} right={<Text style={styles.link}>History ›</Text>}>
        {summary.payouts.length ? summary.payouts.slice(0, 5).map((payout) => (
          <KeyValueRow key={payout._id} label={`${payout.payoutNo} · ${payoutLabel(payout.status)}`} value={money(payout.amount)} />
        )) : <Text style={type.small}>No payout requests.</Text>}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: '#0f766e', borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  heroLabel: { color: colors.white, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  heroValue: { color: colors.white, fontSize: 32, fontWeight: '900', marginBottom: spacing.sm },
  heroHint: { color: colors.white, fontSize: 12, opacity: 0.9 },
  big: { fontSize: 22, fontWeight: '800', color: colors.text },
  orderRow: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: spacing.sm, marginTop: spacing.sm },
  entry: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingVertical: spacing.sm, gap: 2 },
  entryHead: { flexDirection: 'row', gap: spacing.sm },
  entryAmount: { fontWeight: '800', fontSize: 14 },
  flex: { flex: 1 },
  link: { color: colors.primaryDark, fontWeight: '700' },
});
