import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import StatusPill from '../../components/StatusPill';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import AppButton from '../../components/AppButton';
import * as deliveryApi from '../../services/delivery.api';
import { HISTORY_TONE, HISTORY_TYPES, historyLabel } from '../../utils/status';
import { formatDateTime } from '../../utils/format';
import { formatRupees } from '../../utils/money';
import { colors, radius, spacing, type } from '../../theme';

/**
 * Trip history (web RiderHistoryPage): GET /api/delivery/orders/history?type&page.
 * Filtering and paging are done by the server; pages load as the rider scrolls.
 */
export default function HistoryScreen() {
  const [filter, setFilter] = useState('ALL');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async (p, type) => {
    const g = ++generation.current;
    setLoading(true); setError('');
    try {
      const body = await deliveryApi.getHistory({ type, page: p });
      if (g !== generation.current) return;
      const data = Array.isArray(body?.data) ? body.data : [];
      setRows((prev) => (p === 1 ? data : [...prev, ...data]));
      setPage(p);
      setPages(body?.meta?.pages || Math.ceil((body?.meta?.total || 0) / (body?.meta?.limit || 20)) || 1);
    } catch (e) {
      if (g === generation.current) setError(e.message || 'Could not load history');
    } finally {
      if (g === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, filter); }, [filter, load]);

  const header = (
    <View style={styles.filters}>
      {HISTORY_TYPES.map((t) => (
        <Pressable key={t.key} onPress={() => setFilter(t.key)} accessibilityRole="button" accessibilityState={{ selected: filter === t.key }}
          style={[styles.chip, filter === t.key && styles.chipOn]}>
          <Text style={[styles.chipText, filter === t.key && styles.chipTextOn]}>{t.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  if (error && !rows.length) return <View style={styles.fill}>{header}<ErrorView message={error} onRetry={() => load(1, filter)} /></View>;

  return (
    <FlatList
      style={styles.fill}
      contentContainerStyle={styles.list}
      data={rows}
      keyExtractor={(item, i) => `${item.orderId || item.orderNo}-${item.type}-${item.timestamp}-${i}`}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={loading && page === 1 && rows.length > 0} onRefresh={() => load(1, filter)} colors={[colors.primaryDark]} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => { if (!loading && page < pages) load(page + 1, filter); }}
      ListEmptyComponent={loading ? <LoadingView /> : <EmptyView title="Nothing here yet" message="Finished, cancelled and missed trips appear here." />}
      ListFooterComponent={rows.length && page < pages ? <AppButton small variant="ghost" title={loading ? 'Loading…' : 'Load more'} onPress={() => load(page + 1, filter)} /> : null}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={type.label}>{item.orderNo || 'Order'}{item.kind === 'return_pickup' ? ' · Return pickup' : item.kind === 'parcel' ? ' · Parcel' : ''}</Text>
            <Text style={type.small}>{formatDateTime(item.timestamp)}{item.merchantName ? ` · ${item.merchantName}` : ''}</Text>
            {item.amount !== undefined ? <Text style={type.small}>Earned {formatRupees(item.amount)}{item.tip > 0 ? ` (incl. ${formatRupees(item.tip)} tip)` : ''}</Text> : null}
          </View>
          <StatusPill tone={HISTORY_TONE[item.type] || 'neutral'} label={historyLabel(item.type)} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  list: { padding: spacing.lg, gap: spacing.sm },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { minHeight: 40, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  chipOn: { backgroundColor: colors.primaryDark, borderColor: colors.primaryDark },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  chipTextOn: { color: colors.white },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.white, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  flex: { flex: 1, gap: 2 },
});
