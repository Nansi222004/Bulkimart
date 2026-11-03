import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import AppInput from '../../components/AppInput';
import ChipRow from '../../components/ChipRow';
import { EmptyView, ErrorView, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import useSellerChannel, { CHANNEL_LABEL } from '../../hooks/useSellerChannel';
import { listMyProducts } from '../../services/product.api';
import { isDigital, isWholesaleOnly, productStatus } from '../../utils/productForm';
import { colors, radius, spacing, type } from '../../theme';

// Port of ProductsTab.jsx (retail list). Rows come from GET /api/products/seller/mine for one storefront.
const STATUS_FILTERS = ['All', 'Active', 'Pending Approval', 'Rejected', 'Inactive'];
const STATUS_COLOR = {
  Active: [colors.successLight, '#166534'], 'Pending Approval': [colors.warningLight, '#92400e'],
  Rejected: ['#fee2e2', '#b91c1c'], Inactive: ['#f1f5f9', '#475569'],
};

function ProductRow({ product, onPress }) {
  const status = productStatus(product);
  const [bg, fg] = STATUS_COLOR[status] || STATUS_COLOR.Inactive;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={product.name} onPress={onPress}
      android_ripple={{ color: 'rgba(0,0,0,0.05)' }} style={styles.row}>
      {product.images?.[0]
        ? <Image source={{ uri: product.images[0] }} style={styles.thumb} accessibilityIgnoresInvertColors />
        : <View style={[styles.thumb, styles.noThumb]}><Text style={type.small}>No photo</Text></View>}
      <View style={styles.flex}>
        <Text style={type.label} numberOfLines={2}>{product.name}</Text>
        <Text style={type.small} numberOfLines={1}>{product.category?.name || '—'}</Text>
        <Text style={styles.price}>₹{product.price}{product.variants?.length > 1 ? ` · ${product.variants.length} variants` : ''}</Text>
        <View style={styles.badges}>
          <Text style={[styles.badge, { backgroundColor: bg, color: fg }]}>{status}</Text>
          <Text style={styles.stock}>Stock: {product.stock ?? '—'}</Text>
          {isDigital(product) ? <Text style={styles.tag}>E-book</Text> : null}
          {isWholesaleOnly(product) ? <Text style={styles.tag}>Wholesale</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}

export default function ProductsScreen({ navigation }) {
  const { channels, channel, setChannel, isHybrid } = useSellerChannel();
  const [status, setStatus] = useState('All');
  const [search, setSearch] = useState('');

  const loader = useCallback(() => listMyProducts(channel), [channel]);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  // Re-read after returning from add/edit/delete.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    refresh();
  }, [refresh]));

  const products = useMemo(() => data || [], [data]);
  const counts = useMemo(() => Object.fromEntries(STATUS_FILTERS.map((s) => [s, s === 'All' ? products.length : products.filter((p) => productStatus(p) === s).length])), [products]);
  const shown = useMemo(() => {
    const q = search.toLowerCase().trim();
    return products.filter((p) => (status === 'All' || productStatus(p) === status)
      && (!q || (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)));
  }, [products, status, search]);

  const header = (
    <View style={styles.header}>
      {isHybrid ? <ChipRow accessibilityLabel="Storefront" value={channel} onChange={setChannel}
        options={channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} /> : null}
      <ChipRow accessibilityLabel="Product status" value={status} onChange={setStatus}
        options={STATUS_FILTERS.map((s) => ({ value: s, label: s, count: counts[s] }))} />
      <AppInput placeholder="Search name or SKU" value={search} onChangeText={setSearch} autoCorrect={false} returnKeyType="search" />
    </View>
  );

  return (
    <View style={styles.fill}>
      {loading && !data ? <LoadingView message="Loading your products…" />
        : error && !data ? <ErrorView message={error} onRetry={reload} />
          : (
            <FlatList
              data={shown}
              keyExtractor={(item) => String(item._id)}
              renderItem={({ item }) => <ProductRow product={item} onPress={() => navigation.navigate('ProductDetail', { product: item, channel })} />}
              ListHeaderComponent={header}
              ListEmptyComponent={<EmptyView title="No products" message={products.length ? 'No products match this filter.' : `You have no ${CHANNEL_LABEL[channel]} listings yet.`} />}
              contentContainerStyle={styles.content}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={10}
              windowSize={7}
            />
          )}
      <Pressable accessibilityRole="button" accessibilityLabel="Add product" onPress={() => navigation.navigate('ProductForm', { channel })} style={styles.fab}>
        <Text style={styles.fabText}>＋ Add product</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 96 },
  header: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surface },
  noThumb: { alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, gap: 3 },
  price: { fontSize: 14, fontWeight: '800', color: colors.text },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  badge: { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, overflow: 'hidden' },
  stock: { fontSize: 12, color: colors.textSecondary },
  tag: { fontSize: 11, color: colors.deepBlue, backgroundColor: colors.aquaLight, paddingHorizontal: 6, borderRadius: 4, overflow: 'hidden' },
  fab: { position: 'absolute', right: spacing.lg, bottom: spacing.lg, backgroundColor: colors.orange, borderRadius: radius.pill, paddingHorizontal: spacing.xl, minHeight: 52, justifyContent: 'center', elevation: 4 },
  fabText: { color: colors.white, fontWeight: '800', fontSize: 15 },
});
