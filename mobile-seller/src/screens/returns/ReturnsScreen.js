import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import AppInput from '../../components/AppInput';
import ChipRow from '../../components/ChipRow';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { listSellerReturns } from '../../services/returns.api';
import { KPI_GROUPS, RETURN_COLORS, RETURN_STATUS_LABEL, humanize } from '../../utils/returns';
import { colors, radius, spacing, type } from '../../theme';

// Port of SellerReturnsTab.jsx (list). Counts come from the server's meta.statusCounts.
// Exchanges: the backend has no exchange model or endpoint, so there is nothing to list.
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: KPI_GROUPS.requested.join(','), label: 'To review' },
  { value: KPI_GROUPS.pickup.join(','), label: 'Pickup' },
  { value: KPI_GROUPS.refunded.join(','), label: 'Refund' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function ReturnsScreen({ navigation }) {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const loader = useCallback(() => listSellerReturns(filter), [filter]);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => { if (firstFocus.current) { firstFocus.current = false; return; } refresh(); }, [refresh]));

  const counts = data?.statusCounts || {};
  const sum = (group) => KPI_GROUPS[group].reduce((n, s) => n + (Number(counts[s]) || 0), 0);
  const shown = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (data?.rows || []).filter((r) => !q || (r.productName || '').toLowerCase().includes(q)
      || (r.returnNumber || '').toLowerCase().includes(q) || (r.reason || '').toLowerCase().includes(q));
  }, [data, search]);

  if (loading && !data) return <LoadingView message="Loading returns…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  const header = (
    <View style={styles.header}>
      <Text style={type.small}>You approve or reject returns and arrange pickup. Refunds are processed by Bulkimart after inspection.</Text>
      {data?.statusCounts ? (
        <View style={styles.kpis}>
          <Kpi label="To review" value={sum('requested')} color="#92400e" onPress={() => setFilter(FILTERS[1].value)} />
          <Kpi label="Pickup" value={sum('pickup')} color="#1d4ed8" onPress={() => setFilter(FILTERS[2].value)} />
          <Kpi label="Refund" value={sum('refunded')} color="#166534" onPress={() => setFilter(FILTERS[3].value)} />
        </View>
      ) : null}
      <ChipRow value={filter} onChange={setFilter} options={FILTERS} accessibilityLabel="Return status" />
      <AppInput placeholder="Search product, return number or reason" value={search} onChangeText={setSearch} autoCorrect={false} />
    </View>
  );

  return (
    <FlatList
      data={shown}
      keyExtractor={(item) => String(item._id)}
      ListHeaderComponent={header}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<EmptyView title="No returns" message="Customer return requests for your products appear here." />}
      renderItem={({ item: r }) => {
        const [bg, fg] = RETURN_COLORS[r.status] || RETURN_COLORS.RETURN_REQUESTED;
        return (
          <Pressable accessibilityRole="button" accessibilityLabel={`Return ${r.returnNumber || ''} ${r.productName || ''}`}
            onPress={() => navigation.navigate('ReturnDetail', { id: r._id, title: r.returnNumber })} style={styles.row}>
            {r.productImage ? <Image source={{ uri: r.productImage }} style={styles.thumb} /> : <View style={styles.thumb} />}
            <View style={styles.flex}>
              <Text style={type.label} numberOfLines={2}>{r.productName}</Text>
              <Text style={type.small}>{r.returnNumber ? `${r.returnNumber} · ` : ''}Qty {r.quantity}</Text>
              <Text style={type.small} numberOfLines={1}>{humanize(r.reason)} · Requested {new Date(r.requestedAt || r.createdAt).toLocaleDateString('en-IN')}</Text>
              <Text style={[styles.badge, { backgroundColor: bg, color: fg }]}>{RETURN_STATUS_LABEL[r.status] || r.status}</Text>
              {r.rejectionReason ? <Text style={styles.rejected} numberOfLines={2}>Rejected: {r.rejectionReason}</Text> : null}
              {r.refundStatus ? <Text style={type.small}>Refund status: {r.refundStatus}{r.refundAmount != null ? ` · ₹${r.refundAmount}` : ''}</Text> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function Kpi({ label, value, color, onPress }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.kpi}>
      <Text style={[styles.kpiValue, { color }]}>{value}</Text>
      <Text style={type.small}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.surface, paddingBottom: spacing.xxl },
  header: { gap: spacing.md },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  kpiValue: { fontSize: 22, fontWeight: '900' },
  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surface },
  flex: { flex: 1, gap: 3 },
  badge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  rejected: { fontSize: 12, color: '#b91c1c' },
});
