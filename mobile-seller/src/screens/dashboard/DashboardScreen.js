import React, { useCallback, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Screen from '../../components/Screen';
import SalesChart from '../../components/SalesChart';
import { ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { getDashboard } from '../../services/seller.api';
import { useAuth } from '../../context/AuthContext';
import { countText, kpiMoney } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of frontend/src/modules/Seller/components/DashboardTab.jsx.
// Every figure is read from GET /api/sellers/dashboard. A new store shows zeros, never demo numbers.

function Kpi({ title, value, hint, icon, onPress, children }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${value}`} onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.05)' }} style={styles.kpi}>
      <View style={styles.kpiHead}><Text style={styles.kpiTitle}>{title}</Text><Text style={styles.kpiIcon} accessible={false}>{icon}</Text></View>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={type.small}>{hint}</Text>
      {children}
    </Pressable>
  );
}

export default function DashboardScreen({ navigation }) {
  const { salesChannels, seller } = useAuth();
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(getDashboard, []);

  // The web refreshes when the window regains focus; here, when the tab regains focus.
  // The first focus is skipped because the initial load already ran.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    refresh();
  }, [refresh]));

  const k = data?.kpis;
  const byChannel = data?.byChannel;
  const isHybrid = salesChannels.includes('ecommerce') && salesChannels.includes('grocery');
  // Raw server values: null = pending calculation, missing = '—' (see kpiMoney). Never defaulted to ₹0.
  const revenue = k?.totalRevenue;
  const avg = k?.avgOrderValue;
  const channelRevenue = (key) => byChannel?.[key]?.revenue;
  const goOrders = (tab) => navigation.navigate('Orders', { tab });

  if (loading && !data) return <LoadingView message="Updating dashboard…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} retryLabel="Retry dashboard" />;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View>
        <Text style={type.title}>Welcome back{seller?.storeDetails?.name ? `, ${seller.storeDetails.name}` : ''}</Text>
        <Text style={type.small}>Figures across all your storefronts</Text>
      </View>
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <View style={styles.grid}>
        <Kpi title="Total Revenue" value={kpiMoney(revenue)} hint="Completed sales after discounts" icon="₹" onPress={() => navigation.navigate('Earnings')}>
          {k?.revenuePendingOrders > 0 ? <Text style={type.small}>{kpiMoney(k.knownRevenue)} confirmed · {k.revenuePendingOrders} orders pending calculation</Text> : null}
          <Text style={styles.net}>
            Net earnings: {k?.netEarningsPendingOrders > 0
              ? `${k.netEarningsCalculatedOrders > 0 ? `${kpiMoney(k.knownNetEarnings)} calculated subtotal · ` : 'Not calculated yet · '}${k.netEarningsPendingOrders} ${k.netEarningsPendingOrders === 1 ? 'order' : 'orders'} awaiting finance review`
              : kpiMoney(k?.netEarnings)}
          </Text>
          {isHybrid ? <Text style={type.small}>Shop All: {kpiMoney(channelRevenue('ecommerce'))} · Quick Commerce: {kpiMoney(channelRevenue('grocery'))}</Text> : null}
        </Kpi>
        <Kpi title="Total Orders" value={countText(k?.totalOrders)} hint="Cancelled and returned excluded" icon="▣" onPress={() => goOrders('all')}>
          {isHybrid ? <Text style={type.small}>Shop All: {countText(byChannel?.ecommerce?.orders)} · Quick Commerce: {countText(byChannel?.grocery?.orders)}</Text> : null}
        </Kpi>
        <Kpi title="Average Order Value" value={kpiMoney(avg)} hint={`Sales revenue ÷ ${k?.completedOrders ?? 0} completed orders`} icon="◇" onPress={() => goOrders('delivered')} />
        <Kpi title="Pending Orders" value={countText(k?.pendingOrders)} hint="Awaiting acceptance or preparation" icon="◷" onPress={() => goOrders('pending')} />
      </View>

      <SalesChart data={Array.isArray(data?.salesPerformance) ? data.salesPerformance : []} />

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => goOrders('pending')} style={[styles.action, { backgroundColor: colors.primaryDark }]}>
          <Text style={styles.actionTitle}>Process orders</Text>
          <Text style={styles.actionHint}>Accept and prepare new orders</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Earnings')} style={[styles.action, { backgroundColor: colors.orange }]}>
          <Text style={styles.actionTitle}>Earnings</Text>
          <Text style={styles.actionHint}>Balances and payouts</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.md },
  kpi: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: 4 },
  kpiHead: { flexDirection: 'row', justifyContent: 'space-between' },
  kpiTitle: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  kpiIcon: { fontSize: 16, color: colors.primaryDark },
  kpiValue: { ...type.amount },
  net: { fontSize: 13, fontWeight: '600', color: colors.success, marginTop: 4 },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1, borderRadius: radius.lg, padding: spacing.lg, gap: 4, minHeight: 84, justifyContent: 'center' },
  actionTitle: { color: colors.white, fontWeight: '800', fontSize: 15 },
  actionHint: { color: colors.white, opacity: 0.9, fontSize: 12 },
});
