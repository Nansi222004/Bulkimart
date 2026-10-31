// Port of modules/User/pages/CategoriesPage.jsx.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { alpha } from '../theme';
import { descendantIds, useCategoryTree } from '../hooks/useCategoryTree';
import { useProducts } from '../hooks/useProducts';
import { mediaUrl } from '../api/client';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { CategoryArtwork, SponsoredCategoryBlock } from '../components/home/HomeSections';
import WishlistHeartButton from '../components/WishlistHeartButton';
import { ChevronLeft, SearchIcon } from '../components/icons';
import { Text } from '../components/ui';
import { formatCurrency } from '../components/home/ProductCards';

const customerRoots = tree => (tree || []).flatMap(category => (category.isSystem ? category.children || [] : [category]));
const branchMatches = (category, query) => !query || String(category.name || '').toLowerCase().includes(query) || (category.children || []).some(child => branchMatches(child, query));
const parentOf = (nodes, id, parent = null) => {
  for (const category of nodes || []) {
    if (category._id === id) return parent;
    const found = parentOf(category.children, id, category);
    if (found !== undefined) return found;
  }
  return undefined;
};

function Skeleton({ style }) { return <View style={[{ backgroundColor: '#eef2f6', borderRadius: 16 }, style]} />; }

export default function CategoriesScreen() {
  const theme = useAppTheme();
  const { activeMode, setActiveMode, addToCart, setSelectedProduct, selectedCategoryFilter, setSelectedCategoryFilter } = useUser();
  const channel = activeMode === 'shop-all' ? 'ecommerce' : 'grocery';
  const { tree, loading, error, retry } = useCategoryTree(channel);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [sponsoredIds, setSponsoredIds] = useState([]);
  const openedFromGrid = useRef([]);
  const bottom = useNavPadding(18);
  const categoryIds = selected ? descendantIds(selected).join(',') : null;
  const { products, loading: productsLoading, error: productsError, retry: retryProducts } = useProducts({ type: channel, category: categoryIds, limit: 60, enabled: selected?.type === channel && !loading });
  const roots = useMemo(() => customerRoots(tree).filter(category => branchMatches(category, query.trim().toLowerCase())), [tree, query]);

  useEffect(() => { setSelected(null); openedFromGrid.current = []; }, [channel]);
  useEffect(() => {
    const slug = selectedCategoryFilter?.slug || selectedCategoryFilter?._id;
    const find = nodes => { for (const category of nodes || []) { if (category.slug === slug || String(category._id) === slug) return category; const child = find(category.children); if (child) return child; } return null; };
    setSelected(slug ? find(tree) : null);
  }, [tree, selectedCategoryFilter?.slug, selectedCategoryFilter?._id, channel]);

  const openCategory = category => { openedFromGrid.current.push(selected); setSelectedCategoryFilter(category); setSelected(category); };
  const parent = selected ? parentOf(tree, selected._id) : null;
  const shownParent = parent && !parent.isSystem ? parent : null;
  // Back follows how the shopper arrived; a deep link steps up to the parent, then the grid (web closeCategory).
  const closeCategory = useCallback(() => {
    if (openedFromGrid.current.length) { const previous = openedFromGrid.current.pop(); setSelectedCategoryFilter(previous || null); setSelected(previous || null); return; }
    if (shownParent) { setSelectedCategoryFilter(shownParent); setSelected(shownParent); return; }
    setSelected(null); setSelectedCategoryFilter(null);
  }, [shownParent, setSelectedCategoryFilter]);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (!selected) return false; closeCategory(); return true; });
    return () => sub.remove();
  }, [selected, closeCategory]));

  if (selected) {
    const listed = products.filter(product => !sponsoredIds.includes(String(product._id)));
    return <CustomerPage background={theme.pageBackground}>
      <View style={[styles.detailHeader, { borderBottomColor: theme.border, backgroundColor: theme.pageBackground }]}>
        <Pressable onPress={closeCategory} accessibilityLabel={`Back to ${shownParent ? shownParent.name : 'all categories'}`} style={[styles.detailBack, { borderColor: theme.border, backgroundColor: theme.cardBackground }]}><ChevronLeft size={20} width={2.4} color={theme.textPrimary} /></Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eyebrow, { color: theme.brandPrimaryDark }]}>{shownParent ? shownParent.name : 'Categories'}</Text>
          <Text style={[styles.detailTitle, { color: theme.brandDeepBlue }]}>{selected.name}</Text>
        </View>
      </View>
      <FlatList data={productsLoading || productsError ? [] : listed} keyExtractor={p => String(p._id)} numColumns={2} columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: bottom, gap: 12 }}
        ListHeaderComponent={<View>
          {selected.children?.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }} accessibilityLabel={`Subcategories of ${selected.name}`}>
            {selected.children.map(child => <Pressable key={child._id} onPress={() => openCategory(child)} style={[styles.chip, { borderColor: theme.border, backgroundColor: theme.cardBackground }]}>
              <View style={styles.chipArt}><CategoryArtwork category={child} fit="cover" radius={17} /></View>
              <Text style={{ fontSize: 13, fontWeight: '700' }}>{child.name}</Text>
            </Pressable>)}
          </ScrollView>}
          <View style={[styles.results, { borderTopColor: theme.border }]}>
            {!productsLoading && !productsError && products.length > 0 && <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: 8 }}>{products.length} {products.length === 1 ? 'product' : 'products'}</Text>}
            <SponsoredCategoryBlock key={`${channel}:${selected._id}`} channel={channel} categoryId={selected._id} ready={!productsLoading && !productsError} onShown={setSponsoredIds} />
            {productsLoading ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} style={{ width: '47%', height: 220 }} />)}</View>
              : productsError ? <View style={[styles.state, styles.compact, { borderColor: theme.border }]} accessibilityRole="alert"><Text style={{ color: theme.textSecondary }}>{productsError}</Text><Pressable onPress={retryProducts} style={[styles.stateBtn, { backgroundColor: theme.primary }]}><Text style={styles.stateBtnText}>Retry</Text></Pressable></View>
                : products.length === 0 ? <View style={[styles.state, styles.compact, { borderColor: theme.border }]}><Text style={{ fontWeight: '700' }}>No available products</Text><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>This category is active but currently has no published stock.</Text></View> : null}
          </View>
        </View>}
        renderItem={({ item: product }) => <View style={[styles.resultCard, { borderColor: theme.border }]}>
          <Pressable onPress={() => setSelectedProduct(product)} accessibilityRole="button" accessibilityLabel={product.name}>
            <View style={[styles.resultImg, { backgroundColor: theme.pageBackground }]}>{product.images?.[0] ? <Image source={{ uri: mediaUrl(product.images[0]) }} style={StyleSheet.absoluteFill} contentFit="contain" /> : null}</View>
            <Text numberOfLines={2} style={styles.resultName}>{product.name}</Text>
            <Text style={{ color: theme.brandDeepBlue, fontWeight: '900' }}>{formatCurrency(product.price)}</Text>
          </Pressable>
          <WishlistHeartButton productId={product._id} size={14} style={{ position: 'absolute', top: 14, right: 14 }} />
          <Pressable onPress={() => addToCart(product)} style={[styles.resultAdd, { borderColor: theme.primary, backgroundColor: theme.highlight }]} accessibilityRole="button" accessibilityLabel={`Add ${product.name} to cart`}>
            <Text style={{ color: theme.brandPrimaryDark, fontWeight: '900' }}>Add</Text>
          </Pressable>
        </View>} />
    </CustomerPage>;
  }

  return <CustomerPage cartBar background={theme.pageBackground}>
    <FlatList data={loading || error ? [] : roots} keyExtractor={c => String(c._id)} numColumns={2} columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: bottom, gap: 12 }} stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{ backgroundColor: theme.pageBackground, paddingTop: 16, paddingBottom: 12, gap: 11 }}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.brandPrimaryDark }]}>BULKIMART CATALOGUE</Text>
          <Text style={[styles.title, { color: theme.brandDeepBlue }]}>Categories</Text>
          <Text style={{ marginTop: 5, color: theme.textSecondary, fontSize: 13 }}>Explore all categories</Text>
        </View>
        <View style={[styles.search, { borderColor: theme.border }]}>
          <SearchIcon size={19} color={theme.textSecondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Find a category" placeholderTextColor="#94a3b8" accessibilityLabel="Find a category" style={[styles.searchInput, { color: theme.textPrimary }]} />
        </View>
        <View style={[styles.tabs, { borderColor: theme.border }]} accessibilityRole="tablist">
          {[['grocery', '⚡ Quick', 'quick'], ['ecommerce', 'ShopAll', 'shop-all']].map(([value, label, mode]) => {
            const active = channel === value;
            return <Pressable key={value} onPress={() => setActiveMode(mode)} accessibilityRole="tab" accessibilityState={{ selected: active }}
              style={[styles.tab, active && { backgroundColor: theme.highlight, borderWidth: 1, borderColor: alpha(theme.primary, 0.25) }]}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: active ? theme.brandPrimaryDark : theme.textSecondary }}>{label}</Text>
            </Pressable>;
          })}
        </View>
      </View>}
      ListEmptyComponent={loading ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} style={{ width: '47%', height: 170 }} />)}</View>
        : error ? <View style={[styles.state, { borderColor: theme.border }]} accessibilityRole="alert"><Text style={{ fontWeight: '700' }}>Categories could not be loaded</Text><Text style={{ color: theme.textSecondary }}>{error}</Text><Pressable onPress={retry} style={[styles.stateBtn, { backgroundColor: theme.primary }]}><Text style={styles.stateBtnText}>Try again</Text></Pressable></View>
          : <View style={[styles.state, { borderColor: theme.border }]}><Text style={{ fontWeight: '700' }}>{query ? 'No matching categories' : 'No categories are published yet'}</Text><Text style={{ color: theme.textSecondary, textAlign: 'center' }}>{query ? 'Try a different search.' : 'Active admin-managed categories will appear here.'}</Text></View>}
      renderItem={({ item: category }) => <Pressable onPress={() => openCategory(category)} style={[styles.card, { borderColor: theme.border }]} accessibilityRole="button" accessibilityLabel={category.name}>
        <LinearGradient colors={['#f0fdf4', theme.highlight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.art}>
          <View style={{ flex: 1, width: '100%' }}><CategoryArtwork category={category} fit="cover" /></View>
        </LinearGradient>
        <Text numberOfLines={2} style={styles.cardName}>{category.name}</Text>
        <Text style={{ color: theme.textSecondary, fontSize: 11, fontWeight: '600' }}>{category.children?.length ? `${category.children.length} subcategories` : 'Browse products'}</Text>
      </Pressable>} />
  </CustomerPage>;
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginBottom: 3 },
  title: { fontSize: 25, fontWeight: '700', lineHeight: 28 },
  search: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderWidth: 1, borderRadius: 12, backgroundColor: '#fff' },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15 },
  tabs: { flexDirection: 'row', padding: 4, borderWidth: 1, borderRadius: 12, backgroundColor: '#fff' },
  tab: { flex: 1, minHeight: 38, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  card: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 10, borderWidth: 1.5, borderRadius: 16, backgroundColor: '#fff', elevation: 1 },
  art: { width: '100%', aspectRatio: 1.25, borderRadius: 12, padding: 8, overflow: 'hidden' },
  cardName: { fontSize: 13.5, fontWeight: '700', lineHeight: 17, textAlign: 'center' },
  state: { marginVertical: 48, padding: 28, alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 16, backgroundColor: '#fff' },
  compact: { marginVertical: 12, padding: 20 },
  stateBtn: { marginTop: 5, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 9 },
  stateBtnText: { color: '#fff', fontWeight: '800' },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 16, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  detailBack: { width: 44, height: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  detailTitle: { fontSize: 22, fontWeight: '700', lineHeight: 26 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingVertical: 4, paddingLeft: 4, paddingRight: 14, borderWidth: 1, borderRadius: 999 },
  chipArt: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden' },
  results: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, marginBottom: 4 },
  resultCard: { flex: 1, padding: 8, borderWidth: 1, borderRadius: 15, backgroundColor: '#fff' },
  resultImg: { width: '100%', aspectRatio: 1, borderRadius: 11, overflow: 'hidden', marginBottom: 7 },
  resultName: { minHeight: 34, fontSize: 13, lineHeight: 17, fontWeight: '700', marginBottom: 7 },
  resultAdd: { marginTop: 9, padding: 8, borderWidth: 1, borderRadius: 9, alignItems: 'center' },
});
