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
import { useStorefront, useStorefrontNow } from '../context/StorefrontContext';
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
        if (!cancelled) {
          const rawCamp = campaignBody.data || productsBody.data?.campaign || {};
          setCampaign({
            ...rawCamp,
            description: rawCamp.description || productsBody.data?.campaign?.description || '',
            discountValue: rawCamp.discountValue != null ? rawCamp.discountValue : productsBody.data?.campaign?.discountValue,
          });
          setProducts(productsBody.data?.products || []);
        }
      } catch (err) { if (!cancelled) setError(err.message || 'Could not load this deal.'); } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const target = campaign?.targetCategory;
  const shopCategory = () => {
    if (!target) return;
    const catChannel = target.channel || target.type;
    if (catChannel) setActiveMode(catChannel === 'grocery' ? 'quick' : 'shop-all');
    setSelectedCategoryFilter({
      _id: target._id || target.id,
      id: target.id || target._id,
      slug: target.slug || target._id || target.id,
      name: target.name,
      channel: catChannel,
      type: catChannel,
    });
  };
  const shopButton = target ? (
    <Pressable onPress={shopCategory} style={styles.shop} accessibilityRole="button">
      <Text style={{ color: '#78350f', fontSize: 13.5, fontWeight: '900' }}>Shop {target.name} →</Text>
    </Pressable>
  ) : (
    <Pressable onPress={() => router.replace('/')} style={styles.shop} accessibilityRole="button">
      <Text style={{ color: '#78350f', fontSize: 13.5, fontWeight: '900' }}>Explore All Deals →</Text>
    </Pressable>
  );

  const day = date => new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const ended = campaign?.endAt && Date.parse(campaign.endAt) <= now;
  const cardWidth = Math.floor((width - 32 - 12) / 2);

  // Segmented countdown timer matching festive promo card UI
  const totalSec = campaign?.endAt ? Math.max(0, Math.floor((Date.parse(campaign.endAt) - now) / 1000)) : 0;
  const timer = totalSec > 0 ? {
    days: Math.floor(totalSec / 86400),
    hours: Math.floor((totalSec % 86400) / 3600),
    mins: Math.floor((totalSec % 3600) / 60),
    secs: totalSec % 60,
  } : null;

  return <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
    <StatusBar style="dark" />
    <View style={{ height: insets.top, backgroundColor: '#fff' }} />
    <View style={styles.header}>
      <Pressable onPress={close} accessibilityLabel="Go back" style={{ padding: 8 }}>
        <ChevronLeft size={22} width={2.5} color="#0f172a" />
      </Pressable>
      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '900', color: '#0f172a' }}>
        {campaign?.name || 'Festive Deals'}
      </Text>
      <View style={{ width: 36 }} />
    </View>

    {loading ? (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 }}>
        <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 14, fontWeight: '600' }}>Loading festive deals…</Text>
      </View>
    ) : error || ended ? (
      <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 }}>
        <Text style={{ fontSize: 44, marginBottom: 12 }}>🪔</Text>
        <Text style={{ fontSize: 16, fontWeight: '800', color: '#0f172a', textAlign: 'center' }}>
          {error || 'This celebration deal has ended.'}
        </Text>
      </View>
    ) : (
      <ScrollView contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}>
        {/* Banner image with festive frame */}
        {(campaign.bannerImage || campaign.image) ? (
          <View style={styles.bannerContainer}>
            <Image
              source={{ uri: mediaUrl(campaign.bannerImage || campaign.image) }}
              style={{ width: '100%', aspectRatio: 16 / 9 }}
              contentFit="cover"
              accessibilityLabel={campaign.name}
            />
            <Celebration effect={effect} />
          </View>
        ) : null}

        {/* Festive Deal Details Hero Card */}
        <LinearGradient
          colors={['#450a0a', '#7f1d1d', '#991b1b']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.detailsCard}
        >
          <Celebration effect={effect} />
          <View style={{ zIndex: 2 }}>
            <View style={styles.festivePill}>
              <Text style={styles.festivePillText}>✦ BULKIMART DIOTSAV SPECIAL ✦</Text>
            </View>

            <Text style={styles.dealTitle}>{campaign.name}</Text>

            {Boolean(campaign.description) && (
              <Text style={styles.dealDesc}>{campaign.description}</Text>
            )}

            {Number(campaign.discountValue) > 0 && (
              <View style={styles.discountPill}>
                <Text style={styles.discountPillText}>UP TO {campaign.discountValue}% OFF</Text>
              </View>
            )}

            {/* Segmented Festive Countdown Box */}
            {timer && (
              <View style={styles.countdownRow}>
                <Text style={styles.countdownPrefix}>Sale Ends In ·</Text>
                <View style={styles.timeDigitBox}>
                  <Text style={styles.timeDigitText}>
                    {timer.days}
                    <Text style={{ fontSize: 10, fontWeight: '700' }}>d</Text>
                  </Text>
                </View>
                <Text style={styles.timeColon}>:</Text>
                <View style={styles.timeDigitBox}>
                  <Text style={styles.timeDigitText}>{String(timer.hours).padStart(2, '0')}</Text>
                </View>
                <Text style={styles.timeColon}>:</Text>
                <View style={styles.timeDigitBox}>
                  <Text style={styles.timeDigitText}>{String(timer.mins).padStart(2, '0')}</Text>
                </View>
                <Text style={styles.timeColon}>:</Text>
                <View style={styles.timeDigitBox}>
                  <Text style={styles.timeDigitText}>{String(timer.secs).padStart(2, '0')}</Text>
                </View>
              </View>
            )}

            <Text style={styles.dateRange}>
              {day(campaign.startAt)} → {day(campaign.endAt)}
            </Text>

            {shopButton}
          </View>
        </LinearGradient>

        {/* Product Section Header */}
        <View style={styles.productsHeader}>
          <Text style={styles.productsHeading}>Participating Deals ({products.length})</Text>
          <Text style={styles.productsSubhead}>Exclusive festive discounts applied automatically</Text>
        </View>

        {/* 2-Column Product Grid */}
        {products.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 36, paddingHorizontal: 20 }}>
            <Text style={{ marginBottom: 12, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
              No products are participating in this deal yet.
            </Text>
            {shopButton}
          </View>
        ) : (
          <View style={styles.grid}>
            {products.map(p => (
              <View key={p.id} style={{ width: cardWidth }}>
                <MerchandisingCard product={p} deal width={cardWidth} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    )}
  </View>;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    elevation: 2,
  },
  bannerContainer: {
    marginTop: 14,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    backgroundColor: '#000',
    elevation: 3,
  },
  detailsCard: {
    overflow: 'hidden',
    marginTop: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    elevation: 4,
  },
  festivePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(254, 240, 138, 0.22)',
    borderWidth: 1,
    borderColor: '#fde047',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    marginBottom: 8,
  },
  festivePillText: {
    color: '#fef08a',
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  dealTitle: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  dealDesc: {
    color: '#fef2f2',
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
    opacity: 0.95,
  },
  discountPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef08a',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 12,
    elevation: 2,
  },
  discountPillText: {
    color: '#78350f',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(254, 240, 138, 0.35)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  countdownPrefix: {
    color: '#fef08a',
    fontSize: 11.5,
    fontWeight: '700',
    marginRight: 6,
  },
  timeDigitBox: {
    backgroundColor: '#fff',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeDigitText: {
    color: '#78350f',
    fontSize: 12,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  timeColon: {
    color: '#fef08a',
    fontSize: 13,
    fontWeight: '900',
    marginHorizontal: 3,
  },
  dateRange: {
    color: 'rgba(255, 255, 255, 0.85)',
    marginTop: 10,
    fontSize: 11.5,
    fontWeight: '600',
  },
  shop: {
    marginTop: 14,
    minHeight: 40,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#fef08a',
    alignSelf: 'flex-start',
    justifyContent: 'center',
    elevation: 3,
  },
  productsHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  productsHeading: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  productsSubhead: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '500',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
});
