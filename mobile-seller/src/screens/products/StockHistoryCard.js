import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import Card from '../../components/Card';
import AppButton from '../../components/AppButton';
import useApiResource from '../../hooks/useApiResource';
import { getStockHistory } from '../../services/product.api';
import { dateTime } from '../../utils/format';
import { colors, spacing, type } from '../../theme';

// Every stock change on this product: sales, cancellations/returns putting units back, manual adjustments and edits.
const REASON = {
  sale: 'Sold', restock: 'Returned to stock', seller_adjustment: 'Adjusted', product_edit: 'Edited on product form', product_created: 'Opening stock',
};

export default function StockHistoryCard({ productId }) {
  const loader = useCallback(() => getStockHistory(productId), [productId]);
  const { data, error, loading, reload } = useApiResource(loader, [loader]);
  const rows = data || [];
  return (
    <Card title="Stock history">
      {loading && !data ? <Text style={type.small}>Loading…</Text> : null}
      {error ? <><Text style={type.small}>{error}</Text><AppButton small variant="outline" title="Retry" onPress={reload} /></> : null}
      {data && !rows.length ? <Text style={type.small}>No stock changes recorded yet.</Text> : null}
      {rows.map((m) => (
        <View key={m._id} style={styles.row}>
          <View style={styles.flex}>
            <Text style={type.label}>{REASON[m.reason] || m.reason}{m.variantName && m.variantName !== 'Default' ? ` · ${m.variantName}` : ''}</Text>
            <Text style={type.small}>{dateTime(m.createdAt)}{m.stockAfter !== undefined && m.stockAfter !== null ? ` · stock now ${m.stockAfter}` : ''}{m.note ? ` · ${m.note}` : ''}</Text>
          </View>
          <Text style={[styles.delta, { color: m.delta < 0 ? colors.error : colors.success }]}>{m.delta > 0 ? `+${m.delta}` : m.delta}</Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  flex: { flex: 1 },
  delta: { fontWeight: '800', fontSize: 15 },
});
