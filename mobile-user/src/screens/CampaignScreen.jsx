// Port of modules/User/pages/CampaignLandingPage.jsx (route /campaign/[id]). Reads only the public, already
// filtered campaign endpoints: a deal is either ACTIVE now or not shown, the same rule checkout enforces.
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../context/UserContext';
import { countdown, useStorefront, useStorefrontNow } from '../context/StorefrontContext';
import { boundedFetch, mediaUrl } from '../api/client';
import { Text } from '../components/ui';
import { ChevronLeft } from '../components/icons';
import { MerchandisingCard } from '../components/home/ProductCards';
import Celebration from '../components/Celebration';

export default function CampaignScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { effect } = useStorefront();
  const now = useStorefrontNow();
  const { setSelectedCategoryFilter, setActiveMode } = useUser();
  const [campaign, setCampaign] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const [campaignRes, productsRes] = await Promise.all([boundedFetch(`/api/campaigns/${id}`), boundedFetch(`/api/campaigns/${id}/products`)]);
        if (!campaignRes.ok) throw new Error('This deal has ended or is not available right now.');
        if (!productsRes.ok) throw new Error('Deal products could not be loaded. Reopen this deal to retry.');
        const campaignBody = await campaignRes.json();
        const productsBody = await productsRes.json().catch(() => ({}));
        if (!cancelled) { setCampaign(campaignBody.data); setProducts(productsBody.data?.products || []); }
      } catch (err) { if (!cancelled) setError(err.message || 'Could not load this deal.'); } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const target = campaign?.targetCategory;
  const shopCategory = () => {
    if (target.type) setActiveMode(target.type === 'grocery' ? 'quick' : 'shop-all');
    setSelectedCategoryFilter({ _id: target.id, slug: target.slug, name: target.name });
  };
  const shopButton = target ? <Pressable onPress={shopCategory} style={styles.shop} accessibilityRole="button"><Text style={{ color: '#b91c1c', fontSize: 13, fontWeight: '800' }}>Shop {target.name} →</Text></Pressable> : null;
  const day = date => new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const ended = campaign?.endAt && Date.parse(campaign.endAt) <= now;
  const cardWidth = (width - 32 - 12) / 2;

  return <View style={{ flex: 1, backgroundColor: '#fff' }}>
    <StatusBar style="dark" />
    <View style={{ height: insets.top, backgroundColor: '#fff' }} />
    <View style={styles.header}>
      <Pressable onPress={close} accessibilityLabel="Go back" style={{ padding: 8 }}><ChevronLeft size={20} width={2.5} color="#0f172a" /></Pressable>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '900', color: '#0f172a' }}>{campaign?.name || 'Deal'}</Text>
      <View style={{ width: 36 }} />
    </View>
    {loading ? <Text style={{ textAlign: 'center', paddingVertical: 60, paddingHorizontal: 20, color: '#94a3b8', fontSize: 13 }}>Loading deal…</Text>
      : error || ended ? <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 40, marginBottom: 10 }}>⏳</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a', textAlign: 'center' }}>{error || 'This deal has ended.'}</Text>
      </View>
      : <ScrollView contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}>
        {campaign.bannerImage ? <View style={styles.banner}>
          <Image source={{ uri: mediaUrl(campaign.bannerImage) }} style={{ width: '100%', aspectRatio: 2.6 }} contentFit="cover" accessibilityLabel={campaign.name} />
          <Celebration effect={effect} />
        </View> : null}
        <LinearGradient colors={['#b91c1c', '#ef4444']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.details}>
          {!campaign.bannerImage && <Celebration effect={effect} />}
          <View style={{ zIndex: 2 }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>{campaign.name}</Text>
            {campaign.description ? <Text style={{ color: '#fff', marginTop: 6, fontSize: 13, lineHeight: 19.5, opacity: 0.92 }}>{campaign.description}</Text> : null}
            {Number(campaign.discountValue) > 0 && <Text style={{ color: '#fff', marginTop: 10, fontSize: 22, fontWeight: '900' }}>{campaign.discountValue}% OFF</Text>}
            <Text style={{ color: '#fff', marginTop: 4, fontSize: 12, opacity: 0.88 }}>{day(campaign.startAt)} → {day(campaign.endAt)} · Ends in <Text style={{ color: '#fff', fontSize: 12, fontVariant: ['tabular-nums'] }}>{countdown(campaign.endAt, now)}</Text></Text>
            {shopButton}
          </View>
        </LinearGradient>
        {products.length === 0 ? <View style={{ alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20 }}>
          <Text style={{ marginBottom: 12, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>No products are participating in this deal yet.</Text>
          {shopButton}
        </View> : <View style={styles.grid}>
          {products.map(p => <MerchandisingCard key={p.id} product={p} deal width={cardWidth} />)}
        </View>}
      </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 8, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  banner: { marginTop: 16, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', elevation: 2 },
  details: { overflow: 'hidden', marginTop: 12, marginHorizontal: 16, marginBottom: 16, padding: 18, borderRadius: 16 },
  shop: { marginTop: 14, minHeight: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: '#fff', alignSelf: 'flex-start', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingTop: 4, paddingHorizontal: 16, paddingBottom: 24 },
});
