// Port of modules/User/pages/WishlistPage.jsx (route /wishlist, sign-in required): All / Quick / Shop All tabs
// over the server wishlist, 2-column cards with remove and add-to-cart.
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path, Polygon } from 'react-native-svg';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { normalizeProduct } from '../hooks/useProducts';
import { mediaUrl } from '../api/client';
import { useRefreshHandler, runRefresh } from '../lib/refresh';
import { CustomerPage, useNavPadding } from '../components/Shell';
import { Spinner, Text } from '../components/ui';
import { ArrowLeft, HeartIcon, PlusIcon } from '../components/icons';
import { formatCurrency } from '../components/home/ProductCards';

function ChannelTag({ type }) {
  const quick = type === 'grocery';
  return <View style={[styles.tag, quick ? { backgroundColor: '#fef08a', borderColor: '#fde047' } : { backgroundColor: '#dcfce7', borderColor: '#bbf7d0' }]}>
    {quick ? <Svg width={10} height={10} viewBox="0 0 24 24" fill="#854d0e"><Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Svg>
      : <Svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><Circle cx="9" cy="21" r="1" /><Circle cx="20" cy="21" r="1" /><Path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></Svg>}
    <Text style={{ fontSize: 9.5, fontWeight: '800', color: quick ? '#854d0e' : '#166534' }}>{quick ? 'Quick' : 'Shop All'}</Text>
  </View>;
}

export default function WishlistScreen() {
  const theme = useAppTheme();
  const primary = theme.primaryColor;
  const { wishlist, toggleWishlist, addToCart, setSelectedProduct, setActiveNav, refreshWishlist, getWishlistItems, wishlistLoading: loading } = useUser();
  const [activeTab, setActiveTab] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const bottom = useNavPadding(10);
  useEffect(() => { refreshWishlist(); }, [refreshWishlist]);
  useRefreshHandler(refreshWishlist);

  const savedProducts = getWishlistItems().map(item => ({ ...normalizeProduct(item), available: item.available })).filter(p => wishlist.has(String(p.id)));
  const quickProducts = savedProducts.filter(p => p.type === 'grocery');
  const shopAllProducts = savedProducts.filter(p => p.type !== 'grocery');
  const displayedProducts = activeTab === 'quick' ? quickProducts : activeTab === 'shop-all' ? shopAllProducts : savedProducts;
  const tabs = [['all', `All Items (${savedProducts.length})`], ['quick', `⚡ Quick (${quickProducts.length})`], ['shop-all', `🛒 Shop All (${shopAllProducts.length})`]];

  const renderCard = ({ item: product }) => <Pressable onPress={() => setSelectedProduct(product)} style={[styles.card, { borderColor: theme.border, borderRadius: theme.radius ? Math.max(theme.radius, 4) : 14 }]}>
    <View style={styles.imgWrap}>
      <Image source={{ uri: mediaUrl(product.image) || undefined }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={product.name} />
      <View style={{ position: 'absolute', top: 8, left: 8 }}><ChannelTag type={product.type} /></View>
      <Pressable onPress={() => toggleWishlist(product.id || product._id)} accessibilityLabel="Remove from wishlist" hitSlop={6} style={styles.heart}>
        <HeartIcon filled size={18} color="#ef4444" />
      </Pressable>
    </View>
    <View style={{ padding: 10, flexGrow: 1 }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: primary, textTransform: 'uppercase', letterSpacing: 0.2 }} numberOfLines={1}>{product.sellerName || 'Verified Store'}</Text>
      <Text style={{ marginVertical: 4, fontSize: 12, fontWeight: '700', color: theme.textPrimary, lineHeight: 14.4, height: 29 }} numberOfLines={2}>{product.name}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: theme.textPrimary }}>{formatCurrency(product.price)}</Text>
        {product.mrp > product.price && <Text style={{ fontSize: 11, color: '#94a3b8', textDecorationLine: 'line-through' }}>{formatCurrency(product.mrp)}</Text>}
      </View>
      <View style={{ flex: 1 }} />
      <Pressable disabled={product.available === false} onPress={() => addToCart(product)} style={[styles.addBtn, { backgroundColor: primary }, product.available === false && { opacity: 0.5 }]}>
        <PlusIcon size={14} width={2.5} color="#fff" />
        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>{product.available === false ? 'Unavailable' : 'Add to Cart'}</Text>
      </Pressable>
    </View>
  </Pressable>;

  return <CustomerPage protectedPage headerColor="#ffffff">
    <View style={[styles.header, { borderBottomColor: theme.border }]}>
      <Pressable onPress={() => setActiveNav('home')} accessibilityLabel="Back to Home" style={{ padding: 8 }}><ArrowLeft size={20} width={2.5} color={theme.textPrimary} /></Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: '800', color: theme.textPrimary, fontFamily: theme.fontFamily }}>My Wishlist</Text>
        <Text style={[styles.count, { backgroundColor: theme.primaryLight, color: primary }]}>{savedProducts.length} {savedProducts.length === 1 ? 'item' : 'items'}</Text>
      </View>
      <View style={{ width: 36 }} />
    </View>
    <View style={[styles.tabsRow, { borderBottomColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {tabs.map(([key, label]) => <Pressable key={key} onPress={() => setActiveTab(key)} accessibilityState={{ selected: activeTab === key }}
          style={[styles.tab, activeTab === key && { backgroundColor: primary }]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: activeTab === key ? '#fff' : '#475569' }}>{label}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    {loading && !refreshing ? <View style={{ alignItems: 'center', gap: 10, padding: 48 }}><Spinner /><Text style={{ color: '#64748b', fontSize: 13 }}>Loading your saved items...</Text></View>
      : <FlatList data={displayedProducts} keyExtractor={p => String(p.id || p._id)} numColumns={2} renderItem={renderCard}
        columnWrapperStyle={{ gap: 12 }} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottom }} style={{ backgroundColor: theme.pageBackground }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await runRefresh(); setRefreshing(false); }} colors={[primary]} />}
        ListEmptyComponent={<View style={styles.empty}>
          <View style={styles.emptyCircle}><HeartIcon size={42} color={primary} /></View>
          <Text style={{ fontSize: 18, fontWeight: '800', color: theme.textPrimary, textAlign: 'center' }}>{savedProducts.length === 0 ? 'Your Wishlist is Empty' : 'No items found in this section'}</Text>
          <Text style={{ marginTop: 8, marginBottom: 24, fontSize: 12, color: '#64748b', maxWidth: 260, lineHeight: 17, textAlign: 'center' }}>
            {savedProducts.length === 0 ? 'Explore items across Quick or Shop All and tap the heart icon to save your favorite products!' : 'Switch tabs or browse products to add items to your wishlist.'}
          </Text>
          <Pressable onPress={() => setActiveNav('home')} style={[styles.explore, { backgroundColor: primary }]}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>Explore Products</Text></Pressable>
        </View>} />}
  </CustomerPage>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#fff', borderBottomWidth: 1 },
  count: { fontSize: 11, fontWeight: '800', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, overflow: 'hidden' },
  tabsRow: { paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1 },
  tab: { backgroundColor: '#f1f5f9', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20 },
  card: { flex: 1, maxWidth: '50%', backgroundColor: '#fff', borderWidth: 1, overflow: 'hidden', elevation: 1 },
  imgWrap: { height: 120, backgroundColor: '#f8fafc', overflow: 'hidden' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1 },
  heart: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', elevation: 2 },
  addBtn: { marginTop: 8, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, marginTop: 20 },
  emptyCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#f0fdf4', borderWidth: 2, borderColor: '#bbf7d0', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  explore: { borderRadius: 12, paddingVertical: 12, paddingHorizontal: 24 },
});
