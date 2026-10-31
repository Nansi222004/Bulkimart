// Port of ProductDetailPage.jsx, plus the product-link loading that UserContext.jsx did on the web
// (`?product=<id>&purchase=wholesale&variant=`). Route: /product?id&purchase&variant.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Polygon, Stop } from 'react-native-svg';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { boundedFetch, mediaUrl, request } from '../api/client';
import { WEBSITE_ORIGIN } from '../config';
import { useFeedback } from '../lib/feedback';
import { captureUserSession, isCurrentUserSession } from '../lib/session';
import { rememberWholesaleReturn, wholesaleDetailProduct } from '../lib/productRoute';
import { normalizeProduct, useProducts } from '../hooks/useProducts';
import { useProductDeliveryOptions } from '../hooks/useDeliveryOptions';
import { useProductWholesale } from '../hooks/useProductWholesale';
import ProductWholesaleOffer from '../components/ProductWholesaleOffer';
import BackButton from '../components/BackButton';
import { BoltIcon, HeartIcon, ShareIcon } from '../components/icons';
import { Sheet, Text } from '../components/ui';
import { formatCurrency } from '../components/home/ProductCards';

const STAR = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
function Stars({ rating, size = 14 }) {
  const full = Math.floor(rating), half = rating % 1 >= 0.5;
  return <View style={{ flexDirection: 'row', gap: 1 }}>{[1, 2, 3, 4, 5].map(i => <Svg key={i} width={size} height={size} viewBox="0 0 24 24">
    <Defs><SvgGradient id={`half${i}`}><Stop offset="0.5" stopColor="#f59e0b" /><Stop offset="0.5" stopColor="#e2e8f0" /></SvgGradient></Defs>
    <Polygon points={STAR} fill={i <= full ? '#f59e0b' : i === full + 1 && half ? `url(#half${i})` : '#e2e8f0'} />
  </Svg>)}</View>;
}
function RatingBar({ label, pct, count, color }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 5 }}>
    <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569', width: 14 }}>{label}</Text>
    <Svg width={10} height={10} viewBox="0 0 24 24"><Polygon points={STAR} fill="#f59e0b" /></Svg>
    <View style={{ flex: 1, height: 5, backgroundColor: '#e2e8f0', borderRadius: 99, overflow: 'hidden' }}><View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 99 }} /></View>
    <Text style={{ fontSize: 10, color: '#94a3b8', width: 28, textAlign: 'right' }}>{count}</Text>
  </View>;
}
const CartGlyph = ({ color }) => <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5}><Circle cx="9" cy="21" r="1" /><Circle cx="20" cy="21" r="1" /><Path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></Svg>;

const formatWeight = grams => { const value = Number(grams); if (!(value > 0)) return ''; return value >= 1000 ? `${Number((value / 1000).toFixed(2))} kg` : `${value} g`; };
export const variantPackLabel = variant => [variant?.name && variant.name !== 'Default' ? variant.name : '', formatWeight(variant?.weight), variant?.unit ? `per ${variant.unit}` : ''].filter(Boolean).join(' · ');
export const discountPercent = (mrp, pricePaid) => { const reference = Number(mrp), paid = Number(pricePaid); return reference > 0 && paid >= 0 && paid < reference ? Math.round((reference - paid) / reference * 100) : 0; };

function useWholesaleRecommendations(enabled, productId, token) {
  const key = `${productId}:${token}`;
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true; const controller = new AbortController(), snapshot = captureUserSession();
    boundedFetch('/api/products/wholesale/catalog?limit=12', { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(); if (active && isCurrentUserSession(snapshot)) setResult({ key, products: (body.data || []).filter(p => String(p._id) !== String(productId)).map(p => ({ ...normalizeProduct(wholesaleDetailProduct(p)), startingPrice: Math.min(...p.variants.map(v => v.startingPrice)), variantId: p.variants[0]?.variantId })) }); })
      .catch(() => { if (active) setResult({ key, products: [] }); });
    return () => { active = false; controller.abort(); };
  }, [enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return enabled && result?.key === key ? result.products : [];
}

/** Loads the product named in the route, reusing the one already in memory when it matches. */
function useRouteProduct(id, mode, variant, retry) {
  const { selectedProduct, currentUser } = useUser();
  const [state, setState] = useState(() => {
    const match = selectedProduct?.id === id && (selectedProduct.detailSource === 'wholesale') === (mode === 'wholesale');
    return match ? { product: selectedProduct, loading: false, error: '' } : { product: null, loading: true, error: '' };
  });
  useEffect(() => {
    if (state.product && state.product.id === id && (state.product.detailSource === 'wholesale') === (mode === 'wholesale')) return undefined;
    if (!/^[a-f0-9]{24}$/i.test(String(id || ''))) { setState({ product: null, loading: false, error: 'Invalid product link.' }); return undefined; }
    const controller = new AbortController(); const snapshot = captureUserSession();
    setState({ product: null, loading: true, error: '' });
    boundedFetch(mode === 'wholesale' ? `/api/products/wholesale/catalog?productId=${id}` : `/api/products/${id}`, { signal: controller.signal }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'This product could not be loaded.');
      const product = mode === 'wholesale' ? (body.data?.[0] ? { ...wholesaleDetailProduct(body.data[0]), detailSession: snapshot.token } : null) : body?.data ?? body;
      if (!product || String(product._id) !== String(id) || !product.name) throw new Error('Product not found. Return to the storefront to choose another product.');
      const variants = product.variants?.length ? product.variants : product.raw?.variants || [];
      if (variant && !variants.some(item => String(item._id || item.id) === variant)) throw new Error('This variant is unavailable. Return to the storefront and select the product again.');
      if (!controller.signal.aborted) setState({ product: { ...normalizeProduct(product), detailSession: product.detailSession }, loading: false, error: '' });
    }).catch(error => { if (!controller.signal.aborted) setState({ product: null, loading: false, error: error.message }); });
    return () => controller.abort();
  }, [id, mode, retry, currentUser?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export default function ProductScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = String(params.id || '');
  const routeMode = params.purchase === 'wholesale' ? 'wholesale' : 'retail';
  const routeVariant = params.variant ? String(params.variant) : null;
  const [retry, setRetry] = useState(0);
  const { product, loading, error } = useRouteProduct(id, routeMode, routeVariant, retry);
  const { currentUser, logoutUser, replaceNav } = useUser();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (!product) {
    return <View style={{ flex: 1, backgroundColor: theme.pageBackground, paddingTop: insets.top }}>
      <StatusBar style="dark" />
      <View style={{ padding: 12 }}><BackButton onPress={close} /></View>
      <View style={styles.linkState} accessibilityRole={error ? 'alert' : undefined}>
        <Text style={{ fontSize: 14, textAlign: 'center' }}>{error || 'Loading product…'}</Text>
        {error ? <Pressable onPress={() => setRetry(n => n + 1)} style={styles.linkBtn}><Text style={styles.linkBtnText}>Retry product</Text></Pressable> : null}
        {error && /sign in|expired|session/i.test(error) ? <Pressable onPress={() => { rememberWholesaleReturn(id, routeVariant); if (currentUser) logoutUser(); replaceNav('account'); }} style={styles.linkBtn}><Text style={styles.linkBtnText}>Sign in to view Wholesale product</Text></Pressable> : null}
        {!loading && <Pressable onPress={close} style={styles.linkBtn}><Text style={styles.linkBtnText}>Back to storefront</Text></Pressable>}
      </View>
    </View>;
  }
  return <ProductDetail key={`${product.id}:${product.detailSource || 'retail'}`} product={product} routeMode={routeMode} routeVariant={routeVariant} close={close} />;
}

function ProductDetail({ product, routeMode, routeVariant, close }) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const ui = useFeedback();
  const scrollRef = useRef(null);
  const infoY = useRef(0);
  const { setSelectedProduct, addToCart, getItemQty, getDeliveryPoint, getSelectedAddress, getLocationDisplayName, replaceNav, isWishlisted, toggleWishlist, currentUser, logoutUser, serverCart, openWholesaleProduct } = useUser();
  const wholesaleDetail = product.detailSource === 'wholesale';
  const retailAvailable = product.retailAvailable !== false;
  const isDigital = product.fulfillmentType === 'digital' || product.raw?.fulfillmentType === 'digital';
  const [loadedVariants, setLoadedVariants] = useState([]);
  const [loadedProductId, setLoadedProductId] = useState('');
  const productVariants = loadedProductId === String(product.id) ? loadedVariants : (product.variants || product.raw?.variants || []);
  const [selectedVariantId, setSelectedVariantId] = useState(() => (productVariants.some(item => String(item.id || item._id) === routeVariant) ? routeVariant : String(productVariants[0]?.id || productVariants[0]?._id || '')));
  const selectedVariant = productVariants.find(v => String(v.id || v._id) === String(selectedVariantId)) || productVariants[0] || null;
  const selectedPrice = selectedVariant?.price ?? product.price;
  const selectedMrp = selectedVariant?.mrp ?? product.mrp;
  const limitedEbook = isDigital && Boolean(product.digital?.stockTracked || product.raw?.digital?.stockTracked);
  const selectedStock = isDigital && !limitedEbook ? 1 : (selectedVariant?.stock ?? product.stock);
  const [qty, setQty] = useState(() => getItemQty(product.id, selectedVariantId));
  const [cartActionPending, setCartActionPending] = useState(false);
  const [cartActionError, setCartActionError] = useState('');
  const [variantSheet, setVariantSheet] = useState(false);
  const [purchaseMode, setPurchaseMode] = useState(routeMode);
  const signInForWholesale = () => {
    rememberWholesaleReturn(product.id, selectedVariantId);
    if (currentUser) logoutUser?.();
    replaceNav('account');
  };
  const wholesale = useProductWholesale({
    productId: product.id, variantId: String(selectedVariant?.id || selectedVariant?._id || ''), currentUser, enabled: !isDigital, retailAvailable, wholesaleDetail,
    initialMode: routeMode, onModeChange: setPurchaseMode,
    openCart: () => replaceNav('cart'), onSignIn: signInForWholesale,
  });
  const [activeTab, setActiveTab] = useState('desc');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const showProductInfo = () => { setActiveTab('details'); scrollRef.current?.scrollTo({ y: Math.max(0, infoY.current - 70), animated: true }); };

  // Reviews (approved only, with the summary computed from the same list)
  const [reviews, setReviews] = useState([]);
  const [ratingSummary, setRatingSummary] = useState({ average: 0, count: 0, breakdown: [] });
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [myRating, setMyRating] = useState(0), [myComment, setMyComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false), [reviewError, setReviewError] = useState('');
  const loadReviews = useCallback(async () => {
    if (wholesaleDetail) { setReviews(product.raw?.reviewData?.reviews || []); setRatingSummary(product.raw?.reviewData?.summary || { average: 0, count: 0, breakdown: [] }); setReviewsLoading(false); return; }
    setReviewsLoading(true);
    try {
      const { ok, body } = await request(`/api/products/${product.id}/reviews`, { auth: false });
      if (!ok) throw new Error(body.message || 'Could not load reviews');
      setReviews(body.data?.reviews || []); setRatingSummary(body.data?.summary || { average: 0, count: 0, breakdown: [] });
    } catch { setReviews([]); setRatingSummary({ average: 0, count: 0, breakdown: [] }); } finally { setReviewsLoading(false); }
  }, [product.id, wholesaleDetail]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadReviews(); }, [loadReviews]);
  const submitReview = async () => {
    if (!myRating || submittingReview) return;
    setSubmittingReview(true); setReviewError('');
    try {
      if (!currentUser) throw new Error('Please sign in to review this product.');
      const { ok, body } = await request(`/api/products/${product.id}/reviews`, { method: 'POST', body: { rating: myRating, comment: myComment.trim() } });
      if (!ok) throw new Error(body.message || 'Could not submit your review');
      setMyRating(0); setMyComment(''); loadReviews();
    } catch (err) { setReviewError(err.message); } finally { setSubmittingReview(false); }
  };

  // Answered Q&A and asking a question
  const [faqs, setFaqs] = useState([]), [faqsLoading, setFaqsLoading] = useState(true);
  const [showAskModal, setShowAskModal] = useState(false), [questionText, setQuestionText] = useState(''), [submittingQuestion, setSubmittingQuestion] = useState(false), [questionError, setQuestionError] = useState(''), [questionSent, setQuestionSent] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (wholesaleDetail) { setFaqs(product.raw?.faqs || []); setFaqsLoading(false); return undefined; }
    setFaqsLoading(true);
    request(`/api/products/${product.id}/faqs`, { auth: false }).then(({ ok, body }) => { if (!cancelled) setFaqs(ok ? body.data?.faqs || [] : []); }).catch(() => { if (!cancelled) setFaqs([]); }).finally(() => { if (!cancelled) setFaqsLoading(false); });
    return () => { cancelled = true; };
  }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const submitQuestion = async () => {
    const question = questionText.trim();
    if (!question || submittingQuestion) return;
    setSubmittingQuestion(true); setQuestionError('');
    try {
      if (!currentUser) throw new Error('Please sign in to ask a question.');
      const { ok, body } = await request(`/api/products/${product.id}/faqs`, { method: 'POST', body: { question } });
      if (!ok) throw new Error(body.message || 'Could not submit your question');
      setQuestionSent(true);
    } catch (err) { setQuestionError(err.message); } finally { setSubmittingQuestion(false); }
  };

  const allImages = Array.isArray(product.images) && product.images.length > 0 ? product.images : [product.image].filter(Boolean);
  const activeImage = allImages[activeImageIndex] || product.image;
  const imageUri = img => mediaUrl(typeof img === 'string' ? img : img?.url || img?.secure_url || '');

  // Live campaign deal, return policy and fresh variants (never trusted from the card that opened the page).
  const [campaignDeal, setCampaignDeal] = useState(null);
  const [returnInfo, setReturnInfo] = useState(null);
  useEffect(() => {
    if (wholesaleDetail) return undefined;
    setReturnInfo(null);
    let cancelled = false;
    request(`/api/products/${product.id}`, { auth: false }).then(({ body: data }) => {
      if (cancelled) return;
      if (Array.isArray(data?.variants)) { setLoadedVariants(data.variants.map(variant => ({ ...variant, id: String(variant._id) }))); setLoadedProductId(String(product.id)); }
      setCampaignDeal(data?.campaignPrice ? { price: data.campaignPrice, discountValue: data.campaignDiscountValue, title: data.campaignTitle } : null);
      setReturnInfo(data?.returnPolicy || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const campaignPriceForVariant = campaignDeal?.discountValue != null && selectedPrice != null ? Math.round(Number(selectedPrice) * (1 - Number(campaignDeal.discountValue) / 100) * 100) / 100 : campaignDeal?.price;
  const savingPercent = discountPercent(selectedMrp, campaignDeal ? campaignPriceForVariant : selectedPrice);

  const deliveryPoint = getDeliveryPoint();
  const isEcom = product.type === 'ecommerce';
  const { options: deliveryOptions } = useProductDeliveryOptions(isEcom && !isDigital && wholesale.mode === 'retail' ? product.id : null, deliveryPoint, Math.max(1, wholesale.mode === 'wholesale' ? wholesale.quantity : qty), selectedVariantId || null);
  const sameDay = deliveryOptions?.sameDay;
  useEffect(() => {
    const first = productVariants[0];
    setSelectedVariantId(productVariants.some(item => String(item.id || item._id) === routeVariant) ? routeVariant : first ? String(first.id || first._id || '') : '');
  }, [product.id, loadedProductId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setQty(getItemQty(product.id, selectedVariantId)), [product.id, selectedVariantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Coupons for this storefront (same endpoint the cart uses)
  const couponChannel = product.type === 'grocery' ? 'grocery' : 'ecommerce';
  const [offers, setOffers] = useState({ state: 'idle', items: [] });
  const [showOffers, setShowOffers] = useState(false);
  const offerCartRevision = JSON.stringify((serverCart?.items || []).map(item => [item.productId, item.variantId, item.qty, item.price]));
  useEffect(() => {
    if (isDigital || !currentUser) { setOffers({ state: currentUser ? 'idle' : 'signed-out', items: [] }); return undefined; }
    let cancelled = false;
    setOffers({ state: 'loading', items: [] });
    request(`/api/coupons/available?channel=${couponChannel}`).then(({ ok, body }) => {
      if (cancelled) return;
      if (!ok) throw new Error(body.message || 'Offers could not be loaded.');
      setOffers({ state: 'ready', cartSubtotal: body.meta?.cartSubtotal, items: (Array.isArray(body.data) ? body.data : []).filter(coupon => coupon.isPublic !== false) });
    }).catch(err => { if (!cancelled) setOffers({ state: 'error', items: [], message: err.message }); });
    return () => { cancelled = true; };
  }, [product.id, couponChannel, currentUser, isDigital, offerCartRevision, showOffers]);

  const { products: catalogue } = useProducts({ type: product.type, limit: 12, enabled: wholesale.mode === 'retail' });
  const wholesaleRelated = useWholesaleRecommendations(wholesale.mode === 'wholesale', product.id, currentUser?._id);
  const related = useMemo(() => (wholesale.mode === 'wholesale' ? wholesaleRelated : catalogue || []).filter(p => p.id !== product.id).slice(0, 8), [wholesale.mode, wholesaleRelated, catalogue, product.id]);

  const promptCartSignIn = () => { if (currentUser) return false; setCartActionError(''); ui.notify('Please sign in to use your cart.', { type: 'info' }); return true; };
  const handleAddToCart = async () => {
    if (cartActionPending || wholesale.mode !== 'retail' || !retailAvailable || wholesaleDetail) return;
    if (promptCartSignIn()) return;
    setCartActionPending(true); setCartActionError('');
    const result = await addToCart(product.id, 1, selectedVariantId || undefined);
    setCartActionPending(false);
    if (!result?.ok) { setCartActionError(result?.message || 'Could not add this item to your cart. Please try again.'); return; }
    setQty(result.data?.items?.find(item => String(item.productId) === String(product.id) && String(item.variantId || '') === String(result.variantId || ''))?.qty || 1);
  };
  const handleBuyNow = async () => {
    if (cartActionPending || wholesale.mode !== 'retail' || !retailAvailable || wholesaleDetail) return;
    if (promptCartSignIn()) return;
    setCartActionPending(true); setCartActionError('');
    if (qty === 0) {
      const result = await addToCart(product.id, 1, selectedVariantId || undefined);
      if (!result?.ok) { setCartActionPending(false); setCartActionError(result?.message || 'Could not add this item to your cart. Please try again.'); return; }
    }
    setCartActionPending(false);
    replaceNav('checkout');
  };
  const shareProduct = async () => {
    const query = new URLSearchParams({ product: product.id });
    if (purchaseMode === 'wholesale') query.set('purchase', 'wholesale');
    if (selectedVariantId) query.set('variant', selectedVariantId);
    const url = `${WEBSITE_ORIGIN}/?${query}`;
    try { await Share.share({ title: product.name, message: `Check out ${product.name} on Bulkimart\n${url}`, url }); }
    catch { ui.notify('Could not share this product.', { type: 'error' }); }
  };
  const describeCoupon = coupon => {
    const saving = coupon.discountType === 'percentage' ? `${coupon.value}% off${coupon.maxDiscount ? ` (up to ${formatCurrency(coupon.maxDiscount)})` : ''}` : coupon.discountType === 'free_shipping' ? 'Free delivery' : `${formatCurrency(coupon.value)} off`;
    return `${saving}${coupon.minOrderValue ? ` on orders above ${formatCurrency(coupon.minOrderValue)}` : ''}`;
  };
  const offerSummary = offers.state === 'signed-out' ? 'Sign in to see coupons you can use.' : offers.state === 'loading' ? 'Checking offers…' : offers.state === 'error' ? 'Offers could not be loaded right now.'
    : offers.items.length ? `${offers.items.length} coupon${offers.items.length === 1 ? '' : 's'} · ${offers.items[0].code}: ${describeCoupon(offers.items[0])}` : 'No coupons are running right now.';
  const chooseVariant = value => { setSelectedVariantId(value); setVariantSheet(false); router.setParams({ variant: value }); };
  const wishlisted = isWishlisted(product.id);
  const disabledBuy = cartActionPending || !(selectedStock > 0) || (productVariants.length > 1 && !selectedVariantId);
  const primary = theme.primaryColor;

  return <View style={{ flex: 1, backgroundColor: '#f1f5f9' }}>
    <StatusBar style="dark" />
    <View style={{ height: insets.top, backgroundColor: 'rgba(255,255,255,0.95)' }} />
    <View style={styles.header}>
      <BackButton onPress={close} style={{ width: 44, height: 44 }} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable onPress={shareProduct} accessibilityLabel="Share" style={styles.iconBtn}><ShareIcon size={18} width={2.5} color="#475569" /></Pressable>
        <Pressable disabled={!retailAvailable} accessibilityLabel={wishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'} accessibilityState={{ selected: wishlisted }} style={[styles.iconBtn, !retailAvailable && { opacity: 0.5 }]}
          onPress={async () => { const r = await toggleWishlist(product.id); if (r && r.ok === false) ui.notify(r.message || 'Could not update your wishlist.'); }}>
          <HeartIcon size={18} width={2.5} color={wishlisted ? '#ef4444' : '#475569'} filled={wishlisted} />
        </Pressable>
      </View>
    </View>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 110 }}>
      <View style={styles.hero}>
        {activeImage ? <Image source={{ uri: imageUri(activeImage) }} style={{ width: 200, height: 200 }} contentFit="contain" accessibilityLabel={product.name} /> : <Text style={{ color: '#94a3b8' }}>Image unavailable</Text>}
        {wholesale.mode === 'retail' && savingPercent > 0 && <Text style={styles.offerBadge}>{savingPercent}% OFF</Text>}
      </View>
      {allImages.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: '#fff' }} contentContainerStyle={{ gap: 10, paddingVertical: 12, paddingHorizontal: 16, flexGrow: 1, justifyContent: 'center' }}>
        {allImages.map((img, idx) => <Pressable key={idx} onPress={() => setActiveImageIndex(idx)} style={[styles.thumb, activeImageIndex === idx && { borderColor: primary }]} accessibilityLabel={`${product.name} ${idx + 1}`}>
          <Image source={{ uri: imageUri(img) }} style={{ width: '100%', height: '100%', borderRadius: 8 }} contentFit="contain" />
        </Pressable>)}
      </ScrollView>}

      <View style={styles.infoCard}>
        <View style={styles.infoTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{product.name}</Text>
            <Text style={styles.pack}>{isDigital ? `Digital E-book · ${product.digital?.author || product.raw?.digital?.author || 'Author not listed'}` : wholesale.mode === 'wholesale' ? [product.category, selectedVariant?.name, selectedVariant?.unit].filter(Boolean).join(' · ') : variantPackLabel(selectedVariant || { unit: product.unit })}</Text>
          </View>
          <Pressable onPress={showProductInfo} style={[styles.viewDetails, { borderColor: primary, backgroundColor: theme.primaryLight }]}><Text style={{ color: primary, fontSize: 10, fontWeight: '800' }}>View details</Text></Pressable>
        </View>
        {productVariants.length > 1 && <View style={{ marginVertical: 12, gap: 6 }}>
          <Text style={{ color: '#172B4D', fontWeight: '700', fontSize: 13 }}>Choose pack / variant</Text>
          <Pressable disabled={wholesale.pending} onPress={() => setVariantSheet(true)} accessibilityRole="button" accessibilityLabel="Choose pack / variant" style={styles.select}>
            <Text numberOfLines={1} style={{ flex: 1, color: '#172B4D' }}>{selectedVariant?.name || 'Select'}</Text><Text>▾</Text>
          </Pressable>
        </View>}
        <View style={styles.ratingRow}><Stars rating={ratingSummary.average} size={13} /><Text style={styles.ratingCount}>{ratingSummary.count ? ratingSummary.average : '—'} ({ratingSummary.count} ratings)</Text></View>
        {wholesale.mode === 'retail' && <View style={styles.priceRow}>
          {campaignDeal ? <>
            <Text style={[styles.price, { color: '#b91c1c' }]}>{formatCurrency(campaignPriceForVariant)}</Text>
            <Text style={[styles.mrp, { textDecorationLine: 'line-through' }]}>{formatCurrency(selectedPrice)}</Text>
            <Text style={{ fontSize: 11.5, fontWeight: '900', color: '#b91c1c' }}>{campaignDeal.discountValue}% OFF</Text>
          </> : <>
            <Text style={styles.price}>{formatCurrency(selectedPrice)}</Text>
            {selectedMrp > selectedPrice && <Text style={styles.mrp}>MRP <Text style={{ textDecorationLine: 'line-through', color: '#94a3b8' }}>{formatCurrency(selectedMrp)}</Text></Text>}
          </>}
        </View>}
        {wholesale.mode === 'retail' && campaignDeal?.title ? <Text style={{ fontSize: 11, fontWeight: '700', color: '#b91c1c', marginTop: 2 }}>🔥 {campaignDeal.title}</Text> : null}
        {!isDigital && <ProductWholesaleOffer wholesale={wholesale} />}
        {!isDigital && (!currentUser || /sign in|session|unauthorized|expired/i.test(wholesale.error)) && <Pressable onPress={signInForWholesale} style={styles.wholesaleSignin}><Text style={{ color: '#166534', fontSize: 13 }}>Sign in to buy Wholesale</Text></Pressable>}
        <Text style={styles.seller}>Sold by <Text style={{ fontWeight: '700' }}>{product.sellerName}</Text></Text>
        {wholesale.mode === 'retail' && <Text style={{ marginTop: 8, color: selectedStock > 0 ? '#64748B' : '#DC2626', fontSize: 12 }}>{isDigital ? (limitedEbook && !(selectedStock > 0) ? 'Sold out' : `Digital download · available after verified payment${limitedEbook ? ` · ${selectedStock} copies left` : ''}`) : selectedStock > 0 ? `${selectedStock} available` : 'Currently out of stock'}</Text>}
      </View>

      {!isDigital ? (wholesale.mode === 'retail' && <View style={styles.card}>
        <Text style={styles.sectionTitle}><Text style={{ color: '#FF8500' }}>%</Text> Offers &amp; Coupons</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10 }}>
          <Text style={{ fontSize: 20 }}>🎁</Text>
          <View style={{ flex: 1 }}><Text style={{ fontSize: 12, fontWeight: '700' }}>Promotions &amp; Coupons</Text><Text style={{ fontSize: 10, color: '#64748b' }}>{offerSummary}</Text></View>
        </View>
        <Pressable onPress={() => { if (offers.state === 'signed-out') { ui.notify('Please sign in to see coupons.', { type: 'info' }); return; } setShowOffers(true); }}><Text style={[styles.seeAll, { color: primary }]}>See all offers →</Text></Pressable>
      </View>) : <View style={styles.card}>
        <Text style={styles.sectionTitle}>📘 E-book details</Text>
        <Text style={styles.ebook}><Text style={{ fontWeight: '700' }}>Author:</Text> {product.digital?.author || product.raw?.digital?.author || '—'}</Text>
        <Text style={styles.ebook}><Text style={{ fontWeight: '700' }}>Language:</Text> {product.digital?.language || product.raw?.digital?.language || '—'}</Text>
        <Text style={styles.ebook}><Text style={{ fontWeight: '700' }}>Format:</Text> PDF</Text>
        {(product.digital?.licenseTerms || product.raw?.digital?.licenseTerms) ? <Text style={styles.ebook}><Text style={{ fontWeight: '700' }}>License:</Text> {product.digital?.licenseTerms || product.raw?.digital?.licenseTerms}</Text> : null}
      </View>}

      {!isDigital && <View style={styles.card}>
        <Text style={styles.sectionTitle}>🚚 Delivery Details</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={theme.primaryHover} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><Circle cx="12" cy="10" r="3" /></Svg>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9, color: '#94a3b8', fontWeight: '700' }}>DELIVER TO</Text>
            <Text style={{ fontSize: 12, fontWeight: '700' }}>{getLocationDisplayName(getSelectedAddress()) || 'Set your location'}</Text>
          </View>
          <Pressable onPress={() => replaceNav('account')}><Text style={{ color: primary, fontSize: 11, fontWeight: '800' }}>Change</Text></Pressable>
        </View>
        {wholesale.mode === 'wholesale' && <Text style={styles.desc}>Delivery availability and charges are confirmed for your address in the Wholesale cart.</Text>}
        {wholesale.mode === 'retail' && isEcom && (deliveryPoint ? <View style={{ gap: 8, marginTop: 4 }}>
          {sameDay?.available && <View style={[styles.deliveryBox, { backgroundColor: '#dcfce7' }]}>
            <Text style={{ fontSize: 14 }}>⚡</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#166534' }}>Same-day delivery</Text>
              <Text style={{ fontSize: 10.5, color: '#166534', marginTop: 1 }}>Arrives by {new Date(sameDay.promisedBy).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} · +₹{sameDay.customerDeliveryCharge} for same-day</Text>
            </View>
          </View>}
          <View style={[styles.deliveryBox, { backgroundColor: '#f1f5f9' }]}>
            <Text style={{ fontSize: 14 }}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#334155' }}>Scheduled delivery</Text>
              <Text style={{ fontSize: 10.5, color: '#64748b', marginTop: 1 }}>Sent by courier · the delivery date is shown once the seller ships</Text>
            </View>
          </View>
        </View> : <Text style={styles.noAddress}>Add a delivery address to see whether this can reach you today.</Text>)}
      </View>}

      {wholesale.mode === 'retail' && returnInfo && <View style={styles.card}>
        <Text style={styles.sectionTitle}>Return Policy</Text>
        <View style={[styles.deliveryBox, { alignItems: 'center', backgroundColor: returnInfo.eligible ? '#dcfce7' : '#fee2e2' }]}>
          <Text style={{ fontSize: 14 }}>{returnInfo.eligible ? '✓' : '✕'}</Text>
          <Text style={{ fontSize: 12.5, fontWeight: '800', color: returnInfo.eligible ? '#166534' : '#991b1b' }}>{returnInfo.eligible ? `${returnInfo.returnWindowDays} Days Return Available` : 'Non-Returnable'}</Text>
        </View>
      </View>}

      <View style={[styles.card, { paddingBottom: 0 }]} onLayout={e => { infoY.current = e.nativeEvent.layout.y; }}>
        <View style={styles.tabs}>{['desc', 'details'].map(t => <Pressable key={t} onPress={() => setActiveTab(t)} style={[styles.tab, activeTab === t && { borderBottomColor: primary }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: activeTab === t ? primary : '#94a3b8', textAlign: 'center' }}>{t === 'desc' ? 'Description' : 'Product Info'}</Text>
        </Pressable>)}</View>
        <View style={{ paddingTop: 14, paddingBottom: 4 }}>
          {activeTab === 'desc' ? <Text style={styles.desc}>{product.description || 'The seller has not added a description for this product yet.'}</Text>
            : [['Seller', product.sellerName], ['Category', typeof product.category === 'object' ? product.category?.name : product.category], ['Brand', product.brandName],
              ['Variant', selectedVariant?.name && selectedVariant.name !== 'Default' ? selectedVariant.name : ''], ['Weight', formatWeight(selectedVariant?.weight)], ['Sold per', selectedVariant?.unit || product.unit],
              ['SKU', selectedVariant?.sku || product.sku], ...(selectedVariant?.attributes || []).map(a => [a.name, a.value]),
              ['Fulfillment', wholesale.mode === 'wholesale' ? 'Wholesale · confirmed at checkout' : isDigital ? 'Digital download after payment' : 'See Delivery Details above for your address']]
              .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
              .map(([k, v]) => <View key={k} style={styles.infoRow}><Text style={styles.infoKey}>{k}</Text><Text style={styles.infoVal}>{v}</Text></View>)}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>You may also like</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {related.map(rp => <Pressable key={rp.id} style={styles.related} onPress={() => (wholesale.mode === 'wholesale' ? openWholesaleProduct(rp.id, rp.variantId) : setSelectedProduct(rp))}>
            <View style={styles.relatedImg}>{rp.image ? <Image source={{ uri: imageUri(rp.image) }} style={{ width: 64, height: 64 }} contentFit="contain" /> : <Text style={{ fontSize: 9, color: '#94a3b8' }}>Image unavailable</Text>}</View>
            <View style={{ padding: 8 }}>
              <Text numberOfLines={1} style={{ fontSize: 10, fontWeight: '700' }}>{rp.name}</Text>
              <Text numberOfLines={1} style={{ fontSize: 9, color: '#94a3b8', marginBottom: 6 }}>{wholesale.mode === 'wholesale' ? rp.variants?.[0]?.unit : variantPackLabel(rp.variants?.[0] || { unit: rp.unit })}</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ fontSize: 11, fontWeight: '900' }}>{wholesale.mode === 'wholesale' ? 'From ' + formatCurrency(rp.startingPrice) : formatCurrency(rp.price)}</Text>
                <Pressable onPress={() => (wholesale.mode === 'wholesale' ? openWholesaleProduct(rp.id, rp.variantId) : addToCart(rp))} accessibilityLabel={`${wholesale.mode === 'wholesale' ? 'View Wholesale offer for' : 'Add'} ${rp.name}`} style={[styles.relatedAdd, { backgroundColor: primary }]}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '900', lineHeight: 18 }}>+</Text></Pressable>
              </View>
            </View>
          </Pressable>)}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Questions &amp; Answers</Text>
        {faqsLoading ? <Text style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center', paddingVertical: 12 }}>Loading questions…</Text>
          : faqs.length === 0 ? <Text style={{ fontSize: 12.5, color: '#94a3b8', paddingTop: 4, paddingBottom: 8 }}>{wholesaleDetail ? 'No answered questions are available for this product yet.' : 'No questions answered yet — be the first to ask.'}</Text>
            : faqs.map(faq => <View key={faq._id} style={styles.faq}><Text style={{ fontSize: 12, fontWeight: '700', marginBottom: 4 }}>Q. {faq.question}</Text><Text style={{ fontSize: 11, color: '#64748b', lineHeight: 17 }}>{faq.answer}</Text></View>)}
        {retailAvailable && !wholesaleDetail && <Pressable onPress={() => { setQuestionText(''); setQuestionError(''); setQuestionSent(false); setShowAskModal(true); }}><Text style={[styles.seeAll, { color: primary }]}>Ask a question →</Text></Pressable>}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Ratings &amp; Reviews</Text>
        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 16 }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontSize: 40, fontWeight: '900', lineHeight: 44 }}>{ratingSummary.count ? ratingSummary.average : '—'}</Text>
            <Stars rating={ratingSummary.average} size={16} />
            <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>{ratingSummary.count} {ratingSummary.count === 1 ? 'rating' : 'ratings'}</Text>
          </View>
          <View style={{ flex: 1 }}>{ratingSummary.breakdown.map(rd => <RatingBar key={rd.star} label={String(rd.star)} pct={rd.percent} count={rd.count} color={primary} />)}</View>
        </View>
        {retailAvailable && !wholesaleDetail && <>
          <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 8 }}>{myRating ? 'Your rating — add a comment below' : 'Tap to rate this product'}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
            {[1, 2, 3, 4, 5].map(i => <Pressable key={i} onPress={() => setMyRating(i)} accessibilityRole="button" accessibilityLabel={`Rate ${i} star${i === 1 ? '' : 's'}`}><Svg width={32} height={32} viewBox="0 0 24 24"><Polygon points={STAR} fill={i <= myRating ? '#f59e0b' : '#e2e8f0'} /></Svg></Pressable>)}
          </View>
          {myRating > 0 && <View style={{ marginTop: 12 }}>
            <TextInput value={myComment} onChangeText={setMyComment} placeholder="What did you think of it? (optional)" placeholderTextColor="#94a3b8" multiline numberOfLines={3} style={styles.textarea} />
            {reviewError ? <Text style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{reviewError}</Text> : null}
            <Pressable onPress={submitReview} disabled={submittingReview} style={[styles.submit, { backgroundColor: submittingReview ? '#94a3b8' : primary }]}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>{submittingReview ? 'Submitting…' : 'Submit Review'}</Text></Pressable>
          </View>}
        </>}
        <View style={{ marginTop: 16 }}>
          {reviewsLoading ? <Text style={{ fontSize: 12.5, color: '#64748b', textAlign: 'center', paddingVertical: 16 }}>Loading reviews…</Text>
            : reviews.length === 0 ? <Text style={{ fontSize: 12.5, color: '#94a3b8', textAlign: 'center', paddingVertical: 16 }}>{wholesaleDetail ? 'No approved reviews are available for this product yet.' : 'No reviews yet — be the first to review this product.'}</Text>
              : reviews.map(rev => <View key={rev._id} style={styles.review}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <View style={[styles.avatar, { backgroundColor: theme.primaryLight }]}><Text style={{ color: primary, fontSize: 12, fontWeight: '900' }}>{(rev.userName || 'S').charAt(0).toUpperCase()}</Text></View>
                  <View><Text style={{ fontSize: 11, fontWeight: '800', marginBottom: 2 }}>{rev.userName}</Text><Stars rating={rev.rating} size={11} /></View>
                  <Text style={{ marginLeft: 'auto', fontSize: 10, color: '#94a3b8' }}>{rev.createdAt ? new Date(rev.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</Text>
                </View>
                {rev.comment ? <Text style={{ fontSize: 12, color: '#475569', lineHeight: 19 }}>{rev.comment}</Text> : null}
                {Array.isArray(rev.images) && rev.images.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 10 }}>
                  {rev.images.map((url, idx) => <Image key={idx} source={{ uri: imageUri(url) }} style={styles.reviewImg} contentFit="cover" accessibilityLabel={`Review photo ${idx + 1}`} />)}
                </ScrollView>}
              </View>)}
        </View>
      </View>
    </ScrollView>

    {cartActionError ? <Text accessibilityRole="alert" style={[styles.feedback, { bottom: 84 + insets.bottom }]}>{cartActionError}</Text> : null}
    {wholesale.mode === 'wholesale' && (wholesale.error || wholesale.message) ? <Text accessibilityRole={wholesale.error ? 'alert' : undefined} style={[styles.feedback, { bottom: 84 + insets.bottom, backgroundColor: wholesale.error ? '#fef2f2' : '#f0fdf4', color: wholesale.error ? '#991b1b' : '#166534' }]}>{wholesale.error || wholesale.message}</Text> : null}
    <View style={[styles.cta, { paddingBottom: Math.max(12, insets.bottom) }]}>
      {wholesale.mode === 'wholesale' ? <>
        {wholesale.cartQty > 0
          ? <CtaBtn kind="go" disabled={wholesale.pending} onPress={wholesale.openCart} title={`Go to Wholesale Cart (${wholesale.cartQty})`} />
          : <CtaBtn kind="add" primary={primary} disabled={!wholesale.canPurchase} onPress={() => wholesale.add()} title={wholesale.pending ? 'Adding…' : 'Add to Wholesale Cart'} />}
        <CtaBtn kind="buy" primary={primary} disabled={!wholesale.canBuyNow} onPress={() => wholesale.buyNow()} title={wholesale.pending ? 'Please wait…' : 'Buy Wholesale Now'} />
      </> : <>
        {qty === 0
          ? <CtaBtn kind="add" primary={primary} disabled={disabledBuy} onPress={handleAddToCart} title={cartActionPending ? 'ADDING…' : 'ADD TO CART'} icon={<CartGlyph color={disabledBuy ? '#64748b' : primary} />} />
          : <CtaBtn kind="go" onPress={() => replaceNav('cart')} title={`GO TO CART (${qty})`} icon={<CartGlyph color="#c2410c" />} />}
        <CtaBtn kind="buy" primary={primary} disabled={disabledBuy} onPress={handleBuyNow} title={cartActionPending ? 'PLEASE WAIT…' : 'BUY NOW'} icon={<BoltIcon size={18} color={disabledBuy ? '#64748b' : '#fff'} />} />
      </>}
    </View>

    <Sheet visible={variantSheet} onClose={() => setVariantSheet(false)}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', marginBottom: 10 }}>Choose pack / variant</Text>
        {productVariants.map(variant => {
          const vid = String(variant.id || variant._id || '');
          const attrs = (variant.attributes || []).map(a => `${a.name}: ${a.value}`).join(', ');
          const out = !isDigital && Number(variant.stock) < 1;
          return <Pressable key={vid} disabled={out} onPress={() => chooseVariant(vid)} style={[styles.variantOption, vid === String(selectedVariantId) && { borderColor: primary, backgroundColor: theme.primaryLight }, out && { opacity: 0.5 }]}>
            <Text style={{ fontSize: 14 }}>{variant.name}{attrs ? ` · ${attrs}` : ''}{wholesale.mode === 'retail' ? ` · ${formatCurrency(variant.price)}` : ''}{out ? ' · Out of stock' : ''}</Text>
          </Pressable>;
        })}
      </ScrollView>
    </Sheet>

    <Sheet visible={showOffers} onClose={() => setShowOffers(false)}>
      <ScrollView contentContainerStyle={{ paddingVertical: 18, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <Text style={{ fontSize: 16, color: '#172B4D', fontWeight: '700' }}>Offers &amp; Coupons</Text>
          <Pressable onPress={() => setShowOffers(false)} accessibilityLabel="Close offers" hitSlop={10}><Text style={{ fontSize: 20 }}>×</Text></Pressable>
        </View>
        {offers.state === 'loading' && <Text>Checking offers…</Text>}
        {offers.state === 'error' && <Text accessibilityRole="alert">{offers.message || 'Offers could not be loaded right now.'}</Text>}
        {offers.state === 'ready' && !offers.items.length && <Text>No coupons are running right now.</Text>}
        {offers.items.map(coupon => <View key={coupon.code} style={styles.couponCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 14, letterSpacing: 0.5, color: '#C2410C', fontWeight: '700' }}>{coupon.code}</Text>
            <Text style={{ fontSize: 11, fontWeight: '700', color: coupon.applicable ? '#15803D' : '#64748B' }}>{coupon.applicable ? 'Applies to your cart' : offers.cartSubtotal === 0 ? 'Check in cart' : 'Not usable yet'}</Text>
          </View>
          {coupon.title ? <Text style={{ marginTop: 6, fontSize: 13, fontWeight: '700', color: '#172B4D' }}>{coupon.title}</Text> : null}
          <Text style={{ marginTop: 4, fontSize: 12.5, color: '#475569' }}>{describeCoupon(coupon)}</Text>
          {!coupon.applicable && offers.cartSubtotal !== 0 && coupon.reason ? <Text style={{ marginTop: 4, fontSize: 11.5, color: '#64748B' }}>{coupon.reason}</Text> : null}
          {coupon.expiresAt ? <Text style={{ marginTop: 4, fontSize: 11, color: '#94A3B8' }}>Valid till {new Date(coupon.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text> : null}
        </View>)}
        <Text style={{ marginTop: 6, fontSize: 11.5, color: '#64748B' }}>{offers.cartSubtotal === 0 ? 'Add this product to your cart to check coupon eligibility. The best eligible offer is applied automatically.' : 'Offers are checked against your current cart. The best eligible offer is applied automatically; you can change or remove it at checkout.'}</Text>
      </ScrollView>
    </Sheet>

    <Modal visible={showAskModal} transparent animationType="slide" statusBarTranslucent onRequestClose={() => !submittingQuestion && setShowAskModal(false)}>
      <KeyboardAvoidingView behavior="height" style={styles.askOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !submittingQuestion && setShowAskModal(false)} />
        <View style={styles.askCard}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Text style={{ fontSize: 15, fontWeight: '800' }}>Ask a question</Text>
            <Pressable onPress={() => setShowAskModal(false)} accessibilityLabel="Close" hitSlop={10}><Text style={{ fontSize: 18, color: '#64748b' }}>✕</Text></Pressable>
          </View>
          {questionSent ? <View style={{ alignItems: 'center', paddingVertical: 20 }}>
            <Text style={{ fontSize: 13.5, color: '#166534', fontWeight: '700', marginBottom: 16, textAlign: 'center' }}>Thank you! Your question has been submitted and a seller will answer it soon.</Text>
            <Pressable onPress={() => setShowAskModal(false)} style={{ paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: primary }}><Text style={{ color: '#fff', fontWeight: '800' }}>Close</Text></Pressable>
          </View> : <>
            <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Asking about <Text style={{ fontWeight: '700' }}>{product.name}</Text></Text>
            <TextInput value={questionText} onChangeText={setQuestionText} placeholder="e.g. Does this come with a warranty?" placeholderTextColor="#94a3b8" multiline numberOfLines={3} autoFocus style={styles.textarea} />
            {questionError ? <Text style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>{questionError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable onPress={() => setShowAskModal(false)} disabled={submittingQuestion} style={[styles.askBtn, { borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff' }]}><Text style={{ color: '#475569', fontSize: 13, fontWeight: '800' }}>Cancel</Text></Pressable>
              <Pressable onPress={submitQuestion} disabled={submittingQuestion || !questionText.trim()} style={[styles.askBtn, { backgroundColor: submittingQuestion || !questionText.trim() ? '#94a3b8' : primary }]}><Text style={{ color: '#fff', fontSize: 13, fontWeight: '900' }}>{submittingQuestion ? 'Submitting…' : 'Submit Question'}</Text></Pressable>
            </View>
          </>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

function CtaBtn({ kind, title, onPress, disabled, icon, primary }) {
  const look = disabled ? { backgroundColor: '#e2e8f0', borderWidth: 0 }
    : kind === 'add' ? { backgroundColor: '#fff', borderWidth: 2, borderColor: primary }
      : kind === 'go' ? { backgroundColor: '#fff7ed', borderWidth: 2, borderColor: '#ea580c' }
        : { backgroundColor: primary, borderWidth: 2, borderColor: primary };
  const color = disabled ? '#64748b' : kind === 'add' ? primary : kind === 'go' ? '#c2410c' : '#fff';
  return <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={[styles.ctaBtn, look]}>{icon}<Text style={{ color, fontSize: 13, fontWeight: '900', letterSpacing: 0.3, textAlign: 'center', flexShrink: 1 }}>{title}</Text></Pressable>;
}

const styles = StyleSheet.create({
  linkState: { margin: 16, padding: 20, borderRadius: 14, backgroundColor: '#fff', gap: 10, alignItems: 'center' },
  linkBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  linkBtnText: { fontWeight: '700' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, backgroundColor: 'rgba(255,255,255,0.95)', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', zIndex: 50 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  hero: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 24, minHeight: 240 },
  offerBadge: { position: 'absolute', top: 16, left: 16, backgroundColor: '#ff8500', color: '#fff', fontSize: 10, fontWeight: '900', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20, overflow: 'hidden' },
  thumb: { width: 58, height: 58, borderRadius: 12, borderWidth: 2, borderColor: '#e2e8f0', backgroundColor: '#f8fafc', padding: 3 },
  infoCard: { backgroundColor: '#fff', padding: 16, borderBottomWidth: 8, borderBottomColor: '#f1f5f9' },
  infoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  name: { fontSize: 17, fontWeight: '900', color: '#0f172a', lineHeight: 22, marginBottom: 2 },
  pack: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  viewDetails: { borderWidth: 1.5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8 },
  select: { minHeight: 42, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  ratingCount: { fontSize: 11, color: '#475569', fontWeight: '600' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6 },
  price: { fontSize: 24, fontWeight: '900', color: '#0f172a' },
  mrp: { fontSize: 12, color: '#94a3b8' },
  wholesaleSignin: { marginTop: 12, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 12, alignSelf: 'flex-start' },
  seller: { fontSize: 11, color: '#64748b', marginTop: 8 },
  card: { backgroundColor: '#fff', padding: 16, marginTop: 8, borderBottomWidth: 8, borderBottomColor: '#f1f5f9' },
  sectionTitle: { marginBottom: 12, fontSize: 13, fontWeight: '800', color: '#0f172a' },
  seeAll: { fontSize: 11, fontWeight: '800' },
  ebook: { fontSize: 12.5, color: '#475569', lineHeight: 20 },
  desc: { fontSize: 12, color: '#475569', lineHeight: 20 },
  deliveryBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 9, paddingHorizontal: 11, borderRadius: 10 },
  noAddress: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#f1f5f9', fontSize: 11, color: '#64748b', fontWeight: '600', marginTop: 4, overflow: 'hidden' },
  tabs: { flexDirection: 'row', borderBottomWidth: 2, borderBottomColor: '#f1f5f9' },
  tab: { flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 2.5, borderBottomColor: 'transparent', marginBottom: -2 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  infoKey: { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  infoVal: { fontSize: 11, color: '#0f172a', fontWeight: '700', textAlign: 'right', maxWidth: '60%' },
  related: { width: '31.5%', backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', overflow: 'hidden' },
  relatedImg: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', height: 80, padding: 8 },
  relatedAdd: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  faq: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  textarea: { width: '100%', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', fontSize: 13, minHeight: 80, textAlignVertical: 'top', color: '#0f172a' },
  submit: { marginTop: 10, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  review: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reviewImg: { width: 72, height: 72, borderRadius: 10, borderWidth: 1.5, borderColor: '#e2e8f0' },
  feedback: { position: 'absolute', left: 12, right: 12, zIndex: 101, padding: 12, borderRadius: 10, backgroundColor: '#fef2f2', color: '#991b1b', fontSize: 13, overflow: 'hidden' },
  cta: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingTop: 12, paddingHorizontal: 16, backgroundColor: '#fff', borderTopWidth: 1.5, borderTopColor: '#e2e8f0', elevation: 12 },
  ctaBtn: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 13, borderRadius: 12 },
  variantOption: { padding: 14, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, marginBottom: 8 },
  couponCard: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#FDBA74', borderRadius: 12, padding: 12, marginBottom: 10, backgroundColor: '#FFF7ED' },
  askOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', justifyContent: 'flex-end', padding: 12 },
  askCard: { backgroundColor: '#fff', borderRadius: 20, padding: 18, maxHeight: '90%' },
  askBtn: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
});

