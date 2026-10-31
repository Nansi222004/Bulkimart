// Product cards used across the storefront:
// - GridProductCard: landing category sections (VegetablesSection, MensWearSection, …)
// - CategoryProductCard: DynamicCategorySection / category pages (CategoryProductCard.jsx)
// - MerchandisingCard: Storefront Studio sections and "Fresh finds for you" (StorefrontSections.jsx)
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useUser } from '../../context/UserContext';
import { useAppTheme } from '../../theme/ThemeContext';
import { mediaUrl } from '../../api/client';
import { Text } from '../ui';
import WishlistHeartButton from '../WishlistHeartButton';
import { SameDayBadge } from '../SameDayBadge';
import usePromotionNavigation from '../../hooks/usePromotionNavigation';

const inr = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
export const formatCurrency = value => `₹${value}`;

/** The web grid "Add" calls addToCart directly (a multi-variant product opens its details). */
function useQuickAdd() {
  const { addToCart } = useUser();
  return product => { addToCart(product).catch(() => {}); };
}

export function GridProductCard({ product, verdict, style }) {
  const theme = useAppTheme();
  const { setSelectedProduct } = useUser();
  const add = useQuickAdd();
  return <Pressable onPress={() => setSelectedProduct(product)} style={[styles.gridCard, { backgroundColor: theme.surface, borderColor: theme.productBorder, borderRadius: theme.radius }, style]} accessibilityRole="button" accessibilityLabel={product.name}>
    <View style={[styles.gridImg, { backgroundColor: theme.surface }]}>
      {product.image ? <Image source={{ uri: mediaUrl(product.image) }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={product.id} /> : null}
      <WishlistHeartButton productId={product.id} size={13} style={{ position: 'absolute', top: 4, right: 4 }} />
    </View>
    <View style={{ flex: 1 }}>
      <Text numberOfLines={2} style={[styles.gridName, { color: theme.text }]}>{product.name}</Text>
      <Text numberOfLines={1} style={styles.gridSeller}>{product.sellerName}</Text>
      {verdict !== undefined && <SameDayBadge verdict={verdict} compact />}
      <View style={styles.gridFooter}>
        <Text style={[styles.gridPrice, { color: theme.text }]}>{formatCurrency(product.price)}</Text>
        <Pressable onPress={() => add(product)} accessibilityRole="button" accessibilityLabel={`Add ${product.name} to cart`} hitSlop={4}
          style={[styles.gridAdd, { backgroundColor: theme.action, borderRadius: theme.buttonRadius }]}>
          <Text style={[styles.gridAddText, { color: theme.actionText }]}>Add</Text>
        </Pressable>
      </View>
    </View>
  </Pressable>;
}

export function CategoryProductCard({ product, onOpen, onAdd, style }) {
  const theme = useAppTheme();
  return <Pressable onPress={() => onOpen(product)} style={[styles.catCard, { backgroundColor: theme.surface, borderColor: theme.productBorder }, style]} accessibilityRole="button" accessibilityLabel={product.name}>
    <View style={[styles.catImg, { backgroundColor: theme.surface }]}>
      {product.image ? <Image source={{ uri: mediaUrl(product.image) }} style={{ width: '85%', height: '85%' }} contentFit="contain" recyclingKey={product.id} /> : null}
      <WishlistHeartButton productId={product.id} size={11} style={{ position: 'absolute', top: 4, right: 4 }} />
    </View>
    <View style={{ marginTop: 6, flex: 1 }}>
      <Text numberOfLines={2} style={[styles.catName, { color: theme.text }]}>{product.name}</Text>
      {product.fulfillmentType === 'digital' && <Text style={[styles.digitalPill, { backgroundColor: theme.highlight, color: theme.highlightText }]}>DIGITAL E-BOOK</Text>}
      <Text numberOfLines={1} style={[styles.catSeller, { color: theme.muted }]}>{product.sellerName || product.brandName || ''}</Text>
      <View style={styles.catFooter}>
        <Text style={[styles.catPrice, { color: theme.text }]}>{formatCurrency(product.price)}</Text>
        <Pressable onPress={() => onAdd(product)} hitSlop={4} accessibilityRole="button" accessibilityLabel={`Add ${product.name} to cart`} style={[styles.catAdd, { backgroundColor: theme.action }]}>
          <Text style={[styles.catAddText, { color: theme.actionText }]}>ADD</Text>
        </Pressable>
      </View>
    </View>
  </Pressable>;
}

export function MerchandisingCard({ product, deal = false, wholesale = false, width }) {
  const theme = useAppTheme();
  const { addToCart, setSelectedProduct, setActiveNav, openWholesaleProduct } = useUser();
  const navigate = usePromotionNavigation();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [failed, setFailed] = useState(false);
  const id = product.id || product._id;
  const wholesaleVariants = wholesale ? (product.variants || []).filter(v => v.available) : [];
  const tierPrices = wholesaleVariants.flatMap(v => (v.priceTiers || []).map(t => Number(t.unitPrice))).filter(p => Number.isFinite(p) && p >= 0);
  const price = wholesale ? (tierPrices.length ? Math.min(...tierPrices) : null) : deal ? product.campaignPrice : product.price;
  const original = wholesale ? null : deal ? product.price : product.mrp;
  const available = wholesale ? wholesaleVariants.length > 0 : product.fulfillmentType === 'digital' || product.stock > 0 || product.variants?.some(v => v.stock > 0);
  const firstImage = product.images?.[0];
  const artwork = wholesale ? (typeof firstImage === 'string' ? firstImage : firstImage?.url || firstImage?.secure_url || '') : product.image;
  const open = () => (wholesale ? openWholesaleProduct(id, wholesaleVariants[0]?.variantId) : deal ? navigate({ type: 'PRODUCT', id }) : setSelectedProduct(product));
  const add = async () => {
    if (busy) return;
    if (wholesale || deal || product.variants?.length) { open(); return; }
    setBusy(true); setMessage('');
    try {
      const result = await addToCart(product);
      if (result?.ok) setMessage('Added to cart');
      else if (/sign in/i.test(result?.message || '')) setActiveNav('account');
      else setMessage(result?.message || 'Could not add item');
    } catch { setMessage('Could not add item. Try again.'); } finally { setBusy(false); }
  };
  const discount = Number(original) > Number(price) ? Math.floor((original - price) / original * 100) : null;
  const flat = theme.tokens.product === 'flat';
  return <View style={[styles.merch, { width, backgroundColor: theme.surface, borderColor: theme.productBorder, borderRadius: theme.radius }, !flat && styles.merchShadow]}>
    <View style={styles.merchImage}>
      <Pressable onPress={open} style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel={`View ${product.name}`}>
        {artwork && !failed ? <Image source={{ uri: mediaUrl(artwork) }} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setFailed(true)} recyclingKey={String(id)} />
          : <View style={styles.noImage}><Text style={{ fontSize: 12, color: theme.muted }}>Image unavailable</Text></View>}
      </Pressable>
      {!wholesale && <WishlistHeartButton productId={id} size={18} style={{ position: 'absolute', right: 10, top: 10 }} />}
    </View>
    <View style={styles.merchBody}>
      <Pressable onPress={open}><Text numberOfLines={2} style={[styles.merchTitle, { color: theme.text }]}>{product.name}</Text></Pressable>
      {product.rating > 0 && <Text style={styles.rating} accessibilityLabel={`${product.rating} out of 5 stars`}>★ {Number(product.rating).toFixed(1)}</Text>}
      <View style={styles.price}>
        <Text style={[styles.priceStrong, { color: theme.text }]}>{price == null ? 'Price unavailable' : `${wholesale ? 'From ' : ''}${inr(price)}`}</Text>
        {discount !== null && <>
          <Text style={[styles.priceDel, { color: theme.muted }]}>{inr(original)}</Text>
          <Text style={[styles.priceOff, { backgroundColor: theme.badge, color: theme.badgeText }]}>{discount}% off</Text>
        </>}
      </View>
      {wholesale && available && <Text style={[styles.small, { color: theme.muted }]}>Per unit · Minimum {Math.min(...wholesaleVariants.map(v => v.minimumQuantity || 1))} units. Price depends on quantity.</Text>}
      <Pressable disabled={!available || busy} onPress={add} accessibilityRole="button"
        style={[styles.merchAdd, { backgroundColor: theme.action, borderColor: theme.action, borderRadius: theme.buttonRadius }, (!available || busy) && { opacity: 0.6 }]}>
        <Text style={[styles.merchAddText, { color: theme.actionText }]}>{!available ? 'Out of stock' : busy ? 'Adding…' : wholesale ? 'View bulk options' : deal || product.variants?.length ? 'Choose options' : 'Add to cart +'}</Text>
      </Pressable>
      {message ? <Text style={[styles.small, { color: theme.muted }]} accessibilityLiveRegion="polite">{message}</Text> : null}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  gridCard: { borderWidth: 1, padding: 8, flex: 1 },
  gridImg: { aspectRatio: 1, width: '100%', borderRadius: 8, overflow: 'hidden', marginBottom: 6 },
  gridName: { fontSize: 11, fontWeight: '700', lineHeight: 14, height: 28 },
  gridSeller: { fontSize: 8, color: '#64748b', marginTop: 3 },
  gridFooter: { marginTop: 'auto', paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 4 },
  gridPrice: { fontSize: 12, fontWeight: '800' },
  gridAdd: { minHeight: 36, paddingHorizontal: 8, justifyContent: 'center' },
  gridAddText: { fontSize: 10, fontWeight: '800' },
  catCard: { borderWidth: 1, borderRadius: 12, padding: 6, flex: 1 },
  catImg: { width: '100%', height: 85, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: 11, fontWeight: '700', height: 28, lineHeight: 14 },
  digitalPill: { alignSelf: 'flex-start', marginTop: 3, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 999, fontSize: 8.5, fontWeight: '900', overflow: 'hidden' },
  catSeller: { fontSize: 9.5, fontWeight: '600', marginTop: 2 },
  catFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: 6 },
  catPrice: { fontSize: 11.5, fontWeight: '800' },
  catAdd: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8 },
  catAddText: { fontSize: 10, fontWeight: '800' },
  merch: { borderWidth: 1, overflow: 'hidden' },
  merchShadow: { shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  merchImage: { width: '100%', aspectRatio: 1, backgroundColor: '#f8f6f4', overflow: 'hidden' },
  noImage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f2eee9' },
  merchBody: { paddingTop: 10, paddingHorizontal: 10, paddingBottom: 12, gap: 6, flex: 1 },
  merchTitle: { fontSize: 13.5, fontWeight: '600', lineHeight: 18, minHeight: 36 },
  rating: { fontSize: 11.5, fontWeight: '700', color: '#b45309' },
  price: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 6, paddingTop: 2 },
  priceStrong: { fontSize: 18, fontWeight: '800', letterSpacing: -0.5 },
  priceDel: { fontSize: 11.5, textDecorationLine: 'line-through' },
  priceOff: { fontSize: 10, fontWeight: '700', borderRadius: 5, paddingVertical: 3, paddingHorizontal: 5, overflow: 'hidden' },
  small: { fontSize: 11, lineHeight: 15 },
  merchAdd: { minHeight: 38, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  merchAddText: { fontSize: 12.5, fontWeight: '700' },
});
