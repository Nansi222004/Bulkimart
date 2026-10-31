// Port of modules/User/pages/SearchPage.jsx.
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { boundedFetch, mediaUrl } from '../api/client';
import { local, readJSON } from '../lib/storage';
import { normalizeProduct } from '../hooks/useProducts';
import { CustomerPage, useNavPadding } from '../components/Shell';
import BackButton from '../components/BackButton';
import ImageSearchSheet, { ImageSearchButton, searchProductsByImage, validateSearchImage } from '../components/ImageSearchSheet';
import { CloseIcon, MicIcon, SearchIcon } from '../components/icons';
import { Text } from '../components/ui';
import { formatCurrency } from '../components/home/ProductCards';

const RECENT_KEY = 'nhcone_recent_searches';
const MAX_RECENT = 10;
const readRecent = () => { const value = readJSON(local, RECENT_KEY, []); return Array.isArray(value) ? value : []; };
const writeRecent = list => local.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));

function createLatestRequest() {
  let current = null;
  return {
    start() { current?.cancel(); const task = { cancelled: false, cancel() { this.cancelled = true; }, isCurrent: () => current === task && !task.cancelled }; current = task; return task; },
    cancel() { current?.cancel(); current = null; },
  };
}

function ResultCard({ product, onPress, showShop = true }) {
  const theme = useAppTheme();
  const image = product.matchedImageUrl || product.images?.[0];
  return <Pressable onPress={onPress} style={[styles.card, { backgroundColor: theme.cardBackground }]} accessibilityRole="button" accessibilityLabel={product.name}>
    <View style={styles.cardImg}>{image ? <Image source={{ uri: mediaUrl(typeof image === 'string' ? image : image?.url) }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}</View>
    <Text numberOfLines={2} style={[styles.cardName, { color: theme.textPrimary }]}>{product.name}</Text>
    {showShop ? <Text numberOfLines={1} style={styles.cardShop}>{product.sellerId?.storeDetails?.name || product.sellerId?.businessName || ''}</Text> : null}
    <Text style={[styles.cardPrice, { color: theme.textPrimary }]}>{formatCurrency(product.price)}</Text>
  </Pressable>;
}

export default function SearchScreen() {
  const theme = useAppTheme();
  const { activeMode, setActiveNav, setSelectedProduct, openVoiceSearch, pendingVoiceQuery, setPendingVoiceQuery, imageSearchRequest, setImageSearchRequest } = useUser();
  const searchType = activeMode === 'shop-all' ? 'ecommerce' : 'grocery';
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState(readRecent);
  const [editingRecent, setEditingRecent] = useState(false);
  const [featured, setFeatured] = useState([]);
  const [defaultsLoading, setDefaultsLoading] = useState(true);
  const [imageSheetOpen, setImageSheetOpen] = useState(false), [imageMode, setImageMode] = useState(false);
  const [imageAsset, setImageAsset] = useState(null);
  const [imageMeta, setImageMeta] = useState({ page: 1, limit: 20, total: 0 }), [searchError, setSearchError] = useState('');
  const [imageMaxBytes, setImageMaxBytes] = useState(5 * 1024 * 1024);
  const imageRequests = useRef(createLatestRequest());
  const bottom = useNavPadding(16);

  const closeImageSheet = () => { imageRequests.current.cancel(); if (imageMode) { setLoading(false); if (loading) { setImageMode(false); setImageAsset(null); setResults([]); } } setImageSheetOpen(false); };
  const applyTextSearch = value => { imageRequests.current.cancel(); setImageMode(false); setImageAsset(null); setSearchError(''); setTerm(value); };
  useEffect(() => { if (imageSearchRequest) { setImageSheetOpen(true); setImageSearchRequest(0); } }, [imageSearchRequest, setImageSearchRequest]);
  useEffect(() => {
    const controller = new AbortController();
    boundedFetch('/api/products/search-by-image/config', { signal: controller.signal }).then(r => (r.ok ? r.json() : null)).then(body => { if (!controller.signal.aborted && body?.data?.maxBytes) setImageMaxBytes(body.data.maxBytes); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { const requests = imageRequests.current; requests.cancel(); setImageMode(false); setImageAsset(null); setResults([]); setSearchError(''); return () => requests.cancel(); }, [searchType]);

  const runImageSearch = async (asset, page = 1) => {
    validateSearchImage(asset, imageMaxBytes);
    const task = imageRequests.current.start();
    setTerm(''); setImageMode(true); setLoading(true); setSearchError(''); setResults([]); setImageAsset(asset);
    try {
      const body = await searchProductsByImage(asset, { type: searchType, page });
      if (!task.isCurrent()) return false;
      setResults(body.data || []); setImageMeta(body.meta || { page, limit: 20, total: 0 }); return true;
    } catch (error) {
      if (task.isCurrent()) { setSearchError(error.message || 'Image search failed. Please try again.'); throw error; }
      return false;
    } finally { if (task.isCurrent()) setLoading(false); }
  };

  const rememberSearch = (label, image) => {
    const next = [{ label, image }, ...recent.filter(r => r.label.toLowerCase() !== label.toLowerCase())].slice(0, MAX_RECENT);
    setRecent(next); writeRecent(next);
  };
  useEffect(() => {
    if (pendingVoiceQuery) { applyTextSearch(pendingVoiceQuery); rememberSearch(pendingVoiceQuery, ''); setPendingVoiceQuery(''); }
  }, [pendingVoiceQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setDefaultsLoading(true);
    boundedFetch(`/api/products/featured?type=${searchType}`).then(r => (r.ok ? r.json() : [])).catch(() => []).then(rows => { if (!cancelled) setFeatured(Array.isArray(rows) ? rows : []); }).finally(() => { if (!cancelled) setDefaultsLoading(false); });
    return () => { cancelled = true; };
  }, [searchType]);

  // Debounced live search; a newer keystroke aborts the older request so stale results never overwrite fresh ones.
  useEffect(() => {
    if (imageMode) return undefined;
    const q = term.trim();
    if (q.length < 2) { setResults([]); setLoading(false); return undefined; }
    setLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      boundedFetch(`/api/products/search?q=${encodeURIComponent(q)}&type=${searchType}`, { signal: controller.signal })
        .then(r => (r.ok ? r.json() : []))
        .then(rows => { if (!controller.signal.aborted) setResults(Array.isArray(rows) ? rows : []); })
        .catch(err => { if (!controller.signal.aborted && err.name !== 'AbortError') setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(handle); controller.abort(); };
  }, [term, searchType, imageMode]);

  const openProduct = p => {
    rememberSearch(p.name, p.matchedImageUrl || p.images?.[0]);
    const normalized = normalizeProduct(p);
    if (p.matchedImageUrl) normalized.image = p.matchedImageUrl;
    setSelectedProduct(normalized);
  };
  const removeRecent = label => { const next = recent.filter(r => r.label !== label); setRecent(next); writeRecent(next); };
  const showingResults = imageMode || term.trim().length >= 2;
  const grid = (rows, showShop) => <FlatList data={rows} keyExtractor={p => String(p._id)} numColumns={2} scrollEnabled={false} columnWrapperStyle={{ gap: 12 }} contentContainerStyle={{ gap: 12 }}
    renderItem={({ item }) => <View style={{ flex: 1 }}><ResultCard product={item} showShop={showShop} onPress={() => openProduct(item)} /></View>} />;

  return <CustomerPage>
    <View style={[styles.header, { borderBottomColor: theme.border, backgroundColor: theme.pageBackground }]}>
      <BackButton onPress={() => setActiveNav('home')} />
      <View style={[styles.inputWrap, { backgroundColor: theme.cardBackground }]}>
        <SearchIcon size={17} width={2.5} color="#94a3b8" />
        <TextInput autoFocus value={term} onChangeText={applyTextSearch} placeholder={`Search ${activeMode === 'shop-all' ? 'Shop All' : 'Quick'} products or shops`} placeholderTextColor="#94a3b8"
          style={[styles.input, { color: theme.textPrimary }]} accessibilityLabel="Search" returnKeyType="search" onSubmitEditing={() => term.trim() && rememberSearch(term.trim(), '')} />
        {term ? <Pressable onPress={() => applyTextSearch('')} accessibilityLabel="Clear" style={styles.iconBtn}><CloseIcon size={14} width={2.5} color="#94a3b8" /></Pressable> : null}
        <ImageSearchButton onPress={() => setImageSheetOpen(true)} size={32} />
        <Pressable onPress={openVoiceSearch} accessibilityLabel="Voice search" style={[styles.iconBtn, styles.mic]}><MicIcon size={18} width={2.2} color="#10b981" /></Pressable>
      </View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: bottom }}>
      {imageMode && <View style={styles.summary}>
        {imageAsset ? <Image source={{ uri: imageAsset.uri }} style={styles.summaryImg} contentFit="contain" accessibilityLabel="Image used for product search" /> : null}
        <Text>Similar product photos</Text>
        <Pressable onPress={() => applyTextSearch('')} style={[styles.smallBtn, { backgroundColor: theme.highlight }]}><Text style={{ color: theme.actionHover }}>Remove image</Text></Pressable>
      </View>}
      {searchError ? <Text accessibilityRole="alert" style={styles.error}>{searchError}{imageAsset ? ' ' : ''}{imageAsset ? <Text onPress={() => { if (!loading) runImageSearch(imageAsset, imageMeta.page).catch(() => {}); }} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>Retry image search</Text> : null}</Text> : null}
      {showingResults ? (loading ? <Text style={styles.empty}>Searching…</Text>
        : results.length === 0 ? <Text style={styles.empty}>{searchError ? 'Image search could not finish. Please try again.' : imageMode ? 'No similar product photos found. Try a clearer photo or search by name.' : `No results for "${term}"`}</Text>
          : <>{grid(results, true)}
            {imageMode && imageMeta.total > imageMeta.limit && <View style={styles.pagination}>
              <Pressable disabled={loading || imageMeta.page <= 1} onPress={() => runImageSearch(imageAsset, imageMeta.page - 1).catch(() => {})} style={[styles.smallBtn, { backgroundColor: theme.highlight, opacity: imageMeta.page <= 1 ? 0.5 : 1 }]}><Text>Previous</Text></Pressable>
              <Text>Page {imageMeta.page}</Text>
              <Pressable disabled={loading || imageMeta.page * imageMeta.limit >= imageMeta.total} onPress={() => runImageSearch(imageAsset, imageMeta.page + 1).catch(() => {})} style={[styles.smallBtn, { backgroundColor: theme.highlight, opacity: imageMeta.page * imageMeta.limit >= imageMeta.total ? 0.5 : 1 }]}><Text>Next</Text></Pressable>
            </View>}</>)
        : <>
          {recent.length > 0 && <View style={styles.section}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Recent Searches</Text>
              <Pressable onPress={() => setEditingRecent(v => !v)}><Text style={{ color: theme.primaryColor, fontSize: 12, fontWeight: '700' }}>{editingRecent ? 'Done' : 'Edit'}</Text></Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingTop: 4 }}>
              {recent.map(r => <Pressable key={r.label} style={styles.chip} onPress={() => !editingRecent && applyTextSearch(r.label)}>
                {editingRecent && <Pressable onPress={() => removeRecent(r.label)} accessibilityLabel={`Remove ${r.label}`} style={styles.chipRemove}><Text style={{ color: '#fff', fontSize: 9 }}>✕</Text></Pressable>}
                {r.image ? <Image source={{ uri: mediaUrl(typeof r.image === 'string' ? r.image : r.image?.url) }} style={styles.chipImg} contentFit="cover" /> : <View style={styles.chipImg} />}
                <Text numberOfLines={1} style={{ fontSize: 11, textAlign: 'center' }}>{r.label}</Text>
              </Pressable>)}
            </ScrollView>
          </View>}
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>Featured Products</Text>
            {defaultsLoading ? <Text style={[styles.empty, { paddingVertical: 10 }]}>Loading…</Text>
              : featured.length === 0 ? <Text style={[styles.empty, { paddingVertical: 10 }]}>Nothing featured yet.</Text>
                : grid(featured, false)}
          </View>
        </>}
    </ScrollView>
    <ImageSearchSheet open={imageSheetOpen} onClose={closeImageSheet} onSearch={runImageSearch} loading={loading && imageMode} maxBytes={imageMaxBytes} />
  </CustomerPage>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1 },
  inputWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingVertical: 4, paddingHorizontal: 8 },
  input: { flex: 1, minWidth: 0, fontSize: 13.5, paddingVertical: 6 },
  iconBtn: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  mic: { backgroundColor: 'rgba(16,185,129,0.1)', borderRadius: 22, width: 40, height: 40 },
  empty: { textAlign: 'center', fontSize: 12.5, color: '#94a3b8', paddingVertical: 32 },
  section: { marginBottom: 24 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  chip: { width: 68, alignItems: 'center', gap: 6 },
  chipImg: { width: 60, height: 60, borderRadius: 12, backgroundColor: '#f1f5f9' },
  chipRemove: { position: 'absolute', top: -4, right: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  card: { borderRadius: 14, padding: 8, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  cardImg: { width: '100%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#f1f5f9', marginBottom: 8 },
  cardName: { fontSize: 12.5, fontWeight: '600', lineHeight: 16, marginBottom: 2 },
  cardShop: { fontSize: 10.5, color: '#94a3b8', marginBottom: 4 },
  cardPrice: { fontSize: 13, fontWeight: '800' },
  summary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 },
  summaryImg: { width: 64, height: 64, borderWidth: 1, borderColor: '#dde8ef', borderRadius: 10 },
  smallBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  error: { color: '#b42318', backgroundColor: '#fff1ee', borderRadius: 8, padding: 10, marginBottom: 12, overflow: 'hidden' },
  pagination: { flexDirection: 'row', gap: 12, justifyContent: 'center', alignItems: 'center', padding: 18 },
});
