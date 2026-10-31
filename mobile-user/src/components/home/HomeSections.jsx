// Home feed sections — ports of modules/User/components/*Section.jsx, PopularCategories, QuickActions,
// TopProducts, StorefrontSections, CategoryArtwork and advertising/SponsoredCategoryBlock.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { useUser } from '../../context/UserContext';
import { useStorefront, useStorefrontNow, countdown } from '../../context/StorefrontContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { useProducts, normalizeProduct } from '../../hooks/useProducts';
import { useCategoryTree, useCategoryBranch, descendantIds } from '../../hooks/useCategoryTree';
import { useDeliveryOptions } from '../../hooks/useDeliveryOptions';
import { boundedFetch, mediaUrl, request } from '../../api/client';
import { captureUserSession, isCurrentUserSession } from '../../lib/session';
import { on } from '../../lib/events';
import { Text } from '../ui';
import { GridIcon, TicketIcon, BulkIcon } from '../icons';
import StorefrontMedia from '../storefront/StorefrontMedia';
import Celebration from '../Celebration';
import usePromotionNavigation from '../../hooks/usePromotionNavigation';
import { GridProductCard, CategoryProductCard, MerchandisingCard } from './ProductCards';
import WishlistHeartButton from '../WishlistHeartButton';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';

export const HOME_NEAR_END = 'home:near-end';

/** Renders `items` in rows of `columns` (CSS grid replacement for short lists). */
export function Grid({ items, columns = 2, gap = 10, renderItem, keyOf }) {
  const rows = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  return <View style={{ gap }}>
    {rows.map((row, r) => <View key={r} style={{ flexDirection: 'row', gap }}>
      {row.map((item, i) => <View key={keyOf ? keyOf(item) : i} style={{ flex: 1 }}>{renderItem(item)}</View>)}
      {Array.from({ length: columns - row.length }, (_, i) => <View key={`pad${i}`} style={{ flex: 1 }} />)}
    </View>)}
  </View>;
}

/** Long grids grow by 24 items as the home feed nears its end. */
function useProgressive(total, step = 24) {
  const [count, setCount] = useState(step);
  useEffect(() => { setCount(step); }, [total, step]);
  useEffect(() => on(HOME_NEAR_END, () => setCount(c => (c < total ? c + step : c))), [total, step]);
  return Math.min(count, total);
}

export function CategoryArtwork({ category, fit = 'contain', radius = 8 }) {
  const { theme } = useStorefront();
  const appTheme = useAppTheme();
  const [failed, setFailed] = useState('');
  const tile = theme?.categoryTiles?.find(item => item.categoryId === String(category._id || category.id));
  const image = category.image || category.icon;
  return <View style={StyleSheet.absoluteFill}>
    {tile ? <StorefrontMedia banner={tile.banner} active={false} />
      : image && failed !== image ? <Image source={{ uri: mediaUrl(image) }} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} contentFit={fit} onError={() => setFailed(image)} accessibilityLabel={category.name} />
        : <View style={[StyleSheet.absoluteFill, styles.fallbackArt, { borderRadius: radius, backgroundColor: appTheme.primaryLight }]}><Text style={{ color: appTheme.brandPrimaryDark, fontWeight: '700' }}>{category.name?.slice(0, 1) || '◆'}</Text></View>}
    {tile?.badge ? <Text style={[styles.tileBadge, { backgroundColor: appTheme.badge, color: appTheme.badgeText }]}>{tile.badge}</Text> : null}
  </View>;
}

function InlineState({ message, onRetry }) {
  const theme = useAppTheme();
  return <View style={[styles.inlineState, { borderColor: theme.borderColor, backgroundColor: theme.pageBackground }]} accessibilityRole={onRetry ? 'alert' : undefined}>
    <Text style={{ fontSize: 12, color: theme.muted, textAlign: 'center' }}>{message}</Text>
    {onRetry && <Pressable onPress={onRetry} style={[styles.inlineRetry, { backgroundColor: theme.primaryLight, borderColor: theme.borderColor }]}><Text style={{ fontWeight: '800', color: theme.brandPrimaryDark, fontSize: 12 }}>Retry</Text></Pressable>}
  </View>;
}

function SectionHeader({ title, onViewAll, action = 'View All' }) {
  const theme = useAppTheme();
  return <View style={styles.sectionHeader}>
    <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
    {onViewAll && <Pressable onPress={onViewAll} hitSlop={6}><Text style={{ color: theme.primaryColor, fontWeight: '700', fontSize: 13 }}>{action}</Text></Pressable>}
  </View>;
}

/** VegetablesSection / MilkSection / MensWearSection / WomenWearSection / ChildWearSection. */
export function CategoryGridSection({ channel, slug, title, delivery = false, showErrors = false }) {
  const { getDeliveryPoint, setSelectedCategoryFilter } = useUser();
  const { node, categoryParam, loading: categoryLoading, error: categoryError, retry: retryCategories, exists } = useCategoryBranch(channel, slug);
  const { products, loading, error, retry } = useProducts({ type: channel, category: categoryParam, limit: 6, enabled: exists });
  const { options } = useDeliveryOptions(delivery ? products.map(p => p.id) : [], delivery ? getDeliveryPoint() : null);
  if (showErrors) { if (!categoryLoading && !categoryError && (!node || (!loading && products.length === 0))) return null; }
  else if (!categoryLoading && !categoryError && (!node || (!loading && products.length === 0))) return null;
  if (!showErrors && categoryError) return null;
  return <View style={styles.landingSection}>
    <SectionHeader title={title} onViewAll={() => setSelectedCategoryFilter(node)} />
    {showErrors && (categoryError || error) ? <InlineState message={categoryError ? 'Category information is unavailable.' : 'Products could not be loaded.'} onRetry={categoryError ? retryCategories : retry} />
      : <Grid items={products} keyOf={p => p.id} renderItem={product => <GridProductCard product={product} verdict={delivery ? options[product.id]?.sameDay : undefined} />} />}
  </View>;
}

export const VegetablesSection = () => <CategoryGridSection channel="grocery" slug="grocery--fruits-and-vegetables" title="Fresh" showErrors />;
export const MilkSection = () => <CategoryGridSection channel="grocery" slug="grocery--dairy-and-bakery--dairy--milk" title="Milk & Dairy" showErrors />;
export const MensWearSection = () => <CategoryGridSection channel="ecommerce" slug="ecommerce--clothing-and-handlooms--mens-wear" title="Men's Wear" delivery />;
export const WomenWearSection = () => <CategoryGridSection channel="ecommerce" slug="ecommerce--clothing-and-handlooms--womens-wear" title="Women's Wear" delivery />;
export const ChildWearSection = () => <CategoryGridSection channel="ecommerce" slug="ecommerce--clothing-and-handlooms--kids-wear" title="Kids' Wear" delivery />;

function CategoryCard({ item, children, style, onPress }) {
  return <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={item.name}>{children}</Pressable>;
}

const GroceryBagGraphic = () => <View style={{ width: 95, height: 85, alignItems: 'center', justifyContent: 'flex-end' }}>
  <View style={{ position: 'absolute', top: 2, left: 12, width: 22, height: 26, backgroundColor: '#16a34a', borderTopLeftRadius: 11, borderTopRightRadius: 11, borderBottomLeftRadius: 11, transform: [{ rotate: '-25deg' }] }} />
  <View style={{ position: 'absolute', top: 0, left: 32, width: 20, height: 28, backgroundColor: '#22c55e', borderTopLeftRadius: 10, borderTopRightRadius: 10, borderBottomRightRadius: 10, transform: [{ rotate: '15deg' }] }} />
  <View style={{ position: 'absolute', top: 8, right: 14, width: 22, height: 38, backgroundColor: '#818cf8', borderRadius: 4, alignItems: 'center', justifyContent: 'center', zIndex: 2 }}><View style={{ width: 10, height: 16, backgroundColor: '#fff', borderRadius: 2 }} /></View>
  <View style={{ width: 75, height: 52, backgroundColor: '#f59e0b', borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, borderTopWidth: 4, borderTopColor: '#d97706', zIndex: 3, elevation: 3 }} />
</View>;

export function GroceriesSection() {
  const theme = useAppTheme();
  const { setSelectedCategoryFilter } = useUser();
  const { tree, loading, error, retry } = useCategoryTree('grocery');
  const flatten = nodes => (nodes || []).flatMap(category => [category, ...flatten(category.children)]);
  const promoted = flatten(tree).filter(category => !category.isSystem && category.showOnHome);
  const roots = tree.flatMap(category => (category.isSystem ? category.children || [] : [category]));
  const categories = (promoted.length ? promoted : roots).slice(0, 4);
  return <View style={[styles.featurePanel, { backgroundColor: theme.promotion }]}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20, paddingBottom: 16 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 21, fontWeight: '900', color: theme.text, letterSpacing: 0.3 }}>GROCERIES AT DOORSTEP</Text>
        <Text style={{ marginTop: 2, fontSize: 13, color: theme.promotionText, fontWeight: '600' }}>Shop now and save more!</Text>
      </View>
      <GroceryBagGraphic />
    </View>
    <View style={{ marginBottom: 28 }}>
      {loading ? <Text style={styles.loadingText}>Loading categories...</Text>
        : error ? <Text accessibilityRole="alert">Categories unavailable. <Text onPress={retry} style={{ textDecorationLine: 'underline' }}>Retry</Text></Text>
          : <Grid items={categories} columns={4} keyOf={c => c._id || c.id} renderItem={item => <CategoryCard item={item} onPress={() => setSelectedCategoryFilter(item)} style={[styles.groceryCard, { borderColor: theme.categoryFrame }]}>
            <Text style={{ fontSize: 10, fontWeight: '800', color: theme.text, textAlign: 'center', minHeight: 28, lineHeight: 12 }}>{item.name}</Text>
            <View style={{ width: '100%', height: 90, marginTop: 4 }}><CategoryArtwork category={item} /></View>
          </CategoryCard>} />}
    </View>
    <VegetablesSection />
    <View style={{ marginTop: 20 }}><MilkSection /></View>
  </View>;
}

function useHomeCategories({ fashion = false } = {}) {
  const [state, setState] = useState({ loading: true, basics: [], stories: [], list: [] });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const home = await request('/api/categories?showOnHome=true&type=ecommerce', { auth: false });
        const homeList = Array.isArray(home.body) ? home.body : [];
        const needTree = fashion || homeList.length === 0;
        const treeRes = needTree ? await request('/api/categories/tree?type=ecommerce', { auth: false }) : { body: [] };
        const tree = Array.isArray(treeRes.body) ? treeRes.body : [];
        if (fashion) {
          const header = tree.find(l1 => l1.slug?.includes('clothing') || l1.slug?.includes('fashion') || l1.name?.toLowerCase().includes('clothing') || l1.name?.toLowerCase().includes('fashion'));
          const stories = header ? header.children || [] : tree.flatMap(l1 => l1.children || []).slice(0, 3);
          const basics = header ? (header.children || []).flatMap(l2 => l2.children || []) : tree.flatMap(l1 => (l1.children || []).flatMap(l2 => l2.children || [])).slice(0, 6);
          if (!cancelled) setState({ loading: false, basics: homeList.length > 0 ? homeList.slice(0, 6) : basics.slice(0, 6), stories: stories.slice(0, 3), list: [] });
        } else {
          let list = homeList;
          if (list.length === 0) {
            const header = tree.find(l1 => l1.slug?.includes('solar') || l1.slug?.includes('appliance') || l1.name?.toLowerCase().includes('solar'));
            list = header?.children ? header.children.slice(0, 8) : tree.flatMap(l1 => l1.children || []).slice(0, 8);
          }
          if (!cancelled) setState({ loading: false, basics: [], stories: [], list });
        }
      } catch { if (!cancelled) setState(previous => ({ ...previous, loading: false })); }
    })();
    return () => { cancelled = true; };
  }, [fashion]);
  return state;
}

const Pedestal = ({ children, base }) => <View style={{ alignItems: 'center' }}>
  <View style={styles.pedestalIcon}>{children}</View>
  <View style={{ width: 30, height: 12, borderRadius: 15, backgroundColor: base, marginTop: 2 }} />
</View>;

export function ElectronicsSection() {
  const theme = useAppTheme();
  const { setSelectedCategoryFilter, getDeliveryPoint } = useUser();
  const { products } = useProducts({ type: 'ecommerce', limit: 6 });
  const { options } = useDeliveryOptions(products.map(p => p.id), getDeliveryPoint());
  const { loading, list: categories } = useHomeCategories();
  const stroke = theme.action;
  return <View style={[styles.featurePanel, { backgroundColor: theme.highlight }]}>
    <View style={styles.electronicsHero}>
      <View style={{ position: 'absolute', left: 8, bottom: 6, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        <Pedestal base={theme.categorySurface}><Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2.5}><Rect x="6" y="3" width="12" height="18" rx="6" /><Line x1="12" y1="7" x2="12" y2="11" /></Svg></Pedestal>
        <Pedestal base={theme.categoryFrame}><Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2.5}><Rect x="2" y="6" width="20" height="12" rx="2" /><Line x1="8" y1="14" x2="16" y2="14" /></Svg></Pedestal>
      </View>
      <Text style={{ fontSize: 19, fontWeight: '900', color: '#4c1d95', letterSpacing: 0.5, textAlign: 'center', paddingHorizontal: 60 }}>ELECTRONICS AT FINGER TIPS</Text>
      <View style={{ position: 'absolute', right: 8, bottom: 6, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
        <Pedestal base={theme.categorySurface}><Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2.5}><Line x1="6" y1="12" x2="10" y2="12" /><Line x1="8" y1="10" x2="8" y2="14" /><Circle cx="15" cy="13" r="1" /><Circle cx="18" cy="11" r="1" /><Rect x="2" y="6" width="20" height="12" rx="6" /></Svg></Pedestal>
        <Pedestal base={theme.categoryFrame}><Svg width={18} height={20} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={2.5}><Rect x="5" y="2" width="14" height="20" rx="2" /><Line x1="12" y1="18" x2="12.01" y2="18" /></Svg></Pedestal>
      </View>
    </View>
    <View style={{ marginBottom: 32 }}>
      {loading ? <Text style={styles.loadingText}>Loading categories...</Text>
        : <Grid items={categories} columns={4} keyOf={c => c._id || c.id} renderItem={item => <CategoryCard item={item} onPress={() => setSelectedCategoryFilter(item)} style={[styles.electronicsCard, { borderColor: theme.categoryFrame }]}>
          <Text style={{ fontSize: 11, fontWeight: '900', color: '#4c1d95', textAlign: 'center', minHeight: 26, lineHeight: 12 }}>{item.name}</Text>
          <View style={{ width: '100%', height: 75, marginVertical: 4 }}><CategoryArtwork category={item} /></View>
          <Text style={{ fontSize: 9, fontWeight: '800', color: theme.text, backgroundColor: theme.categorySurface, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.categoryFrame, overflow: 'hidden' }}>Explore collection</Text>
        </CategoryCard>} />}
    </View>
    <Text style={{ marginBottom: 16, fontSize: 18, fontWeight: '900', color: '#3b0764' }}>Best of Gadgets</Text>
    <Grid items={products} keyOf={p => p.id} renderItem={product => <GridProductCard product={product} verdict={options[product.id]?.sameDay} style={{ borderRadius: 18, padding: 12, borderColor: theme.categorySurface }} />} />
  </View>;
}

export function FashionSection() {
  const theme = useAppTheme();
  const { setSelectedCategoryFilter } = useUser();
  const { loading, basics, stories } = useHomeCategories({ fashion: true });
  return <View style={[styles.featurePanel, { backgroundColor: theme.highlight }]}>
    <View style={{ paddingTop: 24, paddingBottom: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: theme.primary }}>Everyday Basics</Text>
      <Text style={{ marginTop: 2, fontSize: 13, color: theme.muted, fontWeight: '600' }}>Comfort you can count on!</Text>
    </View>
    <View style={{ marginBottom: 28 }}>
      {loading ? <Text style={styles.loadingText}>Loading categories...</Text>
        : <Grid items={basics} columns={3} gap={12} keyOf={c => c._id || c.id} renderItem={item => <CategoryCard item={item} onPress={() => setSelectedCategoryFilter(item)} style={[styles.fashionCard, { borderColor: theme.primaryColor }]}>
          <View style={{ paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.primaryLight, width: '100%' }}><Text style={{ fontSize: 11, fontWeight: '800', color: theme.primaryColor, textAlign: 'center' }}>{item.name}</Text></View>
          <View style={{ width: '100%', height: 120 }}><CategoryArtwork category={item} /></View>
        </CategoryCard>} />}
    </View>
    <View style={{ paddingVertical: 16, borderTopWidth: 1.5, borderStyle: 'dashed', borderTopColor: theme.categoryFrame }}>
      <Text style={{ fontSize: 22, fontWeight: '900', color: theme.text }}>Style for Every Story</Text>
      <Text style={{ marginTop: 2, fontSize: 13, color: '#475569', fontWeight: '600' }}>Fresh looks for him, her & the little ones</Text>
    </View>
    {loading ? <Text style={styles.loadingText}>Loading categories...</Text>
      : <Grid items={stories} columns={3} gap={12} keyOf={c => c._id || c.id} renderItem={item => <CategoryCard item={item} onPress={() => setSelectedCategoryFilter(item)} style={[styles.fashionCard, { borderRadius: 20, borderColor: theme.categoryFrame }]}>
        <View style={{ paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1.5, borderBottomColor: theme.categoryFrame, width: '100%' }}><Text style={{ fontSize: 11, fontWeight: '800', color: theme.text, textAlign: 'center' }}>{item.name}</Text></View>
        <View style={{ width: '100%', height: 150 }}><CategoryArtwork category={item} /></View>
        <View style={{ width: '100%', backgroundColor: theme.action, paddingVertical: 6, paddingHorizontal: 4 }}><Text style={{ fontSize: 10, fontWeight: '800', color: theme.actionText, textAlign: 'center' }}>EXPLORE COLLECTION</Text></View>
      </CategoryCard>} />}
  </View>;
}

export function CouponsSection() {
  const theme = useAppTheme();
  const now = useStorefrontNow();
  const { activeMode, currentUser, setActiveNav } = useUser();
  const [coupons, setCoupons] = useState([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false; const controller = new AbortController(); const snapshot = captureUserSession();
    setCoupons([]); setError('');
    if (!currentUser || !snapshot.token) return undefined;
    const load = async () => {
      if (AppState.currentState !== 'active') return;
      setLoading(true);
      try {
        const response = await boundedFetch(`/api/coupons/available?channel=${activeMode === 'quick' ? 'grocery' : 'ecommerce'}`, { signal: controller.signal, headers: { Authorization: `Bearer ${snapshot.token}` } });
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.data)) throw new Error('Offers could not be loaded. Please retry.');
        if (!cancelled && isCurrentUserSession(snapshot)) { setCoupons(body.data); setError(''); }
      } catch (err) { if (!cancelled && err?.name !== 'AbortError') { setCoupons([]); setError(err.message); } }
      finally { if (!cancelled) setLoading(false); }
    };
    load(); const timer = setInterval(load, 30000);
    return () => { cancelled = true; controller.abort(); clearInterval(timer); };
  }, [activeMode, currentUser?._id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = coupons.filter(c => c.isPublic !== false && (!c.expiresAt || Date.parse(c.expiresAt) > now));
  return <View style={styles.sfSection}>
    <View style={styles.sfHeading}><View style={{ flex: 1 }}><Text style={[styles.eyebrow, { color: theme.muted }]}>OFFERS FOR YOUR BASKET</Text><Text style={[styles.sfTitle, { color: theme.text }]}>Coupons & savings</Text></View></View>
    {!currentUser ? <View style={{ gap: 10 }}><Text style={{ fontSize: 14 }}>Sign in to see available coupons.</Text><CtaButton title="Sign in" onPress={() => setActiveNav('account')} /></View>
      : error ? <Text accessibilityRole="alert">{error} <Text onPress={() => setAttempt(v => v + 1)} style={{ textDecorationLine: 'underline', fontWeight: '700' }}>Retry</Text></Text>
        : loading && !visible.length ? <Text>Checking available offers…</Text>
          : !visible.length ? <Text>No published coupons are available for this storefront right now.</Text>
            : visible.map(c => <View key={c.code} style={[styles.coupon, { backgroundColor: theme.surface, borderColor: theme.primary, borderRadius: theme.radius }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontWeight: '700' }}>{c.title || c.code}</Text>
                {c.description ? <Text style={[styles.couponText, { color: theme.muted }]}>{c.description}</Text> : null}
                <Text style={[styles.couponText, { color: theme.muted }]}>{c.applicable ? (c.freeShipping ? 'Delivery offer is eligible for your current basket.' : `Current basket saving: ₹${c.savingNow}`) : c.reason}</Text>
                {c.expiresAt ? <Text style={[styles.couponText, { color: theme.muted }]}>Valid until {new Date(c.expiresAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</Text> : null}
              </View>
              <View style={{ minWidth: 90 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 8 }}>{c.code}</Text>
                <Pressable onPress={async () => { try { await Clipboard.setStringAsync(c.code); setMessage(`${c.code} copied`); } catch { setMessage(`Use code ${c.code} at checkout`); } }}
                  style={[styles.copyBtn, { backgroundColor: theme.action, borderRadius: theme.buttonRadius }]}><Text style={{ color: theme.actionText, fontWeight: '700', fontSize: 12.5 }}>Copy code</Text></Pressable>
              </View>
            </View>)}
    {message ? <Text accessibilityLiveRegion="polite" style={{ marginTop: 6 }}>{message}</Text> : null}
    {!!visible.length && <Text style={{ marginTop: 8 }}>Eligibility and savings are checked again at checkout. <Text onPress={() => setActiveNav('cart')} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>Open cart →</Text></Text>}
  </View>;
}

function CtaButton({ title, onPress, style, highlight }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" style={[{ minHeight: 44, paddingHorizontal: 20, paddingVertical: 12, borderRadius: theme.buttonRadius, backgroundColor: highlight ? theme.highlight : theme.action, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' }, style]}>
    <Text style={{ color: highlight ? theme.highlightText : theme.actionText, fontSize: 13, fontWeight: '700' }}>{title}</Text>
  </Pressable>;
}
export { CtaButton };

// ---- Sponsored products (advertising placements) ----
function sendAdEvent(token, type) {
  if (!token) return;
  boundedFetch('/api/advertising/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, type }) }, 2000).catch(() => {});
}
export function uniqueSponsoredProducts(rows, skipIds = []) {
  const seen = new Set(skipIds.map(String)), result = [];
  for (const row of rows || []) {
    const id = row.product?._id;
    if (!id || seen.has(String(id)) || !['NON_BILLABLE_PILOT', 'PAID_CATEGORY'].includes(row.mode) || row.disclosure !== 'Sponsored') continue;
    seen.add(String(id)); result.push(row);
  }
  return result.slice(0, 4);
}

function SponsoredProductCard({ product, variantId, pilot, onOpen, width }) {
  const theme = useAppTheme();
  const { addToCart, setActiveNav } = useUser();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const available = product.fulfillmentType === 'digital' || product.stock > 0;
  const choose = product.variants.length > 1;
  const discount = Number(product.mrp) > Number(product.price) ? Math.floor((product.mrp - product.price) / product.mrp * 100) : 0;
  const inr = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  const add = async () => {
    if (busy) return;
    if (choose) { onOpen(); return; }
    setBusy(true); setMessage('');
    try {
      const result = await addToCart(product, 1, variantId || undefined);
      if (result?.ok) setMessage('Added to cart');
      else if (/sign in/i.test(result?.message || '')) setActiveNav('account');
      else if (result?.message) setMessage(result.message);
    } catch { setMessage('Could not add item. Try again.'); } finally { setBusy(false); }
  };
  return <Pressable onPress={onOpen} style={[styles.sponsoredCard, { width, backgroundColor: theme.surface, borderColor: theme.productBorder }]} accessibilityRole="button" accessibilityLabel={`Sponsored: ${product.name}`}>
    <View style={styles.sponsoredMedia}>
      {product.image && !failed ? <Image source={{ uri: mediaUrl(product.image) }} style={{ width: '86%', height: '86%' }} contentFit="contain" onError={() => setFailed(true)} /> : <Text style={{ fontSize: 11, color: theme.muted }}>Image unavailable</Text>}
      <Text style={styles.sponsoredTag}>Sponsored</Text>
      <WishlistHeartButton productId={product.id} size={16} style={{ position: 'absolute', right: 6, top: 6 }} />
    </View>
    <View style={{ padding: 10, paddingBottom: 12, gap: 4, flex: 1 }}>
      <Text numberOfLines={2} style={{ fontSize: 13, fontWeight: '600', lineHeight: 17, minHeight: 35, color: theme.text }}>{product.name}</Text>
      {product.sellerName ? <Text numberOfLines={1} style={{ fontSize: 11, color: theme.muted }}>{product.sellerName}</Text> : null}
      {pilot ? <Text style={{ fontSize: 10, color: theme.muted }}>Non-billable pilot</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, marginTop: 'auto', paddingTop: 4 }}>
        <Text style={{ fontSize: 16, fontWeight: '800', color: theme.text }}>{inr(product.price)}</Text>
        {discount > 0 && <><Text style={{ fontSize: 11, color: theme.muted, textDecorationLine: 'line-through' }}>{inr(product.mrp)}</Text><Text style={{ fontSize: 10.5, fontWeight: '700', color: '#15803d' }}>{discount}% off</Text></>}
      </View>
      <Pressable disabled={!available || busy} onPress={add} style={[{ marginTop: 6, minHeight: 38, borderRadius: theme.buttonRadius, backgroundColor: theme.action, alignItems: 'center', justifyContent: 'center' }, (!available || busy) && { opacity: 0.6 }]}>
        <Text style={{ color: theme.actionText, fontSize: 12.5, fontWeight: '700' }}>{!available ? 'Out of stock' : busy ? 'Adding…' : choose ? 'Choose options' : 'Add to cart'}</Text>
      </Pressable>
      {message ? <Text style={{ fontSize: 11, color: theme.muted }}>{message}</Text> : null}
    </View>
  </Pressable>;
}

export function SponsoredCategoryBlock({ channel, categoryId, ready = true, onShown }) {
  const theme = useAppTheme();
  const { getDeliveryPoint, setSelectedProduct } = useUser();
  const point = getDeliveryPoint?.();
  const lat = point?.lat, lng = point?.lng;
  const context = `${channel}:${categoryId}:${lat}:${lng}`;
  const [result, setResult] = useState(null), [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ready || !categoryId || !['ecommerce', 'grocery'].includes(channel)) return undefined;
    let alive = true;
    setResult(null);
    const controller = new AbortController();
    const query = new URLSearchParams({ type: channel, category: categoryId });
    if (Number.isFinite(lat) && Number.isFinite(lng)) { query.set('lat', String(lat)); query.set('lng', String(lng)); }
    boundedFetch(`/api/advertising/placements?${query}`, { signal: controller.signal }, 4000).then(async response => {
      const body = await response.json();
      if (alive && response.ok && ['NON_BILLABLE_PILOT', 'SPONSORED_CATEGORY'].includes(body.meta?.mode)) setResult({ context, rows: uniqueSponsoredProducts(body.data) });
    }).catch(() => {});
    const timer = setTimeout(() => { if (alive) { setResult(null); setTick(n => n + 1); } }, 30000);
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [context, ready, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!result?.rows.length) return undefined;
    const expiry = Math.min(...result.rows.map(row => new Date(row.expiresAt).getTime()));
    if (!Number.isFinite(expiry)) { setResult(null); return undefined; }
    const timer = setTimeout(() => setResult(null), Math.max(1, Math.min(2147483647, expiry - Date.now())));
    return () => clearTimeout(timer);
  }, [result]);
  const rows = ready && result?.context === context ? result.rows : [];
  const shownKey = rows.map(row => String(row.product._id)).join(',');
  useEffect(() => { onShown?.(shownKey ? shownKey.split(',') : []); }, [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Impressions: ≥50% of a card visible for 1 s, once per card (web observeAdImpressions).
  const sent = useRef(new Set());
  useEffect(() => { sent.current = new Set(); }, [shownKey]);
  const viewability = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 1000 }).current;
  const onViewable = useRef(({ viewableItems }) => {
    if (AppState.currentState !== 'active') return;
    for (const item of viewableItems) {
      const token = item.item?.serveToken;
      if (token && !sent.current.has(token)) { sent.current.add(token); sendAdEvent(token, 'IMPRESSION'); }
    }
  }).current;
  if (!rows.length) return null;
  return <View style={{ marginTop: 12, marginBottom: 20 }}>
    <View style={{ marginBottom: 12, paddingHorizontal: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: theme.header }}>Sponsored for you</Text>
        <Text style={[styles.adPill, { borderColor: theme.productBorder, color: theme.muted }]}>Ad</Text>
      </View>
      <Text style={{ marginTop: 2, fontSize: 12, color: theme.muted }}>{rows.every(r => r.mode === 'NON_BILLABLE_PILOT') ? 'Non-billable pilot' : 'Promoted products in this category'}</Text>
    </View>
    <FlatList horizontal data={rows} keyExtractor={row => String(row.product._id)} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 2, paddingBottom: 10 }}
      viewabilityConfig={viewability} onViewableItemsChanged={onViewable}
      renderItem={({ item: row }) => {
        const product = normalizeProduct(row.product);
        product.variants.sort((a, b) => Number(b.id === row.variantId) - Number(a.id === row.variantId));
        return <SponsoredProductCard product={product} variantId={row.variantId} pilot={row.mode === 'NON_BILLABLE_PILOT'} width={210}
          onOpen={() => { sendAdEvent(row.serveToken, 'CLICK'); setSelectedProduct(product); }} />;
      }} />
  </View>;
}

export function DynamicCategorySection({ channel, slug }) {
  const theme = useAppTheme();
  const { addToCart, setSelectedProduct } = useUser();
  const { node: category, categoryParam, loading: categoryLoading, error: categoryError, retry: retryCategories, exists } = useCategoryBranch(channel, slug);
  const { products, loading, error: productsError, retry: retryProducts } = useProducts({ type: channel, category: categoryParam, limit: 200, enabled: exists });
  const [expanded, setExpanded] = useState({});
  const [sponsoredIds, setSponsoredIds] = useState([]);
  const listed = useMemo(() => products.filter(p => !sponsoredIds.includes(String(p.id || p._id))), [products, sponsoredIds]);
  const level2 = useMemo(() => category?.children || [], [category]);
  const isHeader = level2.length > 0;
  const grouped = useMemo(() => {
    if (!isHeader || listed.length === 0) return [];
    const claimed = new Set();
    const sections = level2.map(l2 => {
      const ids = new Set(descendantIds(l2).map(String));
      const sectionProducts = listed.filter(p => ids.has(String(p.categoryId)));
      sectionProducts.forEach(p => claimed.add(p.id || p._id));
      return { category: l2, products: sectionProducts };
    }).filter(section => section.products.length > 0);
    const unclaimed = listed.filter(p => !claimed.has(p.id || p._id));
    if (unclaimed.length > 0) sections.push({ category, products: unclaimed });
    return sections;
  }, [isHeader, level2, listed, category]);
  const visibleFlat = useProgressive(listed.length);
  const open = product => setSelectedProduct(product);
  const add = product => { addToCart(product).catch(() => {}); };
  const grid = items => <Grid items={items} columns={2} keyOf={p => p.id || p._id} renderItem={p => <CategoryProductCard product={p} onOpen={open} onAdd={add} />} />;
  if (categoryLoading) return <Text style={styles.centerMuted}>Loading category info...</Text>;
  if (categoryError) return <LoadState title="Categories could not be loaded." detail={categoryError} onRetry={retryCategories} />;
  if (!category) return <LoadState title="This category is unavailable." detail="Please choose another category from the menu." />;
  return <View style={{ paddingHorizontal: 12, paddingBottom: 20 }}>
    <SponsoredCategoryBlock channel={channel} categoryId={category._id} ready={!loading} onShown={setSponsoredIds} />
    {loading ? <Text style={styles.centerMuted}>Loading products...</Text>
      : productsError ? <LoadState title="Products could not be loaded." detail={productsError} onRetry={retryProducts} />
        : products.length === 0 ? <View style={styles.emptyDashed}><Text style={{ color: '#94a3b8', fontSize: 13 }}>No products listed here yet.</Text></View>
          : isHeader ? <View style={{ gap: 16 }}>{grouped.map(section => {
            const id = section.category._id || section.category.id;
            const isExpanded = Boolean(expanded[id]);
            const hasMore = section.products.length > 6;
            return <View key={id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 10 }}>
                <Text style={{ fontFamily: 'Outfit', fontSize: 15, fontWeight: '800', color: '#0f172a' }}>{section.category.name}</Text>
                {hasMore && <Pressable onPress={() => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))} hitSlop={6}><Text style={{ color: theme.primaryColor, fontWeight: '700', fontSize: 12 }}>{isExpanded ? 'Show Less' : `View All (${section.products.length})`}</Text></Pressable>}
              </View>
              {grid(isExpanded ? section.products : section.products.slice(0, 6))}
            </View>;
          })}</View>
            : <View style={{ marginTop: 16 }}>{grid(listed.slice(0, visibleFlat))}</View>}
  </View>;
}

export function LoadState({ title, detail, onRetry }) {
  const theme = useAppTheme();
  return <View style={[styles.loadState, { backgroundColor: theme.surface, borderColor: theme.borderColor }]} accessibilityRole={onRetry ? 'alert' : undefined}>
    <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>{title}</Text>
    {detail ? <Text style={{ fontSize: 13, color: theme.muted, textAlign: 'center' }}>{detail}</Text> : null}
    {onRetry && <Pressable onPress={onRetry} style={[styles.loadRetry, { backgroundColor: theme.brandPrimaryDark }]}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>Try again</Text></Pressable>}
  </View>;
}

// ---- Storefront Studio sections ----
function Rail({ products, renderCard, layout }) {
  const width = 170;
  if (layout === 'grid') return <Grid items={products} keyOf={p => p.id || p._id} renderItem={renderCard} />;
  return <FlatList horizontal data={products} keyExtractor={p => String(p.id || p._id)} showsHorizontalScrollIndicator={false}
    contentContainerStyle={{ gap: 10, paddingHorizontal: 2, paddingBottom: 14 }} renderItem={({ item }) => <View style={{ width }}>{renderCard(item)}</View>} />;
}

export function StorefrontSection({ section }) {
  const theme = useAppTheme();
  const now = useStorefrontNow();
  const { activeMode, setActiveNav } = useUser();
  const c = section.config, type = activeMode === 'quick' ? 'grocery' : 'ecommerce';
  const navigate = usePromotionNavigation();
  const remote = ['campaign', 'wholesale'].includes(c.source);
  const regular = useProducts({ type, category: c.source === 'category' ? c.categoryId : undefined, featured: c.source === 'featured', maxPrice: c.source === 'price' ? c.maxPrice : undefined, limit: c.limit, enabled: !remote });
  const [deal, setDeal] = useState({ products: [], loading: true, error: '' }), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!remote) return undefined;
    let cancelled = false; const controller = new AbortController();
    setDeal({ products: [], loading: true, error: '' });
    const path = c.source === 'wholesale' ? `/api/products/wholesale/catalog?limit=${c.limit}` : `/api/campaigns/${c.campaignId}/products?type=${type}`;
    boundedFetch(path, { signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error('Deals unavailable');
      const products = c.source === 'wholesale' ? body.data : (body.data?.products || []).filter(p => p.type === type);
      if (!Array.isArray(products)) throw new Error('Invalid collection response');
      if (!cancelled) setDeal({ products: products.slice(0, c.limit), loading: false, error: '' });
    }).catch(() => { if (!cancelled) setDeal({ products: [], loading: false, error: 'Deals could not be loaded' }); });
    return () => { cancelled = true; controller.abort(); };
  }, [c.source, c.campaignId, c.limit, type, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  if (section.endAt && Date.parse(section.endAt) <= now) return null;
  const result = remote ? deal : regular;
  if (!result.loading && !result.error && !result.products.length) return null;
  const soft = c.variant === 'soft' || c.variant === 'accent';
  const sourceBg = c.source === 'category' ? (c.appearance?.background || theme.promotion) : ['campaign', 'price'].includes(c.source) ? (c.appearance?.background || theme.highlight) : soft ? (c.appearance?.background || theme.highlight) : c.appearance?.background;
  const textColor = c.source === 'category' ? (c.appearance?.text || theme.promotionText) : (c.appearance?.text || theme.text);
  const padded = Boolean(sourceBg);
  return <View style={[styles.sfSection, padded && { paddingVertical: 18, paddingHorizontal: 12 }, { backgroundColor: sourceBg || 'transparent', borderRadius: theme.radius },
    ['campaign', 'price'].includes(c.source) && { borderTopWidth: 4, borderTopColor: c.appearance?.accent || theme.accent },
    soft && { borderWidth: 1, borderColor: c.appearance?.accent || theme.accent }]}>
    {section.banner && <View style={{ marginBottom: 20 }}>
      <View style={{ width: '100%', height: 200, borderRadius: theme.radius, overflow: 'hidden' }}><StorefrontMedia banner={section.banner} /><Celebration effect={section.banner.animation} /></View>
      {section.banner.destination.type !== 'NONE' && <CtaButton title={`${section.banner.cta || 'Explore collection'} →`} onPress={() => navigate(section.banner.destination)} style={{ marginTop: 8 }} />}
    </View>}
    <View style={styles.sfHeading}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.eyebrow, { color: textColor }]}>{c.source === 'campaign' ? 'LIMITED-TIME DEALS' : c.source === 'wholesale' ? 'FOR YOUR BUSINESS' : 'CURATED FOR YOU'}</Text>
        <Text style={[styles.sfTitle, { color: textColor }]}>{c.title}</Text>
      </View>
      {c.source === 'campaign' && section.endAt ? <Text style={[styles.countdownPill, { backgroundColor: theme.highlight, color: theme.highlightText, borderColor: theme.accent }]} accessibilityLabel="Time remaining">{countdown(section.endAt, now)}</Text> : null}
      {c.source === 'wholesale' && <Pressable onPress={() => setActiveNav('wholesale')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: textColor, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' }}>View all →</Text></Pressable>}
    </View>
    {result.loading ? <View style={[styles.productSkeleton, { backgroundColor: theme.surface, borderRadius: theme.radius }]}><Text style={{ color: theme.muted }}>Loading products…</Text></View>
      : result.error ? <Text accessibilityRole="alert">{result.error} <Text onPress={() => (remote ? setRetry(r => r + 1) : regular.retry())} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>Retry</Text></Text>
        : <Rail layout={c.layout} products={result.products} renderCard={p => <MerchandisingCard product={p} deal={c.source === 'campaign'} wholesale={c.source === 'wholesale'} />} />}
  </View>;
}

export function StorefrontSections() {
  const { sections } = useStorefront();
  return sections.map(section => <StorefrontSection key={`${section.id}:${section.revision}`} section={section} />);
}

export function StorefrontAnnouncement() {
  const { announcement } = useStorefront();
  const theme = useAppTheme();
  const navigate = usePromotionNavigation();
  if (!announcement) return null;
  return <View style={[styles.announcement, { backgroundColor: theme.primary }]}>
    <Text style={{ color: '#fff', fontSize: 11, flexShrink: 1 }}>{announcement.banner.title}</Text>
    {announcement.banner.destination.type !== 'NONE' && <Pressable onPress={() => navigate(announcement.banner.destination)} style={{ minHeight: 36, justifyContent: 'center' }}><Text style={{ color: '#fff', fontWeight: '700', textDecorationLine: 'underline', fontSize: 11 }}>{announcement.banner.cta || 'Explore'} →</Text></Pressable>}
  </View>;
}

export function TopProducts() {
  const theme = useAppTheme();
  const { activeMode, setActiveNav } = useUser();
  const { products, loading, error, retry } = useProducts({ type: activeMode === 'quick' ? 'grocery' : 'ecommerce', limit: 8 });
  return <View style={styles.sfSection}>
    <View style={styles.sfHeading}>
      <View style={{ flex: 1 }}><Text style={[styles.eyebrow, { color: theme.text }]}>FIND YOUR NEXT FAVOURITE</Text><Text style={[styles.sfTitle, { color: theme.text }]}>Fresh finds for you</Text></View>
      <Pressable onPress={() => setActiveNav('categories')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: theme.text, fontSize: 12, fontWeight: '700', textDecorationLine: 'underline' }}>Browse all →</Text></Pressable>
    </View>
    {loading ? <View style={[styles.productSkeleton, { backgroundColor: theme.surface, borderRadius: theme.radius }]}><Text style={{ color: theme.muted }}>Loading products…</Text></View>
      : error ? <Text accessibilityRole="alert">Products could not be loaded. <Text onPress={retry} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>Retry</Text></Text>
        : products.length ? <Rail products={products} renderCard={p => <MerchandisingCard product={p} />} />
          : <Text>Products will appear here as sellers publish them.</Text>}
  </View>;
}

// ---- Popular categories & quick actions ----
const CATEGORY_GLYPHS = {
  grocery: <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"><Rect x="6" y="8" width="12" height="12" rx="2" fill="#dbeafe" stroke="#2563eb" strokeWidth={1.5} /><Rect x="8" y="5" width="8" height="3" rx="1" fill="#1e40af" /><Circle cx="10" cy="12" r="1.5" fill="#f59e0b" /><Circle cx="14" cy="13" r="1" fill="#10b981" /><Circle cx="12" cy="16" r="1.5" fill="#ef4444" /></Svg>,
  organic: <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"><Path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" fill="#d1fae5" /><Path d="M12 7c-2 0-5 1.5-5 4.5s2 4.5 5 4.5 5-1.5 5-4.5S14 7 12 7z" fill="#10b981" /><Path d="M12 7V5c0 0 2-1 3 0s-1 2-1 2" stroke="#047857" strokeWidth={1.5} strokeLinecap="round" /></Svg>,
  handmade: <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"><Path d="M12 3v18" stroke="#b45309" strokeWidth={1.5} strokeDasharray="2 2" /><Path d="M7 10c0-2.5 1.5-3 5-3s5 .5 5 3c0 4-2 6-2 9H9s-2-5-2-9z" fill="#ffedd5" stroke="#d97706" strokeWidth={1.5} /><Ellipse cx="12" cy="7" rx="3" ry="1" fill="#d97706" /></Svg>,
  spice: <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"><Path d="M4 14c0 3 3 5 8 5s8-2 8-5H4z" fill="#fef3c7" stroke="#d97706" strokeWidth={1.5} /><Path d="M6 14c0-2 2-3 6-3s6 1 6 3H6z" fill="#ea580c" /><Circle cx="12" cy="9" r="2" fill="#e11d48" /><Circle cx="8" cy="11" r="1.5" fill="#ca8a04" /></Svg>,
  pickle: <Svg width={24} height={24} viewBox="0 0 24 24" fill="none"><Rect x="7" y="10" width="10" height="10" rx="2" fill="#fff" stroke="#d97706" strokeWidth={1.5} /><Path d="M7 10h10v4H7v-4z" fill="#ea580c" /><Rect x="9" y="6" width="6" height="4" rx="1" fill="#facc15" stroke="#ca8a04" strokeWidth={1} /></Svg>,
};

function PopularCategoryImage({ category, color }) {
  const url = category.icon || category.image;
  if (category.image && !category.image.toLowerCase().endsWith('.svg')) return <Image source={{ uri: mediaUrl(category.image) }} style={{ width: '100%', height: '100%', borderRadius: 16 }} contentFit="cover" />;
  if (url && !url.toLowerCase().endsWith('.svg')) return <Image source={{ uri: mediaUrl(url) }} style={{ width: 24, height: 24 }} contentFit="contain" />;
  const name = String(category.name || '').toLowerCase(), slug = String(category.slug || '').toLowerCase();
  const key = ['grocery', 'organic', 'handmade', 'spice', 'pickle'].find(k => name.includes(k) || slug.includes(k) || (k === 'handmade' && (name.includes('craft') || slug.includes('craft'))));
  if (key) return CATEGORY_GLYPHS[key];
  return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}><Circle cx="12" cy="12" r="9" /><Path d="M9 12h6M12 9v6" /></Svg>;
}

export function PopularCategories() {
  const theme = useAppTheme();
  const { setActiveNav, activeMode, setSelectedCategoryFilter } = useUser();
  const type = activeMode === 'quick' ? 'grocery' : 'ecommerce';
  const { tree, loading, error, retry } = useCategoryTree(type);
  const { theme: published } = useStorefront();
  const tileFor = category => published?.categoryTiles?.find(tile => tile.categoryId === String(category._id || category.id));
  const categories = useMemo(() => {
    const flatten = nodes => (nodes || []).flatMap(category => [category, ...flatten(category.children)]);
    const visible = flatten(tree).filter(category => !category.isSystem);
    const promoted = visible.filter(category => category.isPopular || category.showOnHome);
    const roots = (tree || []).filter(category => !category.isSystem);
    return [...(promoted.length ? promoted : (roots.length ? roots : visible))].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).slice(0, 12);
  }, [tree]);
  const minimal = theme.tokens.category === 'minimal';
  return <View style={{ marginTop: 22, marginBottom: 26, paddingHorizontal: 8 }}>
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: theme.text }]}>Popular Categories</Text>
      <Pressable onPress={() => setActiveNav('categories')} style={[styles.viewAllPill, { borderColor: theme.action }]}><Text style={{ color: theme.action, fontSize: 12, fontWeight: '800' }}>View All</Text></Pressable>
    </View>
    {loading ? <Text style={{ color: '#94a3b8', fontSize: 12, paddingVertical: 10, paddingHorizontal: 12 }}>Loading...</Text>
      : error ? <InlineState message="Categories unavailable." onRetry={retry} />
        : categories.length === 0 ? <InlineState message="No customer categories are published yet." />
          : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingVertical: 4, paddingHorizontal: 2 }}>
            {categories.map(category => {
              const tile = tileFor(category);
              return <Pressable key={category._id || category.id} onPress={() => setSelectedCategoryFilter(category)} style={styles.popularItem} accessibilityRole="button" accessibilityLabel={category.name}>
                <View style={[styles.popularCircle, minimal ? { backgroundColor: theme.surface, borderColor: theme.borderColor } : { backgroundColor: theme.categorySurface, borderColor: theme.categoryFrame, shadowColor: theme.categoryFrame, elevation: 3 }]}>
                  {tile ? <StorefrontMedia banner={tile.banner} active={false} /> : <PopularCategoryImage category={category} color={theme.primaryColor} />}
                </View>
                <Text numberOfLines={2} style={{ fontSize: 11, fontWeight: '600', color: theme.text, textAlign: 'center', maxWidth: 74 }}>{category.name}</Text>
                {tile?.badge ? <Text style={[styles.tileBadge, { position: 'relative', backgroundColor: theme.badge, color: theme.badgeText }]}>{tile.badge}</Text> : null}
              </Pressable>;
            })}
          </ScrollView>}
  </View>;
}

const QUICK_ACTIONS = [
  { id: 'categories', title: 'Categories', subtitle: 'Explore all', Icon: GridIcon },
  { id: 'offers', title: 'Offers', subtitle: 'Best deals', Icon: TicketIcon },
  { id: 'wholesale', title: 'Wholesale', subtitle: 'Bulk quantities', Icon: BulkIcon },
];

export function QuickActions() {
  const theme = useAppTheme();
  const { setActiveNav, setActiveSubNav } = useUser();
  const [wholesaleAvailable, setWholesaleAvailable] = useState(false);
  const [wholesaleError, setWholesaleError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setWholesaleError(false);
    boundedFetch('/api/products/wholesale/availability', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('Wholesale availability could not be checked.');
      const data = await response.json();
      if (data?.success !== true || typeof data.enabled !== 'boolean') throw new Error('Invalid availability response');
      if (!controller.signal.aborted) setWholesaleAvailable(data.enabled);
    }).catch(() => { if (!controller.signal.aborted) { setWholesaleAvailable(false); setWholesaleError(true); } });
    return () => controller.abort();
  }, [attempt]);
  const handle = id => {
    if (id === 'categories') setActiveNav('categories');
    else if (id === 'offers') { setActiveNav('home'); setActiveSubNav('coupons'); }
    else if (id === 'wholesale') setActiveNav('wholesale');
  };
  const iconColor = id => (id === 'offers' ? theme.highlightText : theme.actionHover);
  const actions = QUICK_ACTIONS.filter(action => action.id !== 'wholesale' || wholesaleAvailable);
  return <View style={{ paddingHorizontal: 8 }}>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {actions.map(({ id, title, subtitle, Icon }) => <Pressable key={id} onPress={() => handle(id)} style={[styles.quickCard, { backgroundColor: theme.surface, borderColor: theme.borderColor }]} accessibilityRole="button" accessibilityLabel={title}>
        <View style={[styles.quickIcon, { backgroundColor: theme.highlight }]}><Icon size={26} color={iconColor(id)} width={id === 'wholesale' ? 2 : 2.2} radius={2.2} /></View>
        <Text style={[styles.quickTitle, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.quickSub, { color: theme.muted }]}>{subtitle}</Text>
      </Pressable>)}
      {Array.from({ length: 4 - actions.length }, (_, i) => <View key={i} style={{ flex: 1 }} />)}
    </View>
    {wholesaleError && <Text accessibilityRole="alert" style={{ marginTop: 8 }}>Wholesale availability could not be checked. <Text onPress={() => setAttempt(v => v + 1)} style={{ fontWeight: '700', textDecorationLine: 'underline' }}>Retry wholesale availability</Text></Text>}
  </View>;
}

const styles = StyleSheet.create({
  fallbackArt: { alignItems: 'center', justifyContent: 'center' },
  tileBadge: { position: 'absolute', top: 4, left: 4, fontSize: 9, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  inlineState: { minHeight: 42, paddingVertical: 9, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderWidth: 1, borderStyle: 'dashed', borderRadius: 10 },
  inlineRetry: { paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderRadius: 999 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  landingSection: { gap: 12, marginTop: 8, paddingHorizontal: 8 },
  featurePanel: { paddingTop: 16, paddingHorizontal: 16, paddingBottom: 20, borderRadius: 16, marginHorizontal: 8 },
  loadingText: { color: '#94a3b8', fontSize: 12, paddingVertical: 12, textAlign: 'center' },
  groceryCard: { backgroundColor: '#fff', borderWidth: 1.5, borderRadius: 18, overflow: 'hidden', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 6 },
  electronicsHero: { paddingTop: 28, paddingHorizontal: 12, paddingBottom: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 24, marginBottom: 16, overflow: 'hidden', backgroundColor: 'rgba(233,213,255,0.3)', minHeight: 90 },
  pedestalIcon: { backgroundColor: '#fff', paddingVertical: 6, paddingHorizontal: 8, borderRadius: 13, elevation: 2 },
  electronicsCard: { backgroundColor: '#fff', borderWidth: 1.5, borderRadius: 22, overflow: 'hidden', alignItems: 'center', paddingTop: 10, paddingHorizontal: 4, paddingBottom: 8 },
  fashionCard: { backgroundColor: '#fff', borderWidth: 1.5, borderRadius: 16, overflow: 'hidden', alignItems: 'center' },
  sfSection: { marginVertical: 24, marginHorizontal: 12 },
  sfHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 15, flexWrap: 'wrap' },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4, lineHeight: 16 },
  sfTitle: { fontSize: 20, fontWeight: '800', letterSpacing: -0.7, lineHeight: 26, marginVertical: 3 },
  coupon: { flexDirection: 'row', gap: 20, alignItems: 'center', padding: 18, marginBottom: 14, borderWidth: 1, borderStyle: 'dashed' },
  couponText: { fontSize: 12, marginTop: 4 },
  copyBtn: { minHeight: 38, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  sponsoredCard: { borderWidth: 1, borderRadius: 14, overflow: 'hidden', elevation: 2, shadowColor: '#0f172a', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  sponsoredMedia: { aspectRatio: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  sponsoredTag: { position: 'absolute', left: 8, top: 8, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(15,23,42,0.72)', color: '#fff', fontSize: 9.5, fontWeight: '700', overflow: 'hidden' },
  adPill: { height: 18, paddingHorizontal: 6, borderWidth: 1, borderRadius: 5, fontSize: 10, fontWeight: '700', textAlignVertical: 'center' },
  centerMuted: { paddingVertical: 40, textAlign: 'center', color: '#64748b', fontSize: 13 },
  emptyDashed: { marginTop: 20, paddingVertical: 40, alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#e2e8f0' },
  loadState: { marginVertical: 24, marginHorizontal: 12, paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14 },
  loadRetry: { marginTop: 6, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999 },
  countdownPill: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, fontWeight: '700', fontSize: 12, borderWidth: 1, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  productSkeleton: { paddingVertical: 60, paddingHorizontal: 20 },
  announcement: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 16, marginBottom: 12 },
  viewAllPill: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  popularItem: { alignItems: 'center', gap: 6, padding: 4, minWidth: 74 },
  popularCircle: { width: 56, height: 56, borderRadius: 22, borderWidth: 2, padding: 5, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowOpacity: 0.45, shadowRadius: 0, shadowOffset: { width: 0, height: 5 } },
  quickCard: { flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderWidth: 1, borderRadius: 4 },
  quickIcon: { width: 56, height: 56, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 6, elevation: 1 },
  quickTitle: { fontSize: 11, fontWeight: '700' },
  quickSub: { fontSize: 8, marginTop: 2, lineHeight: 9 },
});

