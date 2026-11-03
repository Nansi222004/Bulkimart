import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import { loadSellerFinances } from '../../services/finance';
import { money } from '../../utils/format';
import { colors, radius, spacing, type } from '../../theme';

// Port of PaymentHistoryTab.jsx. The list comes from summary.payouts.
const statusText = (p) => (p.status === 'APPROVED' ? 'Paid'
  : p.status === 'PENDING' ? 'Being processed'
    : `Rejected${p.rejectionReason ? `: ${p.rejectionReason}` : ''}`);

export default function PayoutHistoryScreen() {
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loadSellerFinances, []);
  if (loading && !data) return <LoadingView message="Loading payout history…" />;
  if (!data) return <ErrorView message={error || 'Payout history could not be loaded. Please retry.'} onRetry={reload} retryLabel="Refresh" />;

  return (
    <FlatList
      data={data.summary.payouts}
      keyExtractor={(item) => String(item._id)}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
      ListHeaderComponent={<Text style={type.small}>Delivered orders appear in Earnings. This list shows payout requests and manually reconciled bank transfers; submitting a request does not send money.</Text>}
      ListEmptyComponent={<EmptyView title="No payouts yet" message="No payout transaction has been recorded." />}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={type.label}>{item.payoutNo}</Text>
            <Text style={type.small}>{statusText(item)}{item.transactionRef ? ` · Bank reference ${item.transactionRef}` : ''}</Text>
          </View>
          <Text style={styles.amount}>{money(item.amount)}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  flex: { flex: 1 },
  amount: { fontWeight: '800', fontSize: 15, color: colors.text },
});
