import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Screen from '../../components/Screen';
import Card from '../../components/Card';
import ChipRow from '../../components/ChipRow';
import SalesChart from '../../components/SalesChart';
import KeyValueRow from '../../components/KeyValueRow';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import useSellerChannel from '../../hooks/useSellerChannel';
import { getDashboard } from '../../services/seller.api';
import { countText, kpiMoney } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Sales report built only from figures the server calculates (GET /api/sellers/dashboard[?type=]).
 * The web Sales Report also adds up order subtotals in the browser (top products, daily totals, per-channel
 * averages). Those client-side sums are deliberately not reproduced; the daily series here is the server's
 * completed-sales series (last 30 days, filterable to 7 by the chart).
 */
const SCOPES = [{ value: 'all', label: 'All storefronts' }, { value: 'ecommerce', label: 'Shop All' }, { value: 'grocery', label: 'Quick Commerce' }];

export default function SalesReportScreen() {
  const { isHybrid, channels } = useSellerChannel();
  const [scope, setScope] = useState('all');
  const loader = useCallback(() => getDashboard(scope === 'all' ? undefined : scope), [scope]);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  if (loading && !data) return <LoadingView message="Loading sales report…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  const k = data?.kpis || {};
  const byChannel = data?.byChannel;
  const options = isHybrid ? SCOPES : SCOPES.filter((s) => s.value === 'all' || channels.includes(s.value));

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {options.length > 1 ? <ChipRow value={scope} onChange={setScope} options={options} accessibilityLabel="Storefront" /> : null}
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <View style={styles.grid}>
        <Tile label="Completed sales" value={kpiMoney(k.totalRevenue)} hint="After customer discounts" />
        <Tile label="Orders" value={countText(k.totalOrders)} hint="Cancelled and returned excluded" />
        <Tile label="Avg order value" value={kpiMoney(k.avgOrderValue)} hint={`${countText(k.completedOrders)} completed orders`} />
        <Tile label="Awaiting handover" value={countText(k.pendingOrders)} hint="Placed, confirmed or preparing" />
      </View>
      {k.revenuePendingOrders > 0 ? (
        <InlineNotice tone="warning">{kpiMoney(k.knownRevenue)} confirmed · {k.revenuePendingOrders} orders pending calculation. Totals appear once finance has calculated them.</InlineNotice>
      ) : null}

      <Card title="Net earnings">
        <Text style={styles.big}>
          {k.netEarningsPendingOrders > 0
            ? (k.netEarningsCalculatedOrders > 0 ? `${kpiMoney(k.knownNetEarnings)} calculated` : 'Not calculated yet')
            : kpiMoney(k.netEarnings)}
        </Text>
        {k.netEarningsPendingOrders > 0 ? <Text style={type.small}>{k.netEarningsPendingOrders} {k.netEarningsPendingOrders === 1 ? 'order' : 'orders'} awaiting finance review. This is not a zero earning.</Text> : null}
      </Card>

      {scope === 'all' && isHybrid && byChannel ? (
        <Card title="By storefront">
          <KeyValueRow label={`Shop All · ${countText(byChannel.ecommerce?.orders)} orders`} value={kpiMoney(byChannel.ecommerce?.revenue)} />
          <KeyValueRow label={`Quick Commerce · ${countText(byChannel.grocery?.orders)} orders`} value={kpiMoney(byChannel.grocery?.revenue)} />
        </Card>
      ) : null}

      <SalesChart data={Array.isArray(data?.salesPerformance) ? data.salesPerformance : []} />

      <Card title="Catalogue">
        <KeyValueRow label="Products" value={String(k.productCount ?? '—')} />
        <KeyValueRow label="Live" value={String(k.liveCount ?? '—')} />
        <KeyValueRow label="Low stock" value={String(k.lowStockCount ?? '—')} />
        <KeyValueRow label="Out of stock" value={String(k.outOfStockCount ?? '—')} />
      </Card>

      <Text style={type.small}>The server calculates these figures. Custom date ranges and top-product rankings need a backend report endpoint, which does not exist yet.</Text>
    </Screen>
  );
}

function Tile({ label, value, hint }) {
  return (
    <View style={styles.tile}>
      <Text style={type.small}>{label}</Text>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { flexGrow: 1, flexBasis: '46%', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 2 },
  tileValue: { fontSize: 20, fontWeight: '800', color: colors.text },
  hint: { fontSize: 11, color: colors.textMuted },
  big: { fontSize: 22, fontWeight: '800', color: colors.text },
});
