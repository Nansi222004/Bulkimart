// Port of modules/User/pages/WholesalePage.jsx (route /wholesale?q=&category=&sort=&page=): the approved bulk
// offers catalogue with search, category/sort filters and pages. Prices and MOQ come from the catalogue API.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { alpha } from '../theme';
import { boundedFetch, mediaUrl } from '../api/client';
import { useRefreshHandler } from '../lib/refresh';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Text } from '../components/ui';
import SelectField from '../components/SelectField';

const imageUrl = product => { const first = product?.images?.[0]; return typeof first === 'string' ? first : first?.url || first?.secure_url || ''; };
const formatPrice = price => `₹${Number(price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const SORTS = [{ value: 'default', label: 'Recommended' }, { value: 'name', label: 'Name' }, { value: 'price-asc', label: 'Bulk price: low to high' }, { value: 'price-desc', label: 'Bulk price: high to low' }];
const Icon = ({ size = 14, color, width = 2.5, children }) => <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">{children}</Svg>;

function WholesaleArtwork({ product, theme }) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(product);
  return src && !failed
    ? <Image source={{ uri: mediaUrl(src) }} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} contentFit="contain" accessibilityLabel={product.name} />
    : <View style={[styles.fallback, { borderColor: '#b8e9f7' }]} accessibilityLabel={product.name || 'Product image unavailable'}><Text style={{ fontWeight: '800', fontSize: 16, color: theme.actionHover }}>BM</Text></View>;
}

export default function WholesaleScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams();
  const { openWholesaleProduct } = useUser();
  const bottom = useNavPadding(16);
  const blue = theme.action, blueDark = theme.actionHover;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(() => String(params.q || ''));
  const [category, setCategory] = useState(() => String(params.category || ''));
  const [page, setPage] = useState(() => Math.max(1, Number(params.page) || 1));
  const [pages, setPages] = useState(1);
  const [categories, setCategories] = useState([]);
  const [sort, setSort] = useState(() => String(params.sort || 'default'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const list = useRef(null);
  const activeFilters = Number(Boolean(category)) + Number(sort !== 'default');

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    const search = new URLSearchParams({ page: String(page), limit: '24' });
    if (query.trim()) search.set('q', query.trim());
    if (category) search.set('category', category);
    if (sort !== 'default') search.set('sort', sort);
    boundedFetch(`/api/products/wholesale/catalog?${search}`, { signal: controller.signal, headers: { 'Cache-Control': 'no-store' } })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || `Wholesale offers could not be loaded (${response.status}).`);
        if (!Array.isArray(body.data)) throw new Error('Invalid Wholesale catalog response. Please retry.');
        if (active) { setPages(body.meta?.pages || 1); setCategories(body.meta?.categories || []); setProducts(body.data); }
      })
      .catch(requestError => {
        if (!active || requestError.name === 'AbortError') return;
        setProducts([]); setError(requestError.message || 'Wholesale offers could not be loaded.');
      })
      .finally(() => { if (active) { setLoading(false); setRefreshing(false); } });
    return () => { active = false; controller.abort(); };
  }, [attempt, page, query, category, sort]);
  useRefreshHandler(() => setAttempt(value => value + 1));

  const updateFilter = (key, value) => {
    const next = { q: query, category, sort: sort === 'default' ? '' : sort, page: String(page), [key]: value };
    if (key !== 'page') next.page = '1';
    router.setParams({ q: next.q || undefined, category: next.category || undefined, sort: next.sort || undefined, page: next.page === '1' ? undefined : next.page });
    if (key === 'q') setQuery(value);
    if (key === 'category') setCategory(value);
    if (key === 'sort') setSort(value || 'default');
    setPage(key === 'page' ? Number(value) : 1);
    if (key === 'page') list.current?.scrollToOffset({ offset: 0, animated: true });
  };
  const resetFilters = (alsoQuery = false) => {
    setCategory(''); setSort('default'); setPage(1);
    if (alsoQuery) setQuery('');
    router.setParams({ category: undefined, sort: undefined, page: undefined, ...(alsoQuery ? { q: undefined } : {}) });
  };
  const openProduct = product => openWholesaleProduct(product._id, product.variants?.find(v => v.available)?.variantId);

  const header = <View>
    <LinearGradient colors={['#ffffff', '#f0faff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: blue, borderWidth: 3, borderColor: alpha(theme.primary, 0.22) }} />
        <Text style={{ color: blueDark, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.9, textTransform: 'uppercase' }}>Bulkimart · Bulk Buying</Text>
      </View>
      <Text accessibilityRole="header" style={{ marginBottom: 4, color: theme.text, fontSize: 19, fontWeight: '800', lineHeight: 23, letterSpacing: -0.4 }}>Wholesale / Bulk Buying</Text>
      <Text style={{ color: theme.muted, fontSize: 12.5, lineHeight: 17.5 }}>Buy in bulk from approved sellers with quantity-based pricing.</Text>
    </LinearGradient>
    <View style={[styles.toolbar, { borderColor: theme.border }]}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ position: 'absolute', left: 13, zIndex: 1 }}><Icon size={16} width={2.2} color="#94a3b8"><Circle cx="11" cy="11" r="8" /><Line x1="21" y1="21" x2="16.65" y2="16.65" /></Icon></View>
          <TextInput value={query} onChangeText={value => updateFilter('q', value)} placeholder="Search products, sellers or categories" placeholderTextColor="#94a3b8"
            accessibilityLabel="Search Wholesale offers" returnKeyType="search" style={[styles.search, { borderColor: theme.border, color: theme.text }]} />
          {query ? <Pressable onPress={() => updateFilter('q', '')} accessibilityLabel="Clear search" style={styles.clear}><Text style={{ fontSize: 11, color: '#64748b' }}>✕</Text></Pressable> : null}
        </View>
        <Pressable onPress={() => setFiltersOpen(open => !open)} accessibilityLabel="Filters" accessibilityState={{ expanded: filtersOpen }}
          style={[styles.filterBtn, { borderColor: filtersOpen ? blue : theme.border, backgroundColor: filtersOpen ? theme.highlight || '#fff7e6' : '#fff' }]}>
          <Icon size={18} width={2.2} color={filtersOpen ? blueDark : theme.text}><Line x1="4" y1="6" x2="20" y2="6" /><Line x1="7" y1="12" x2="17" y2="12" /><Line x1="10" y1="18" x2="14" y2="18" /></Icon>
          {activeFilters > 0 && <View accessibilityLabel={`${activeFilters} active`} style={[styles.dot, { backgroundColor: blue }]} />}
        </Pressable>
      </View>
      {filtersOpen && <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.background || '#fafafa' }]}>
        <SelectField label="Category" labelStyle={styles.panelLabel} value={category} onChange={value => updateFilter('category', value)} options={[{ value: '', label: 'All Categories' }, ...categories.map(name => ({ value: name, label: name }))]} />
        <SelectField label="Sort" labelStyle={styles.panelLabel} value={sort} onChange={value => updateFilter('sort', value === 'default' ? '' : value)} options={SORTS} />
        {activeFilters > 0 && <Pressable onPress={() => resetFilters()} style={{ paddingVertical: 6, alignSelf: 'flex-start' }}>
          <Text style={{ color: blueDark, fontSize: 13, fontWeight: '700' }}>Clear filters</Text>
        </Pressable>}
      </View>}
      <View style={styles.metaRow}>
        <Text style={{ fontSize: 12.5, color: theme.muted }}>{loading ? 'Loading offers…' : error ? 'Offers unavailable' : <>Showing <Text style={{ fontWeight: '700', color: theme.text, fontSize: 12.5 }}>{products.length}</Text> {products.length === 1 ? 'offer' : 'offers'}</>}</Text>
        {category ? <Pressable onPress={() => updateFilter('category', '')} accessibilityLabel={`Remove category ${category}`} style={[styles.chip, { borderColor: theme.border }]}>
          <Text style={{ color: blueDark, fontSize: 12, fontWeight: '700' }}>{category} ✕</Text>
        </Pressable> : null}
      </View>
    </View>
    {loading && !refreshing ? <View style={[styles.state, { borderColor: theme.border }]} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={blueDark} style={{ marginBottom: 14 }} />
      <Text style={{ color: theme.muted, fontSize: 14, fontWeight: '600' }}>Loading approved Wholesale offers…</Text>
    </View> : error ? <View style={[styles.state, { borderColor: '#fecaca', backgroundColor: '#fffafa' }]} accessibilityRole="alert">
      <View style={{ marginBottom: 12 }}><Icon size={32} width={2} color="#ef4444"><Circle cx="12" cy="12" r="10" /><Line x1="12" y1="8" x2="12" y2="12" /><Line x1="12" y1="16" x2="12.01" y2="16" /></Icon></View>
      <Text style={styles.stateText}>{error}</Text>
      <Pressable onPress={() => setAttempt(value => value + 1)} style={[styles.primaryBtn, { backgroundColor: blueDark }]}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>Try again</Text></Pressable>
    </View> : null}
  </View>;

  const renderCard = ({ item: product }) => {
    const available = product.variants?.filter(variant => variant.available) || [];
    const fromPrice = Math.min(...available.flatMap(variant => (variant.priceTiers || []).map(tier => Number(tier.unitPrice))));
    const minMoq = available.length ? Math.min(...available.map(variant => variant.minimumQuantity || 1)) : 1;
    return <Pressable onPress={() => openProduct(product)} accessibilityRole="button" accessibilityLabel={`View wholesale details for ${product.name}`} style={[styles.card, { borderColor: theme.border }]}>
      <LinearGradient colors={['#f8fafc', '#f1f5f9']} style={styles.art}>
        <View style={{ width: '100%', height: '100%', padding: 10, alignItems: 'center', justifyContent: 'center' }}><WholesaleArtwork product={product} theme={theme} /></View>
        {product.category?.name ? <Text numberOfLines={1} style={[styles.tag, { color: blueDark }]}>{product.category.name}</Text> : null}
      </LinearGradient>
      <View style={{ flex: 1, paddingTop: 10, paddingHorizontal: 10, paddingBottom: 12, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon size={12} width={2} color="#94a3b8"><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Polyline points="9 22 9 12 15 12 15 22" /></Icon>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, fontWeight: '600', color: theme.muted }}>{product.seller?.name || 'Approved seller'}</Text>
        </View>
        <Text numberOfLines={2} style={{ fontSize: 12.5, fontWeight: '700', color: theme.text, lineHeight: 17, height: 34 }}>{product.name}</Text>
        <View style={{ marginTop: 2 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Wholesale Price</Text>
          <Text style={{ fontSize: 13.5, fontWeight: '800', color: theme.text, lineHeight: 16 }}>From {Number.isFinite(fromPrice) ? formatPrice(fromPrice) : '—'} <Text style={{ fontSize: 11.5, fontWeight: '600', color: theme.muted }}>/ unit</Text></Text>
        </View>
        <View style={{ flex: 1 }} />
        <View style={[styles.metaCard, { borderTopColor: theme.border }]}>
          <Text style={[styles.moq, { color: theme.actionHover, backgroundColor: theme.highlight }]}>MOQ: {minMoq} {minMoq === 1 ? 'unit' : 'units'}</Text>
          <Text style={{ color: theme.muted, fontSize: 11, fontWeight: '600' }}>{available.length === 1 ? '1 variant' : `${available.length} variants`}</Text>
        </View>
        <View style={[styles.cta, { backgroundColor: theme.highlight }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: blueDark }}>View Product</Text>
          <Icon color={blueDark}><Polyline points="9 18 15 12 9 6" /></Icon>
        </View>
      </View>
    </Pressable>;
  };

  const showList = !(loading && !refreshing) && !error;
  return <CustomerPage background={theme.pageBackground}>
    <FlatList ref={list} data={showList ? products : []} keyExtractor={p => String(p._id)} numColumns={2} renderItem={renderCard}
      ListHeaderComponent={header} columnWrapperStyle={{ gap: 10 }} contentContainerStyle={{ paddingTop: 10, paddingHorizontal: 10, gap: 10, paddingBottom: bottom }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setAttempt(value => value + 1); }} colors={[blue]} />}
      ListEmptyComponent={showList ? <View style={[styles.state, { borderColor: theme.border }]}>
        <View style={{ marginBottom: 12 }}><Icon size={36} width={1.8} color="#94a3b8"><Rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><Path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></Icon></View>
        <Text style={{ marginBottom: 6, color: theme.text, fontSize: 19, fontWeight: '800', textAlign: 'center' }}>{query || category ? 'No matching offers found' : 'No Wholesale offers available'}</Text>
        <Text style={styles.stateText}>{query || category ? 'Try another search or select a different category.' : 'Approved sellers’ available bulk offers will appear here.'}</Text>
        {(query || category) ? <Pressable onPress={() => resetFilters(true)} style={[styles.secondaryBtn, { borderColor: theme.border }]}><Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>Clear filters</Text></Pressable> : null}
      </View> : null}
      ListFooterComponent={showList && pages > 1 ? <View style={styles.pagination} accessibilityLabel="Wholesale catalog pages">
        <Pressable disabled={page <= 1} onPress={() => updateFilter('page', String(page - 1))} accessibilityLabel="Previous page" style={[styles.pageBtn, { borderColor: theme.border }, page <= 1 && { opacity: 0.45 }]}>
          <Icon color={theme.text}><Polyline points="15 18 9 12 15 6" /></Icon><Text style={{ fontSize: 12, fontWeight: '700', color: theme.text }}>Previous</Text>
        </Pressable>
        <Text style={{ fontSize: 12, color: theme.muted }}>Page <Text style={{ fontWeight: '700', color: theme.text, fontSize: 12 }}>{page}</Text> of <Text style={{ fontWeight: '700', color: theme.text, fontSize: 12 }}>{pages}</Text></Text>
        <Pressable disabled={page >= pages} onPress={() => updateFilter('page', String(page + 1))} accessibilityLabel="Next page" style={[styles.pageBtn, { borderColor: theme.border }, page >= pages && { opacity: 0.45 }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: theme.text }}>Next</Text><Icon color={theme.text}><Polyline points="9 18 15 12 9 6" /></Icon>
        </Pressable>
      </View> : null} />
  </CustomerPage>;
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderColor: '#d9f2fa', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 10 },
  toolbar: { backgroundColor: '#fff', borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12, gap: 12 },
  search: { minHeight: 44, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 38, fontSize: 16, backgroundColor: '#fff' },
  clear: { position: 'absolute', right: 10, width: 22, height: 22, borderRadius: 11, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  filterBtn: { width: 46, height: 46, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#fff' },
  panel: { gap: 6, padding: 12, borderWidth: 1, borderRadius: 12 },
  panelLabel: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  chip: { minHeight: 28, paddingHorizontal: 10, borderWidth: 1, borderRadius: 999, backgroundColor: '#fff', justifyContent: 'center' },
  state: { borderWidth: 1, borderRadius: 16, paddingVertical: 48, paddingHorizontal: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  stateText: { marginBottom: 16, color: '#64748b', fontSize: 13.5, lineHeight: 19.5, textAlign: 'center' },
  primaryBtn: { minHeight: 40, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 18, justifyContent: 'center' },
  secondaryBtn: { minHeight: 40, borderWidth: 1, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 18, backgroundColor: '#fff', justifyContent: 'center' },
  card: { flex: 1, maxWidth: '50%', backgroundColor: '#fff', borderWidth: 1, borderRadius: 14, overflow: 'hidden', elevation: 1 },
  art: { height: 135, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tag: { position: 'absolute', top: 8, left: 8, maxWidth: '85%', backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: 'rgba(226,232,240,0.85)', borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, overflow: 'hidden' },
  fallback: { width: 64, height: 64, borderWidth: 1.5, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  metaCard: { gap: 4, paddingTop: 6, borderTopWidth: 1, borderStyle: 'dashed', alignItems: 'flex-start' },
  moq: { fontWeight: '700', fontSize: 10.5, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: '#ffedd5', overflow: 'hidden' },
  cta: { marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  pageBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: 12, borderWidth: 1, borderRadius: 8, backgroundColor: '#fff' },
});
