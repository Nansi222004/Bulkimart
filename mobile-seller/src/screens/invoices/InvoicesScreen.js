import React, { useMemo } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import LoadOlderOrders from '../../components/LoadOlderOrders';
import usePagedSellerOrders from '../../hooks/usePagedSellerOrders';
import { dateTime } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// There is no invoice-list endpoint. The web offers an invoice on each delivered order,
// so this list is the seller's delivered orders; each opens GET /orders/:id/invoice.
const isInvoiceable = (o) => Boolean(o.deliveredAt) || o.status === 'delivered';

export default function InvoicesScreen({ navigation }) {
  const paged = usePagedSellerOrders();
  const { data, error, loading, refreshing, refresh, reload, list } = paged;
  const rows = useMemo(() => list.filter(isInvoiceable), [list]);

  if (loading && !data) return <LoadingView message="Loading delivered orders…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => String(item._id)}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListHeaderComponent={<Text style={type.small}>Tax invoices are issued for delivered orders. Load older orders at the bottom to find earlier invoices.</Text>}
      ListFooterComponent={<LoadOlderOrders paged={paged} note="(invoices come from the delivered ones)" />}
      ListEmptyComponent={<EmptyView title="No invoices yet" message={paged.hasMore ? 'No delivered orders among the loaded orders. Load older orders below.' : 'Invoices appear here once an order is delivered.'} />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`Invoice for ${item.orderNo}`} android_ripple={{ color: 'rgba(0,0,0,0.05)' }}
          onPress={() => navigation.navigate('InvoiceDetail', { orderId: item._id, orderNo: item.orderNo })} style={styles.row}>
          <View style={styles.flex}>
            <Text style={type.label}>{item.orderNo}</Text>
            <Text style={type.small}>{item.customer?.name || 'Customer'} · delivered {dateTime(item.deliveredAt || item.placedAt)}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.sm, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, minHeight: 64 },
  flex: { flex: 1, gap: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
});
