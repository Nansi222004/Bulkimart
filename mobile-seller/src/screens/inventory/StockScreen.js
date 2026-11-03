import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Modal, RefreshControl, StyleSheet, ToastAndroid, View } from 'react-native';
import { Text } from '../../components/AppText';
import { useFocusEffect } from '@react-navigation/native';
import AppInput from '../../components/AppInput';
import AppButton from '../../components/AppButton';
import ChipRow from '../../components/ChipRow';
import { EmptyView, ErrorView, InlineNotice, LoadingView } from '../../components/StateViews';
import useApiResource from '../../hooks/useApiResource';
import useSellerChannel, { CHANNEL_LABEL } from '../../hooks/useSellerChannel';
import { adjustProductStock, listMyProducts } from '../../services/product.api';
import { getDashboard } from '../../services/seller.api';
import { LOW_STOCK_THRESHOLD, isDigital, stockHealth } from '../../utils/productForm';
import { colors, radius, spacing, type } from '../../theme';

// Port of StockTab.jsx. Counts come from the server (GET /api/sellers/dashboard?type=); rows from /products/seller/mine.
// The web's generated "product code" and client-side stock valuation are deliberately not reproduced.
const FILTERS = [{ value: 'all', label: 'All' }, { value: 'in', label: 'In stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }];
const HEALTH = { out: ['OUT OF STOCK', '#fee2e2', '#dc2626'], low: ['LOW STOCK', '#fff7ed', '#ea580c'], ok: ['IN STOCK', colors.aquaLight, colors.primaryDark] };

function StockAdjustSheet({ product, onClose, onSaved }) {
  const current = Number(product?.stock ?? 0);
  const [value, setValue] = useState(String(current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setValue(String(current)); setError(''); }, [product, current]);
  if (!product) return null;

  const target = Number(value);
  const delta = Number.isSafeInteger(target) ? target - current : NaN;
  const firstVariant = product.variants?.[0];
  const multi = (product.variants?.length || 0) > 1;

  const save = async () => {
    setError('');
    if (value === '' || !Number.isSafeInteger(target) || target < 0) { setError('Enter a whole number of 0 or more.'); return; }
    if (delta === 0) { setError('Stock is unchanged.'); return; }
    setBusy(true);
    try {
      await adjustProductStock(product._id, delta);
      ToastAndroid.show('Stock updated successfully!', ToastAndroid.SHORT);
      onSaved();
    } catch (e) {
      setError(e.status === 409 ? 'Stock changed before this update could be applied. The list has been refreshed; please check and try again.' : e.message || 'Could not update stock');
      if (e.status === 409) onSaved({ keepOpen: true });
    } finally { setBusy(false); }
  };

  const step = (n) => setValue((v) => String(Math.max(0, (Number.isSafeInteger(Number(v)) ? Number(v) : current) + n)));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={type.heading} numberOfLines={2}>{product.name}</Text>
          <Text style={type.small}>Current stock: {current}{multi && firstVariant ? ` · this changes the “${firstVariant.name}” variant` : ''}</Text>
          {multi ? <InlineNotice tone="info">Stock adjustment applies to the first variant. Use Edit product to change other variants.</InlineNotice> : null}
          <View style={styles.stepper}>
            <AppButton small variant="outline" title="−10" disabled={busy} onPress={() => step(-10)} />
            <AppButton small variant="outline" title="−1" disabled={busy} onPress={() => step(-1)} />
            <AppInput style={styles.stepInput} keyboardType="number-pad" value={value} editable={!busy} accessibilityLabel="New stock"
              onChangeText={(t) => setValue(t.replace(/\D/g, ''))} />
            <AppButton small variant="outline" title="+1" disabled={busy} onPress={() => step(1)} />
            <AppButton small variant="outline" title="+10" disabled={busy} onPress={() => step(10)} />
          </View>
          {Number.isFinite(delta) && delta !== 0 ? <Text style={type.small}>Change: {delta > 0 ? `+${delta}` : delta}</Text> : null}
          {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
          <View style={styles.actions}>
            <AppButton title="Cancel" variant="outline" disabled={busy} onPress={onClose} style={styles.flex} />
            <AppButton title="Save" loading={busy} onPress={save} style={styles.flex} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default function StockScreen({ route }) {
  const { channels, channel, setChannel, isHybrid } = useSellerChannel();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [adjusting, setAdjusting] = useState(null);

  useEffect(() => { if (route.params?.channel && channels.includes(route.params.channel)) setChannel(route.params.channel); }, [route.params?.channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const loader = useCallback(async () => {
    const [rows, dashboard] = await Promise.all([listMyProducts(channel), getDashboard(channel).catch(() => null)]);
    return { rows: rows.filter((p) => !isDigital(p)), kpis: dashboard?.kpis || null };
  }, [channel]);
  const { data, error, loading, refreshing, refresh, reload } = useApiResource(loader, [loader]);

  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => { if (firstFocus.current) { firstFocus.current = false; return; } refresh(); }, [refresh]));

  // Open the sheet for the product the detail screen sent us to.
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current || !data || !route.params?.focusId) return;
    const match = data.rows.find((p) => String(p._id) === String(route.params.focusId));
    if (match) { focused.current = true; setAdjusting(match); }
  }, [data, route.params?.focusId]);

  const rows = useMemo(() => data?.rows || [], [data]);
  const shown = useMemo(() => {
    const q = search.toLowerCase().trim();
    return rows.filter((p) => {
      const h = stockHealth(p.stock);
      const matches = filter === 'all' || (filter === 'in' && p.stock > 0) || (filter === 'low' && h === 'low') || (filter === 'out' && h === 'out');
      return matches && (!q || (p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    });
  }, [rows, filter, search]);
  const k = data?.kpis;

  if (loading && !data) return <LoadingView message="Loading stock…" />;
  if (error && !data) return <ErrorView message={error} onRetry={reload} />;

  const header = (
    <View style={styles.header}>
      {isHybrid ? <ChipRow value={channel} onChange={setChannel} accessibilityLabel="Storefront" options={channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] }))} /> : null}
      {k ? (
        <View style={styles.kpis}>
          <Kpi label="Products" value={k.productCount} />
          <Kpi label="Live" value={k.liveCount} />
          <Kpi label="Low stock" value={k.lowStockCount} color="#ea580c" />
          <Kpi label="Out of stock" value={k.outOfStockCount} color="#dc2626" />
        </View>
      ) : <InlineNotice tone="warning">Stock counts could not be loaded. The list below is still current.</InlineNotice>}
      <Text style={type.small}>Low stock means fewer than {LOW_STOCK_THRESHOLD} units (the platform rule). Stock change history is not available yet.</Text>
      <ChipRow value={filter} onChange={setFilter} options={FILTERS} accessibilityLabel="Stock filter" />
      <AppInput placeholder="Search name or SKU" value={search} onChangeText={setSearch} autoCorrect={false} />
    </View>
  );

  return (
    <>
      <FlatList
        data={shown}
        keyExtractor={(item) => String(item._id)}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primaryDark]} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyView title="Nothing here" message={rows.length ? 'No products match this filter.' : 'Add products to manage their stock.'} />}
        renderItem={({ item }) => {
          const [label, bg, fg] = HEALTH[stockHealth(item.stock)];
          return (
            <View style={styles.row}>
              {item.images?.[0] ? <Image source={{ uri: item.images[0] }} style={styles.thumb} /> : <View style={styles.thumb} />}
              <View style={styles.flex}>
                <Text style={type.label} numberOfLines={2}>{item.name}</Text>
                <Text style={type.small}>{item.sku ? `SKU ${item.sku} · ` : ''}₹{item.price}</Text>
                {(item.variants?.length || 0) > 1 ? <Text style={type.small} numberOfLines={2}>{item.variants.map((v) => `${v.name}: ${v.stock}`).join(' · ')}</Text> : null}
                <View style={styles.bottom}>
                  <Text style={[styles.health, { backgroundColor: bg, color: fg }]}>{label} · {item.stock}</Text>
                  <AppButton small variant="outline" title="Adjust" onPress={() => setAdjusting(item)} />
                </View>
              </View>
            </View>
          );
        }}
      />
      <StockAdjustSheet product={adjusting} onClose={() => setAdjusting(null)}
        onSaved={(opts) => { if (!opts?.keepOpen) setAdjusting(null); refresh(); }} />
    </>
  );
}

function Kpi({ label, value, color }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, color && { color }]}>{Number.isFinite(value) ? value : '—'}</Text>
      <Text style={type.small}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl, backgroundColor: colors.surface },
  header: { gap: spacing.md },
  kpis: { flexDirection: 'row', gap: spacing.sm },
  kpi: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: 'center' },
  kpiValue: { fontSize: 18, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, backgroundColor: colors.surface },
  flex: { flex: 1, gap: 3 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  health: { fontSize: 11, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepInput: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.md },
});
