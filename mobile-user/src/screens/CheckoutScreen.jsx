// Port of modules/User/pages/CheckoutPage.jsx. Order totals, delivery charges, coupons and tips are the server's;
// the screen only collects choices. Double submission is blocked (ref lock + disabled button), checkout requests
// carry the web's Idempotency-Key, and an uncertain outcome leads to the status check instead of a second order.
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { mediaUrl, request } from '../api/client';
import { session } from '../lib/storage';
import { useFeedback } from '../lib/feedback';
import { committedCheckouts, forgetCommittedCheckout, deferCommittedCheckout } from '../lib/committedCheckout';
import { DELIVERY_LABEL } from '../lib/deliveryLabel';
import { paymentSummary } from '../lib/paymentSummary';
import { getCurrentPosition } from '../lib/gps';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import { CustomerPage } from '../components/Shell';
import { Text } from '../components/ui';
import { ChevronLeft } from '../components/icons';
import LandmarkImagePicker from '../components/LandmarkImagePicker';
import CommittedCheckoutReview from '../components/CommittedCheckoutReview';
import { BasketGroups, CartAlert, CartEmptyState, CouponThresholdProgress, PrimaryButton, ProductGstBreakdown, SecondaryButton } from '../components/cart/CartUI';

const RECOVERY_CODES = ['CHECKOUT_DATA_CONFLICT', 'CHECKOUT_OUTCOME_UNCERTAIN', 'CHECKOUT_IN_PROGRESS', 'CHECKOUT_SAVE_FAILED', 'CHECKOUT_RESULT_UNAVAILABLE'];

function Card({ children, style }) {
  const theme = useAppTheme();
  return <View style={[styles.card, { borderColor: theme.border }, style]}>{children}</View>;
}
function Radio({ selected, color }) {
  return <View style={[styles.radio, { borderColor: selected ? color : '#94a3b8' }]}>{selected && <View style={[styles.radioDot, { backgroundColor: color }]} />}</View>;
}
function Row({ label, value, color, weight = '600', valueColor }) {
  return <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
    <Text style={{ color: color || '#64748b', fontSize: 13, flexShrink: 1, fontWeight: color ? weight : '400' }}>{label}</Text>
    {typeof value === 'string' ? <Text style={{ fontWeight: weight, color: valueColor || color || '#172b4d', fontSize: 13 }}>{value}</Text> : value}
  </View>;
}

export default function CheckoutScreen() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const ui = useFeedback();
  const navigate = usePromotionNavigation();
  const {
    savedAddresses, selectedAddressId, setSelectedAddressId, addAddress, updateAddress, deleteAddress, uploadLandmarkImage,
    getCartItems, placeOrder, placeUnifiedOrder, abandonCheckoutPayment, checkCheckoutStatus, initiateOnlinePayment,
    setActiveNav, setSelectedOrder, getDeliveryPoint, getPricingPoint, serverCart, cartChannel, cartLoading,
    appliedCoupon, applyCoupon, availableCoupons, removeCoupon, couponCode, couponNotice, tipSetting, fetchTipSetting,
    walletBalance, fetchWalletBalance, currentUser, switchCartChannel,
  } = useUser();
  const primary = theme.primaryColor;
  useEffect(() => { fetchWalletBalance(); fetchTipSetting?.(); }, [fetchWalletBalance, fetchTipSetting]);

  const unified = useUnifiedCart((getPricingPoint || getDeliveryPoint)(), couponCode, 'basket');
  const groups = unified.data?.groups || [];
  const basketItems = unified.data ? unified.basketItems : (serverCart?.items || []);
  const isDigitalCart = basketItems.length > 0 && basketItems.every(item => item.fulfillmentType === 'digital');
  const hasMixedFulfillment = basketItems.some(item => item.fulfillmentType === 'digital') && !isDigitalCart;
  const hasWholesale = groups.some(group => group.salesChannel === 'wholesale');
  const isUnified = !isDigitalCart && (hasWholesale || groups.length > 1 || (groups.length === 1 && groups[0].channel !== cartChannel));
  const basketCheckout = isUnified && unified.data?.purchaseMode === 'basket';
  const checkoutOperation = basketCheckout ? 'basket' : isUnified ? 'unified' : isDigitalCart ? 'digital' : 'single';
  const canTip = !isDigitalCart && (!hasWholesale || groups.some(group => group.salesChannel === 'retail'));
  const checkoutBlocked = unified.loading || Boolean(unified.error) || !unified.data || unified.data.valid === false || !basketItems.length || hasMixedFulfillment || (isUnified && Boolean(appliedCoupon || couponCode));
  useEffect(() => {
    if (groups.length === 1 && groups[0].salesChannel !== 'wholesale' && groups[0].channel !== cartChannel) switchCartChannel?.(groups[0].channel);
  }, [groups[0]?.channel, groups.length, cartChannel, hasWholesale, switchCartChannel]); // eslint-disable-line react-hooks/exhaustive-deps

  const [paymentMethod, setPaymentMethod] = useState('Cash on Delivery');
  useEffect(() => { if (isDigitalCart) setPaymentMethod('Online Payment'); }, [isDigitalCart]);
  const [isOrdering, setIsOrdering] = useState(false);
  const orderingRef = useRef(false);
  const [showBillBreakdown, setShowBillBreakdown] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [placedOrderDetails, setPlacedOrderDetails] = useState(null);
  const [placedOrders, setPlacedOrders] = useState([]);
  const [placedPaymentAmount, setPlacedPaymentAmount] = useState(null);

  const [couponInput, setCouponInput] = useState('');
  const [couponMessage, setCouponMessage] = useState(null);
  const [couponMessageType, setCouponMessageType] = useState('success');
  const [applying, setApplying] = useState(false);
  const [showOffers, setShowOffers] = useState(false);

  const [tipChip, setTipChip] = useState(null);
  const [tipCustomInput, setTipCustomInput] = useState('');
  const [isCustomTip, setIsCustomTip] = useState(false);
  const minCustomTip = Number(tipSetting?.minCustomAmount) || 1;
  const maxCustomTip = Number(tipSetting?.maxCustomAmount) || 1000;
  const rawCustomTipVal = tipCustomInput.trim() === '' ? null : Number(tipCustomInput);
  let customTipError = '', validCustomTip = 0;
  if (isCustomTip && rawCustomTipVal !== null) {
    if (!Number.isFinite(rawCustomTipVal) || rawCustomTipVal <= 0) customTipError = 'Please enter a valid amount.';
    else if (rawCustomTipVal < minCustomTip) customTipError = `Minimum tip is ₹${minCustomTip}`;
    else if (rawCustomTipVal > maxCustomTip) customTipError = `Maximum tip is ₹${maxCustomTip}`;
    else validCustomTip = Math.floor(rawCustomTipVal);
  }
  const tipAmount = canTip ? (tipChip ?? (isCustomTip ? validCustomTip : 0)) : 0;
  const tipOptions = Array.isArray(tipSetting?.options) ? tipSetting.options : [];

  const applyCouponCode = async code => {
    if (!code || applying) return;
    setApplying(true); setCouponMessage(null);
    const res = await applyCoupon(code);
    setApplying(false);
    setCouponMessage(res.message); setCouponMessageType(res.success ? 'success' : 'error');
    if (res.success) { setCouponInput(''); setShowOffers(false); }
  };
  const shopMoreForCoupon = offer => {
    if (offer.shopMore?.type === 'product') navigate({ type: 'PRODUCT', id: offer.shopMore.id });
    else if (offer.shopMore?.type === 'category') navigate({ type: 'CATEGORY', id: offer.shopMore.id, slug: offer.shopMore.id });
    else setActiveNav('categories');
  };

  // Address form
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [house, setHouse] = useState(''), [street, setStreet] = useState(''), [city, setCity] = useState(''), [pincode, setPincode] = useState('');
  const [addressType, setAddressType] = useState('Home');
  const [addressFormError, setAddressFormError] = useState('');
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const customerName = (currentUser?.name || '').trim();
  const customerPhone = (currentUser?.phone || '').trim();
  const isProfileComplete = Boolean(customerName && customerPhone);
  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);
  const [landmarkImgUrl, setLandmarkImgUrl] = useState('');

  const handleUseCurrentLocation = async () => {
    setLocating(true); setLocationError(null);
    let position;
    try { position = await getCurrentPosition({ timeout: 15000 }); }
    catch (err) {
      setLocating(false);
      const messages = { 1: 'You blocked location access. Allow it, or type your address below.', 2: 'Your location could not be determined right now.', 3: 'Finding your location took too long. Please try again.' };
      setLocationError(messages[err.code] || 'Could not read your location.');
      return;
    }
    const lat = Number(position.coords.latitude.toFixed(6)), lng = Number(position.coords.longitude.toFixed(6));
    const accuracy = Math.round(position.coords.accuracy || 0);
    setCoords({ lat, lng, accuracy });
    try {
      const { ok, body } = await request(`/api/geo/reverse?lat=${lat}&lng=${lng}&accuracy=${accuracy}`);
      if (!ok) { setLocationError((body.message || 'Could not look up your address.') + ' Your location is pinned — please fill in the address below.'); return; }
      const a = body.data || {};
      if (a.address) setHouse(a.address);
      if (a.city) setCity(a.city);
      if (a.pincode) setPincode(a.pincode);
    } catch { setLocationError('Could not reach the address service. Your location is pinned — please fill in the address below.'); }
    finally { setLocating(false); }
  };

  const summary = paymentSummary(isUnified ? unified.data?.totals : serverCart?.pricing, { tipAmount });
  const grandTotalVal = summary.totalAmount;
  const items = unified.data ? unified.basketItems : getCartItems();
  const [fallbackSeller, setFallbackSeller] = useState(null);
  const quickGroup = groups.find(g => g.channel === 'grocery');
  const isQuickCommerceCart = cartChannel === 'grocery' || serverCart?.channel === 'grocery' || Boolean(quickGroup) || (Array.isArray(items) && items.some(i => i.type === 'grocery' || i.channel === 'grocery'));
  const quickCommerceSeller = quickGroup?.seller || serverCart?.seller || groups.find(g => g.seller)?.seller || fallbackSeller || null;
  useEffect(() => {
    if (!isQuickCommerceCart || quickCommerceSeller) return;
    const targetSellerId = items?.[0]?.sellerId || serverCart?.items?.[0]?.sellerId || quickGroup?.items?.[0]?.sellerId;
    if (!targetSellerId) return;
    request(`/api/sellers/public/${targetSellerId}`, { auth: false }).then(({ body }) => { if (body.success && body.data) setFallbackSeller(body.data); }).catch(() => {});
  }, [isQuickCommerceCart, quickCommerceSeller, items, serverCart, quickGroup]);

  const closeAddressForm = () => {
    setShowAddressForm(false); setEditingAddressId(null); setHouse(''); setStreet(''); setCity(''); setPincode('');
    setAddressType('Home'); setCoords(null); setLandmarkImgUrl(''); setAddressFormError(''); setLocationError(null);
  };
  const handleAddAddress = async () => {
    if (savingAddress) return;
    setAddressFormError('');
    if (!customerName || !customerPhone) { setAddressFormError('Please complete your profile name and mobile number before saving an address.'); return; }
    if (!house || !city || !pincode) { setAddressFormError('Please fill in Flat/House No., City, and Pincode.'); return; }
    const details = { name: customerName, phone: customerPhone, line1: house, line2: street, city, state: 'Madhya Pradesh', pincode, lat: coords?.lat, lng: coords?.lng, label: addressType, landmarkImage: landmarkImgUrl || null };
    setSavingAddress(true);
    const res = editingAddressId ? await updateAddress(editingAddressId, details) : await addAddress(details);
    setSavingAddress(false);
    if (res && res.ok === false) { setAddressFormError(res.message || 'Could not save the address'); return; }
    if (editingAddressId) setSelectedAddressId(editingAddressId);
    closeAddressForm();
  };
  const startEditAddress = addr => {
    setEditingAddressId(addr._id || addr.id); setHouse(addr.line1 || addr.house || ''); setStreet(addr.line2 || addr.street || '');
    setCity(addr.city || ''); setPincode(addr.pincode || ''); setAddressType(addr.label || 'Home'); setCoords(null);
    setLandmarkImgUrl(addr.landmarkImage || ''); setAddressFormError(''); setShowAddressForm(true);
  };
  const confirmDeleteAddress = addrId => ui.perform({ title: 'Delete this address?', message: 'Remove this saved address from your account?', confirmLabel: 'Delete', destructive: true }, async () => {
    const res = await deleteAddress(addrId);
    if (res && res.ok === false) ui.notify(res.message || 'Failed to delete address');
    else if (String(editingAddressId) === String(addrId)) closeAddressForm();
    return res;
  });

  const [, refreshCommittedReference] = useState(0);
  const recoveryCustomerId = currentUser?._id || currentUser?.id;
  const committedReference = committedCheckouts(recoveryCustomerId).find(reference => !reference.deferred);
  const [orderError, setOrderError] = useState('');
  const [orderConflict, setOrderConflict] = useState(() => {
    for (const operation of ['basket', 'wholesale', 'unified', 'single', 'digital']) {
      if (session.getItem('bulkimart:checkout:' + operation + ':' + (currentUser?._id || currentUser?.id || 'customer'))) return { code: 'CHECKOUT_OUTCOME_UNCERTAIN', operation };
    }
    return null;
  });
  const [checkingCheckout, setCheckingCheckout] = useState(false);
  const recoveryRequired = Boolean(orderConflict && RECOVERY_CODES.includes(orderConflict.code) && !orderConflict.retryAllowed);

  const handleCheckoutRecovery = async () => {
    if (checkingCheckout) return;
    setCheckingCheckout(true);
    try {
      const result = await checkCheckoutStatus(orderConflict.operation || checkoutOperation);
      if (!result.ok) { setOrderError(result.message); return; }
      if (result.data?.state === 'completed' && result.data.orders?.length) { setActiveNav('orders'); return; }
      const retryAllowed = result.data?.state === 'not_found' && result.data.canRetrySameKey === true;
      setOrderConflict(current => ({ ...current, retryAllowed }));
      setOrderError(result.data?.state === 'not_found' ? 'No committed checkout was found. Once the conflict is resolved, you can retry using the same checkout session.' : result.message);
    } finally { setCheckingCheckout(false); }
  };

  const showSuccess = (firstOrder, orders) => { fetchWalletBalance(); setPlacedOrderDetails(firstOrder); setPlacedOrders(orders); setOrderSuccess(true); };
  const handlePlaceOrder = async () => {
    if (committedReference || orderingRef.current || isOrdering || cartLoading || checkoutBlocked || recoveryRequired || !basketItems.length) return;
    if (hasMixedFulfillment) { setOrderError('Digital and physical products require separate checkout. Remove one type and check out each group separately.'); return; }
    if (isCustomTip && customTipError) { setOrderError(customTipError); return; }
    orderingRef.current = true; setIsOrdering(true); setOrderError(''); setOrderConflict(null);
    const previousReferences = new Set(committedCheckouts(recoveryCustomerId).map(reference => reference.key));
    const res = isUnified
      ? await placeUnifiedOrder(paymentMethod, tipAmount, ...(basketCheckout ? [{ purchaseMode: 'basket', quoteHash: unified.data.quoteHash, basketHash: unified.data.basketHash }] : []))
      : await placeOrder(paymentMethod, tipAmount);
    if (!res.ok) {
      orderingRef.current = false; setIsOrdering(false);
      setOrderError(res.message || 'Could not place your order');
      setOrderConflict(res.status === 409 || RECOVERY_CODES.includes(res.code) ? { ...res, operation: basketCheckout ? 'basket' : res.operation } : null);
      return;
    }
    const firstOrder = res.order || res.orders?.[0];
    setPlacedPaymentAmount(res.payment?.amount ?? firstOrder?.pricing?.totalAmount ?? null);
    if (paymentMethod === 'Online Payment') {
      const pay = await initiateOnlinePayment(firstOrder._id);
      orderingRef.current = false; setIsOrdering(false);
      if (pay.ok && pay.redirectUrl) { Linking.openURL(pay.redirectUrl).catch(() => {}); return; }
      if (pay.ok && pay.verified) {
        const paidKey = res.checkoutKey || committedCheckouts(recoveryCustomerId).find(reference => !previousReferences.has(reference.key))?.key;
        if (paidKey) forgetCommittedCheckout(recoveryCustomerId, paidKey);
        showSuccess(firstOrder, res.orders || [firstOrder]);
        return;
      }
      if (pay.cancelled) {
        const pendingKey = res.checkoutKey || committedCheckouts(recoveryCustomerId).find(reference => !previousReferences.has(reference.key))?.key;
        orderingRef.current = true; setIsOrdering(true);
        const cancellation = await abandonCheckoutPayment(firstOrder._id);
        orderingRef.current = false; setIsOrdering(false);
        if (!cancellation.ok || (!cancellation.cancelled && cancellation.status !== 'paid')) {
          setOrderError(cancellation.message || 'Check payment status before trying again.');
          setOrderConflict({ code: 'CHECKOUT_OUTCOME_UNCERTAIN', operation: checkoutOperation });
          return;
        }
        if (pendingKey) forgetCommittedCheckout(recoveryCustomerId, pendingKey);
        if (cancellation.status === 'paid') { showSuccess(firstOrder, res.orders || [firstOrder]); return; }
        void unified.reload();
        setOrderError('Payment was cancelled. You can retry payment or select another payment method.');
        setOrderSuccess(false); setPlacedOrderDetails(null); setPlacedOrders([]);
        return;
      }
      setOrderError(pay.message || 'Payment could not be confirmed. Check its status before trying again.');
      setOrderConflict({ code: 'CHECKOUT_OUTCOME_UNCERTAIN', operation: checkoutOperation });
      setOrderSuccess(false);
      return;
    }
    orderingRef.current = false; setIsOrdering(false);
    showSuccess(firstOrder, res.orders || (res.order ? [res.order] : []));
  };

  const errorBanner = orderError || recoveryRequired ? <View style={styles.errorBanner} accessibilityRole="alert">
    <Text style={{ color: '#b91c1c', fontSize: 12.5, lineHeight: 19 }}>{orderError || 'Check your previous checkout before placing another order.'}</Text>
    {orderConflict && <View style={{ marginTop: 8, gap: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
      <SecondaryButton title="Check My Orders" onPress={() => setActiveNav('orders')} />
      {RECOVERY_CODES.includes(orderConflict.code) && <SecondaryButton title={checkingCheckout ? 'Checking order status…' : 'Check checkout status'} disabled={checkingCheckout} onPress={handleCheckoutRecovery} />}
      {![...RECOVERY_CODES, 'IDEMPOTENCY_KEY_REUSED'].includes(orderConflict.code) && <SecondaryButton title="Refresh basket" onPress={() => unified.reload()} />}
      {orderConflict.requestId ? <Text style={{ fontSize: 11, color: '#64748b', width: '100%' }}>Support reference: {orderConflict.requestId}</Text> : null}
    </View>}
  </View> : null;

  const header = <View style={[styles.header, { borderBottomColor: theme.border }]}>
    <Pressable onPress={() => setActiveNav('cart')} accessibilityLabel="Go to Cart" style={styles.back}><ChevronLeft size={24} width={2.5} color={theme.textPrimary} /></Pressable>
    <Text style={styles.title}>Checkout</Text>
    <View style={{ width: 44 }} />
  </View>;

  if (committedReference && isOrdering) return <CustomerPage protectedPage nav={false} headerColor="#fff">{header}<View style={{ padding: 24 }} accessibilityLiveRegion="polite"><Text style={{ fontSize: 22, fontWeight: '800' }}>Complete your payment</Text><Text>Use the secure payment window to finish checkout.</Text></View></CustomerPage>;
  if (committedReference) return <CustomerPage protectedPage nav={false} headerColor="#fff">{header}<CommittedCheckoutReview key={recoveryCustomerId + ':' + committedReference.key} reference={committedReference} onPay={initiateOnlinePayment}
    onContinueCheckout={() => { deferCommittedCheckout(recoveryCustomerId, committedReference.key); setOrderSuccess(false); setOrderError(''); setPlacedOrderDetails(null); setPlacedOrders([]); refreshCommittedReference(v => v + 1); }}
    onOrders={() => setActiveNav('orders')}
    onResolved={key => { forgetCommittedCheckout(recoveryCustomerId, key); setOrderSuccess(false); setOrderError(''); setPlacedOrderDetails(null); setPlacedOrders([]); refreshCommittedReference(v => v + 1); setActiveNav('home'); }} /></CustomerPage>;

  if (orderSuccess && placedOrderDetails) {
    const statusSequence = ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery', 'delivered'];
    const currentIndex = statusSequence.indexOf(placedOrderDetails.status || 'placed');
    const timelineSteps = [
      { label: 'Order Placed', desc: 'We have received your order.', status: 'placed' },
      { label: 'Confirmed', desc: 'Seller has accepted your order.', status: 'confirmed' },
      { label: 'Dispatched', desc: 'Ready for rider pickup.', status: 'dispatched' },
      { label: 'Out for Delivery', desc: 'Rider is on the way to your address.', status: 'out_for_delivery' },
      { label: 'Delivered', desc: 'Order successfully delivered.', status: 'delivered' },
    ].map(step => {
      const stepIndex = statusSequence.indexOf(step.status);
      const entry = placedOrderDetails.timeline?.find(t => t.status === step.status);
      return { ...step, done: stepIndex !== -1 && stepIndex <= currentIndex, time: entry ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null };
    });
    const a = placedOrderDetails.shippingAddress || {};
    const addrText = `${a.line1 || a.address || ''}${a.line2 ? ', ' + a.line2 : ''}, ${a.city || ''} - ${a.pincode || ''}`;
    return <CustomerPage protectedPage nav={false}>
      <ScrollView contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 16, gap: 16, paddingBottom: 24 + insets.bottom }}>
        {errorBanner}
        <View style={{ alignItems: 'center', gap: 10, marginTop: 20, marginBottom: 10 }}>
          <View style={[styles.successIcon, { backgroundColor: theme.primaryLight, borderColor: primary }]}><Text style={{ color: primary, fontSize: 32 }}>✓</Text></View>
          <Text style={styles.successTitle}>{orderError ? 'Orders created · Review status' : 'Order Placed Successfully!'}</Text>
          {placedOrders.length > 1 ? <Text style={{ fontSize: 13, color: theme.textSecondary, fontWeight: '600' }}>{placedOrders.length} orders created</Text>
            : <Text style={[styles.orderBadge, { backgroundColor: theme.primaryLight, color: primary }]}>Order ID: {placedOrderDetails.orderNo || placedOrderDetails._id || placedOrderDetails.id}</Text>}
        </View>
        {placedOrders.length > 1 && <Card>
          <Text style={styles.cardEyebrow}>{placedOrders.length} orders created</Text>
          <Text style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 12 }}>Your basket is arriving as separate deliveries. Tap one to track it.</Text>
          {placedOrders.map(o => {
            const label = o.deliveryMode ? DELIVERY_LABEL[o.deliveryMode] : null;
            const text = o.salesChannel === 'wholesale' ? 'Wholesale' : label ? label.text : o.type === 'grocery' ? 'Quick Commerce' : 'E-Commerce';
            return <Pressable key={o._id} onPress={() => setSelectedOrder(o)} style={[styles.orderRow, { borderColor: theme.border }]}>
              <View style={{ flexShrink: 1, gap: 3 }}>
                <Text style={{ fontWeight: '800', fontSize: 12.5 }}>{o.orderNo || o._id}</Text>
                <Text style={{ fontSize: 11, color: '#94a3b8' }}>{label ? label.icon : '⚡'} {text} · {o.items?.length || 0} item{(o.items?.length || 0) === 1 ? '' : 's'}</Text>
              </View>
              <Text style={{ fontWeight: '800', fontSize: 12.5 }}>₹{o.pricing?.totalAmount} ›</Text>
            </Pressable>;
          })}
        </Card>}
        <Card>
          <Text style={styles.cardEyebrow}>Delivery Details Summary</Text>
          <View style={{ gap: 10 }}>
            <Row label="Payment Mode" value={String(placedOrderDetails.paymentMethod || '').toUpperCase()} weight="700" />
            <Row label="Estimated Delivery" value={placedOrderDetails.estimatedDelivery || 'See each order for delivery updates'} weight="700" valueColor={primary} />
            <Row label="Order Amount" value={placedPaymentAmount != null ? '₹' + placedPaymentAmount : 'See individual orders'} weight="800" />
            <View style={{ borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 10, marginTop: 4 }}>
              <Text style={{ color: theme.textSecondary, marginBottom: 4, fontSize: 13 }}>Delivery Address:</Text>
              <Text style={{ fontWeight: '600', lineHeight: 18, fontSize: 13 }}>{addrText}</Text>
            </View>
          </View>
        </Card>
        <Card>
          <Text style={[styles.cardEyebrow, { marginBottom: 16 }]}>Fulfillment Live Timeline</Text>
          <View style={{ gap: 20 }}>{timelineSteps.map((step, idx) => <View key={idx} style={{ flexDirection: 'row', gap: 12 }}>
            {idx < timelineSteps.length - 1 && <View style={{ position: 'absolute', left: 9, top: 20, bottom: -22, width: 2, backgroundColor: step.done ? primary : '#e2e8f0' }} />}
            <View style={[styles.dot, { backgroundColor: step.done ? primary : '#fff', borderColor: step.done ? primary : '#cbd5e1' }]}>{step.done && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>✓</Text>}</View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: step.done ? theme.textPrimary : '#94a3b8' }}>{step.label}</Text>
              <Text style={{ fontSize: 11, color: '#94a3b8' }}>{step.desc} {step.time ? `• ${step.time}` : ''}</Text>
            </View>
          </View>)}</View>
        </Card>
        <View style={{ gap: 10, marginTop: 12 }}>
          <PrimaryButton title="Track Order" onPress={() => setSelectedOrder(placedOrderDetails)} />
          <Pressable onPress={() => setActiveNav('home')} style={[styles.homeBtn, { borderColor: theme.border }]}><Text style={{ fontWeight: '700', fontSize: 14 }}>Go back to Home Feed</Text></Pressable>
        </View>
      </ScrollView>
    </CustomerPage>;
  }

  if (!unified.loading && unified.data && !basketItems.length && !recoveryRequired) return <CustomerPage protectedPage nav={false} headerColor="#fff">{header}<ScrollView contentContainerStyle={{ padding: 12 }}><CartEmptyState onBrowse={() => setActiveNav('home')} /></ScrollView></CustomerPage>;

  const paymentOption = (key, icon, title, sub, { hidden, disabled, right } = {}) => hidden ? null : <Pressable key={key} disabled={disabled} onPress={() => setPaymentMethod(key)} accessibilityRole="radio" accessibilityState={{ selected: paymentMethod === key, disabled: !!disabled }}
    style={[styles.select, { borderColor: paymentMethod === key ? primary : theme.border, backgroundColor: paymentMethod === key ? theme.primaryLight : '#fff' }, disabled && { opacity: 0.85 }]}>
    <Radio selected={paymentMethod === key} color={primary} />
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 1 }}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
        <View style={{ flexShrink: 1 }}><Text style={{ fontSize: 13, fontWeight: '800' }}>{title}</Text><Text style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</Text></View>
      </View>
      {right}
    </View>
  </Pressable>;
  const ctaDisabled = isOrdering || cartLoading || checkoutBlocked || recoveryRequired;
  const billRows = <View style={{ gap: 10 }}>
    <Row label="Items Subtotal" value={`₹${summary.subtotal.toFixed(2)}`} />
    <ProductGstBreakdown tax={summary.productTax} subtotalIncludesAddedGst={false} />
    <Row label="Delivery Charges" value={summary.deliveryCharge === 0 ? <Text style={{ color: primary, fontWeight: '600', fontSize: 13 }}>FREE</Text> : `₹${summary.deliveryCharge}`} />
    {summary.sameDayPremium > 0 && <Row label="Same-Day Delivery Premium" value={`₹${summary.sameDayPremium}`} />}
    {summary.couponDiscount > 0 && <Row label="Coupon Discount" value={`-₹${summary.couponDiscount}`} color={primary} />}
    {tipAmount > 0 && <Row label="Delivery Partner Tip" value={`+₹${tipAmount}`} color={primary} weight="700" />}
  </View>;

  return <CustomerPage protectedPage nav={false} headerColor="#fff">
    {header}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 16, paddingHorizontal: 12, paddingBottom: 24, gap: 16 }}>
        {unified.loading && <View style={[styles.loading, { borderColor: theme.border }]} accessibilityLiveRegion="polite"><ActivityIndicator color={theme.action} /><Text style={{ color: theme.muted }}>Checking your basket and delivery charges…</Text></View>}
        {unified.error ? <CartAlert action={<SecondaryButton title="Retry basket check" onPress={unified.reload} style={{ alignSelf: 'flex-start' }} />}>{unified.error}</CartAlert> : null}
        {unified.data?.warnings?.map(message => <Text key={message} accessibilityRole="alert">{message}</Text>)}

        {!isDigitalCart ? <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.sectionTitle}>Delivery address</Text>
            <Pressable onPress={() => (showAddressForm ? closeAddressForm() : setShowAddressForm(true))} hitSlop={8}><Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>{showAddressForm ? 'Cancel' : '+ Add New'}</Text></Pressable>
          </View>
          {showAddressForm && <View style={{ gap: 12, marginBottom: 12 }}>
            <Pressable onPress={handleUseCurrentLocation} disabled={locating} style={[styles.locationBtn, { borderColor: primary, backgroundColor: theme.primaryLight }, locating && { opacity: 0.6 }]}>
              <Text>📍</Text><Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{locating ? 'Fetching Live Location...' : 'Use Current Location'}</Text>
            </Pressable>
            {locationError ? <Text style={{ fontSize: 11, color: '#ef4444', fontWeight: '600', textAlign: 'center' }}>{locationError}</Text> : null}
            {!isProfileComplete ? <View style={styles.profileWarning} accessibilityRole="alert">
              <Text style={{ color: '#9a3412', fontSize: 12.5, flex: 1, lineHeight: 18 }}><Text style={{ fontWeight: '700', color: '#9a3412' }}>Complete your profile:</Text> {!customerName && !customerPhone ? 'Please add your name and mobile number to deliver your order.' : !customerName ? 'Please add your full name to deliver your order.' : 'Please add your mobile number to deliver your order.'}</Text>
              <Pressable onPress={() => setActiveNav('account')} style={styles.completeBtn}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Complete Profile</Text></Pressable>
            </View> : <View style={[styles.recipient, { backgroundColor: theme.primaryLight }]}>
              <Text style={{ fontWeight: '700', color: theme.primaryHover, fontSize: 11, letterSpacing: 0.5 }}>DELIVERING TO</Text>
              <Text numberOfLines={1} style={{ fontWeight: '800', fontSize: 12.5, flexShrink: 1 }}>{customerName} • {customerPhone}</Text>
            </View>}
            {addressFormError ? <Text style={styles.formError} accessibilityRole="alert">{addressFormError}</Text> : null}
            <FormInput label="Flat / House / Block No." placeholder="e.g. Flat 304, Block C" value={house} onChangeText={setHouse} />
            <FormInput label="Street / Area / Sector" placeholder="e.g. Regal Circle, MG Road" value={street} onChangeText={setStreet} />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><FormInput label="City" placeholder="e.g. Lucknow" value={city} onChangeText={setCity} /></View>
              <View style={{ flex: 1 }}><FormInput label="Pincode" placeholder="e.g. 226001" maxLength={6} keyboardType="number-pad" value={pincode} onChangeText={setPincode} /></View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.formLabel}>Address Type</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>{['Home', 'Work'].map(type => <Pressable key={type} onPress={() => setAddressType(type)} accessibilityState={{ selected: addressType === type }}
                style={[styles.typeBtn, { borderColor: addressType === type ? primary : theme.border, backgroundColor: addressType === type ? theme.primaryLight : '#fff' }]}><Text style={{ fontWeight: '700', color: addressType === type ? primary : theme.textPrimary }}>{type}</Text></Pressable>)}</View>
            </View>
            <LandmarkImagePicker value={landmarkImgUrl} onChange={setLandmarkImgUrl} onUpload={uploadLandmarkImage} label="Landmark Photo (Optional)" sublabel="Upload a photo of your gate or house for quick delivery." />
            <PrimaryButton title={editingAddressId ? 'Update & Select Address' : 'Save & Select Address'} disabled={savingAddress} onPress={handleAddAddress} />
          </View>}
          <View style={{ gap: 10 }}>{savedAddresses.map(addr => {
            const addrId = addr._id || addr.id;
            const isSelected = String(selectedAddressId) === String(addrId);
            return <Pressable key={addrId} onPress={() => setSelectedAddressId(addrId)} accessibilityRole="radio" accessibilityState={{ selected: isSelected }}
              style={[styles.select, { alignItems: 'flex-start', borderColor: isSelected ? primary : theme.border, backgroundColor: isSelected ? theme.primaryLight : '#fff' }]}>
              <View style={{ marginTop: 3 }}><Radio selected={isSelected} color={primary} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '800' }}>{addr.name || customerName || 'Delivery Address'}</Text>
                  <Text style={[styles.labelPill, { backgroundColor: isSelected ? primary : '#94a3b8' }]}>{addr.label || 'Home'}</Text>
                </View>
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 4, lineHeight: 17 }}>{[addr.line1 || addr.house, addr.line2 || addr.street, addr.city, addr.pincode].filter(Boolean).join(', ')}</Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Mobile: {addr.phone || customerPhone || 'Not provided'}</Text>
                {addr.landmarkImage ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  <Image source={{ uri: mediaUrl(addr.landmarkImage) }} style={{ width: 32, height: 32, borderRadius: 4, borderWidth: 1, borderColor: '#cbd5e1' }} contentFit="cover" />
                  <Text style={{ fontSize: 11, color: '#15803d', fontWeight: '700' }}>📸 Landmark Photo Attached</Text>
                </View> : null}
                <View style={{ flexDirection: 'row', gap: 16, marginTop: 8 }}>
                  <Pressable onPress={() => startEditAddress(addr)} hitSlop={8} accessibilityLabel={`Edit ${addr.label || 'Home'} address`}><Text style={{ color: primary, fontSize: 12, fontWeight: '800' }}>Edit</Text></Pressable>
                  <Pressable onPress={() => confirmDeleteAddress(addrId)} hitSlop={8} accessibilityLabel={`Delete ${addr.label || 'Home'} address`}><Text style={{ color: '#ef4444', fontSize: 12, fontWeight: '800' }}>Delete</Text></Pressable>
                </View>
              </View>
            </Pressable>;
          })}</View>
        </Card> : <Card style={{ borderColor: 'rgba(14,165,233,0.3)', backgroundColor: '#f0f9ff' }}>
          <Text style={{ color: '#0369a1', fontWeight: '700' }}>Digital delivery</Text>
          <Text style={{ marginTop: 5, fontSize: 12, color: '#475569' }}>No delivery address or shipping fee is required. Your e-books appear in My E-books after Razorpay verifies payment.</Text>
        </Card>}

        {!isDigitalCart && <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}><Text style={{ fontSize: 18 }}>🚚</Text><Text style={{ fontSize: 14, fontWeight: '700' }}>Delivery Details</Text></View>
          <View style={{ gap: 8 }}>{groups.map(group => <View key={group.key} style={[styles.deliveryRow, { borderColor: theme.border, backgroundColor: theme.pageBackground }]}>
            <Text style={{ fontWeight: '600', fontSize: 12.5, flexShrink: 1 }}>{group.seller?.name || 'Store'}</Text>
            <Text style={[styles.deliveryPill, { color: primary, backgroundColor: theme.primaryLight }]}>{group.channel === 'grocery' ? '⚡ Quick Commerce delivery' : group.requestedMode === 'same_day' ? '🚀 Same-Day via Bulkimart delivery' : '📦 Regular delivery'}</Text>
          </View>)}</View>
          <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 10, lineHeight: 18 }}>Delivery arranged after store acceptance. All delivery charges are included in your bill and will not add a customer charge.</Text>
        </Card>}

        <Card>
          <Text style={styles.sectionTitle}>Payment method</Text>
          <View style={{ gap: 10 }}>
            {paymentOption('wallet', '💰', 'Bulkimart Wallet', `Available Balance: ₹${Number(walletBalance || 0).toFixed(2)}`, {
              hidden: isDigitalCart, disabled: walletBalance < grandTotalVal,
              right: walletBalance >= grandTotalVal ? <Text style={[styles.walletPill, { color: '#16a34a', backgroundColor: '#f0fdf4' }]}>✓ Sufficient Balance</Text> : <Text style={[styles.walletPill, { color: '#dc2626', backgroundColor: '#fef2f2' }]}>⚠ Need ₹{(grandTotalVal - walletBalance).toFixed(2)} more</Text>,
            })}
            {paymentOption('Cash on Delivery', '💵', 'Cash on Delivery (COD)', 'Pay at your doorstep on delivery', { hidden: isDigitalCart })}
            {paymentOption('Online Payment', '💳', 'Razorpay Online Payment', 'UPI, cards and supported payment methods via Razorpay')}
          </View>
        </Card>

        {!isUnified ? <Card>
          <Text style={styles.sectionTitle}>Coupons & offers</Text>
          <CouponThresholdProgress offers={availableCoupons} appliedCode={appliedCoupon?.code} onShopMore={shopMoreForCoupon} />
          {couponNotice ? <Text style={{ marginVertical: 8, color: theme.primary, fontSize: 12, fontWeight: '600' }}>{couponNotice}</Text> : null}
          {!appliedCoupon && <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TextInput placeholder="Enter coupon code" placeholderTextColor="#94a3b8" value={couponInput} editable={!applying} autoCapitalize="characters" onChangeText={v => { setCouponInput(v.toUpperCase()); setCouponMessage(null); }}
              onSubmitEditing={() => applyCouponCode(couponInput.trim())} style={[styles.couponInput, { borderColor: theme.border }]} />
            <Pressable disabled={applying} onPress={() => applyCouponCode(couponInput.trim())} style={[styles.applyBtn, { backgroundColor: primary }, applying && { opacity: 0.7 }]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{applying ? 'Checking…' : 'Apply'}</Text></Pressable>
          </View>}
          {!appliedCoupon && <>
            <Pressable onPress={() => setShowOffers(v => !v)} style={{ marginTop: 10 }}><Text style={{ color: primary, fontWeight: '700', fontSize: 12 }}>{showOffers ? 'Hide offers' : 'View available offers'}</Text></Pressable>
            {showOffers && <View style={{ marginTop: 10, gap: 8 }}>
              {availableCoupons.length === 0 && <Text style={{ fontSize: 12, color: '#94a3b8' }}>No offers available right now.</Text>}
              {availableCoupons.map(c => <View key={c.code} style={[styles.offer, { borderColor: theme.border, opacity: c.applicable ? 1 : 0.62 }]}>
                <View style={{ flexShrink: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontWeight: '800', fontSize: 12.5, letterSpacing: 0.5 }}>{c.code}</Text>
                    {c.firstOrderOnly && <Text style={styles.firstOrder}>First Order Only</Text>}
                  </View>
                  <Text style={{ fontSize: 11, color: '#94a3b8' }}>{c.title}</Text>
                </View>
                {c.applicable ? <Pressable disabled={applying} onPress={() => applyCouponCode(c.code)} style={[styles.saveBtn, { backgroundColor: primary }]}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 11.5 }}>{c.freeShipping ? 'Free delivery' : `Save ₹${c.savingNow}`}</Text></Pressable>
                  : <Text style={{ fontSize: 10.5, color: '#94a3b8', maxWidth: 160, textAlign: 'right' }}>{c.reason}</Text>}
              </View>)}
            </View>}
          </>}
          {appliedCoupon && <View style={[styles.appliedCoupon, { backgroundColor: theme.primaryLight, borderColor: primary }]}>
            <Text style={{ flexShrink: 1 }}><Text style={{ fontWeight: '800', color: primary, fontSize: 13 }}>{appliedCoupon.code}</Text><Text style={{ fontSize: 12, color: theme.textSecondary }}>  ({appliedCoupon.title || appliedCoupon.code} Applied)</Text></Text>
            <Pressable onPress={removeCoupon} hitSlop={8}><Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 12 }}>Remove</Text></Pressable>
          </View>}
          {couponMessage ? <Text style={{ fontSize: 12, fontWeight: '600', marginTop: 8, color: couponMessageType === 'success' ? primary : '#dc2626' }}>{couponMessageType === 'success' ? '✓' : '⚠'} {couponMessage}</Text> : null}
          {!appliedCoupon && availableCoupons.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 12, paddingBottom: 4 }}>
            {availableCoupons.map(coupon => <Pressable key={coupon.code} disabled={applying} onPress={() => { setCouponInput(coupon.code); applyCouponCode(coupon.code); }} accessibilityLabel={`Apply coupon ${coupon.code}`}
              style={[styles.chip, { borderColor: theme.primaryLight, backgroundColor: theme.pageBackground }]}><Text style={{ fontSize: 11, fontWeight: '600', color: primary }}>{coupon.code} ({coupon.discountType === 'free_shipping' ? 'Free delivery' : coupon.discountType === 'percentage' ? `${coupon.value}% Off` : `₹${coupon.value} Off`})</Text></Pressable>)}
          </ScrollView>}
        </Card> : <Card>
          <Text style={{ fontSize: 14 }}>Coupons are available only in eligible single retail checkout.</Text>
          {(appliedCoupon || couponCode) ? <SecondaryButton title="Remove retail coupon to continue" onPress={removeCoupon} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
        </Card>}

        {canTip && Boolean(tipSetting?.isEnabled) && (tipOptions.length > 0 || tipSetting?.allowCustom) && <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Text style={{ fontSize: 20 }}>🛵</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '800', lineHeight: 18 }}>{tipSetting?.title || 'Tip your delivery partner'}</Text>
              <Text style={{ marginTop: 3, fontSize: 11.5, color: theme.textSecondary }}>{tipSetting?.subtitle || "100% of your tip goes to them. We don't take a cut."}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tipOptions.map(amt => { const selected = tipChip === amt; return <Pressable key={amt} onPress={() => { setTipChip(prev => (prev === amt ? null : amt)); setTipCustomInput(''); setIsCustomTip(false); }}
              style={[styles.tipChip, { borderColor: selected ? primary : theme.border, backgroundColor: selected ? primary : '#fff' }]}><Text style={{ fontSize: 12.5, fontWeight: '800', color: selected ? '#fff' : theme.textPrimary }}>₹{amt}</Text></Pressable>; })}
            {Boolean(tipSetting?.allowCustom ?? true) && <Pressable onPress={() => { if (isCustomTip) { setIsCustomTip(false); setTipCustomInput(''); setTipChip(null); } else { setIsCustomTip(true); setTipChip(null); } }}
              style={[styles.tipChip, { flexDirection: 'row', gap: 6, borderColor: isCustomTip ? primary : theme.border, backgroundColor: isCustomTip ? primary : '#fff' }]}>
              <Text style={{ fontSize: 12.5, fontWeight: '800', color: isCustomTip ? '#fff' : theme.textPrimary }}>{isCustomTip && validCustomTip > 0 ? `₹${validCustomTip}` : 'Other'}</Text>
              {!isCustomTip && <Text style={{ fontSize: 13, opacity: 0.7 }}>+</Text>}
            </Pressable>}
          </View>
          {isCustomTip && <View style={[styles.customTip, { borderColor: theme.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontSize: 12, fontWeight: '700', color: theme.textSecondary }}>Enter Custom Tip:</Text><Text style={{ fontSize: 11, fontWeight: '600', color: '#94a3b8' }}>₹{minCustomTip} – ₹{maxCustomTip}</Text></View>
            <View style={[styles.tipInputWrap, { borderColor: customTipError ? '#ef4444' : primary }]}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: theme.textSecondary, marginRight: 4 }}>₹</Text>
              <TextInput autoFocus keyboardType="number-pad" value={tipCustomInput} onChangeText={v => setTipCustomInput(v.replace(/\D/g, ''))} placeholder="e.g. 35" placeholderTextColor="#94a3b8" style={{ flex: 1, fontSize: 13.5, fontWeight: '700', paddingVertical: 4, color: theme.textPrimary }} />
              {tipCustomInput ? <Pressable onPress={() => setTipCustomInput('')} hitSlop={8}><Text style={{ color: '#94a3b8' }}>✕</Text></Pressable> : null}
            </View>
            {customTipError ? <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#ef4444' }}>⚠ {customTipError}</Text> : null}
          </View>}
          {tipAmount > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: primary, flexShrink: 1 }}>✓ ₹{tipAmount} tip added — 100% goes to your delivery partner.</Text>
            <Pressable onPress={() => { setTipChip(null); setTipCustomInput(''); setIsCustomTip(false); }}><Text style={{ fontSize: 11.5, fontWeight: '700', color: '#94a3b8', textDecorationLine: 'underline' }}>Remove tip</Text></Pressable>
          </View>}
        </Card>}

        {isQuickCommerceCart && <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontSize: 20 }}>🏪</Text>
              <View><Text style={styles.cardEyebrow}>Store & Seller Details</Text><Text style={{ fontSize: 10.5, fontWeight: '700', color: primary, marginTop: 1 }}>⚡ Quick Commerce Delivery</Text></View>
            </View>
            <Text style={[styles.partnerPill, { backgroundColor: theme.primaryLight, color: primary }]}>Fulfilling Partner</Text>
          </View>
          <InfoLine icon="🏬" label="Store Name" value={quickCommerceSeller?.name || 'Local Partner Store'} strong />
          {quickCommerceSeller?.phone ? <View style={{ flexDirection: 'row', gap: 10 }}><Text style={{ fontSize: 16 }}>📞</Text><View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11, color: '#94a3b8' }}>Contact Number</Text>
            <Pressable onPress={() => Linking.openURL(`tel:${quickCommerceSeller.phone}`).catch(() => {})}><Text style={{ fontSize: 13, fontWeight: '800', color: primary }}>+91 {quickCommerceSeller.phone}  <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8' }}>• Call Store</Text></Text></Pressable>
          </View></View> : <InfoLine icon="📞" label="Contact Number" value="Available via live delivery partner" />}
          <InfoLine icon="📍" label="Store Pickup Address" value={quickCommerceSeller?.address || quickCommerceSeller?.city || 'Local Store Hub, Service Area'} />
        </Card>}

        <View style={[styles.review, { borderColor: theme.border }]}>
          <View style={[styles.reviewHead, { borderBottomColor: theme.border }]}><Text style={{ fontSize: 16, fontWeight: '800' }}>Review your items</Text><Text style={{ fontSize: 12, color: theme.textSecondary }}>{basketItems.length} {basketItems.length === 1 ? 'item' : 'items'}</Text></View>
          {groups.length > 0 ? <BasketGroups groups={groups} showTotals={false} showStock={false} busy={isOrdering} compact /> : <Text style={{ padding: 16, fontSize: 12, color: '#64748b' }}>Your items will appear after the basket loads.</Text>}
        </View>
        <Card>
          <Text style={styles.sectionTitle}>Payment summary</Text>
          {billRows}
          <View style={[styles.totalLine, { borderTopColor: theme.border }]}><Text style={{ fontSize: 15, fontWeight: '800' }}>Total Amount to Pay</Text><Text style={{ fontSize: 15, fontWeight: '800', color: primary }}>₹{grandTotalVal}</Text></View>
        </Card>
        {errorBanner}
      </ScrollView>
    </KeyboardAvoidingView>
    <View style={[styles.cta, { paddingBottom: 12 + insets.bottom, borderTopColor: theme.border }]}>
      <Pressable onPress={() => setShowBillBreakdown(prev => !prev)} accessibilityLabel="View payable amount breakdown" accessibilityState={{ expanded: showBillBreakdown }} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ fontSize: 11, color: '#94a3b8' }}>Payable Amount ▲</Text>
        <Text style={{ fontSize: 20, fontWeight: '900' }}>₹{grandTotalVal}</Text>
      </Pressable>
      <PrimaryButton title={isOrdering ? 'Placing order…' : cartLoading ? 'Updating…' : 'Confirm & Place Order'} onPress={handlePlaceOrder} disabled={ctaDisabled} style={{ flex: 1, maxWidth: 340, opacity: ctaDisabled ? 0.5 : 1 }} />
    </View>

    <Modal visible={isOrdering} transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.processing}><ActivityIndicator size="large" color={theme.action} /><Text style={{ fontSize: 14, fontWeight: '800' }}>Processing Payment & Order...</Text></View>
    </Modal>
    <Modal visible={showBillBreakdown} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setShowBillBreakdown(false)}>
      <View style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowBillBreakdown(false)} />
        <ScrollView style={styles.sheet} contentContainerStyle={{ paddingTop: 20, paddingHorizontal: 16, paddingBottom: 40 }}>
          <View style={[styles.sheetHead, { borderBottomColor: theme.border }]}>
            <Text style={{ fontSize: 15, fontWeight: '900' }}>Bill Invoice & Items</Text>
            <Pressable onPress={() => setShowBillBreakdown(false)} accessibilityLabel="Close bill breakdown" style={[styles.sheetClose, { backgroundColor: theme.pageBackground }]}><Text style={{ color: theme.textSecondary }}>✕</Text></Pressable>
          </View>
          <Text style={styles.sheetEyebrow}>Ordered Items ({items.length})</Text>
          <View style={{ gap: 10, marginBottom: 20 }}>{items.map((item, idx) => <View key={item._id || item.productId || idx} style={{ gap: 2 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ fontWeight: '600', fontSize: 12.5, flexShrink: 1 }}>{item.qty}x {item.name}</Text><Text style={{ fontWeight: '700', fontSize: 12.5 }}>₹{item.lineTotal}</Text></View>
            {item.additionalMessage ? <Text style={{ fontSize: 11, color: primary, fontStyle: 'italic', paddingLeft: 8 }}>📝 Seller message: "{item.additionalMessage}"</Text> : null}
          </View>)}</View>
          <View style={{ borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: theme.border, paddingTop: 16 }}>
            <Text style={styles.sheetEyebrow}>Payment Breakdown</Text>
            {billRows}
            <View style={[styles.totalLine, { borderTopColor: theme.border, borderStyle: 'solid' }]}><Text style={{ fontSize: 15, fontWeight: '900' }}>Payable Amount</Text><Text style={{ fontSize: 15, fontWeight: '900', color: primary }}>₹{grandTotalVal}</Text></View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  </CustomerPage>;
}

function FormInput({ label, ...props }) {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6 }}>
    <Text style={styles.formLabel}>{label}</Text>
    <TextInput placeholderTextColor="#94a3b8" {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={[styles.formInput, { borderColor: focused ? theme.primaryColor : theme.border, color: theme.textPrimary }]} />
  </View>;
}
function InfoLine({ icon, label, value, strong }) {
  return <View style={{ flexDirection: 'row', gap: 10 }}><Text style={{ fontSize: 16 }}>{icon}</Text><View style={{ flex: 1 }}>
    <Text style={{ fontSize: 11, color: '#94a3b8' }}>{label}</Text>
    <Text style={{ fontSize: strong ? 13.5 : 12.5, fontWeight: strong ? '800' : '600', color: strong ? '#172b4d' : '#64748b', lineHeight: 18 }}>{value}</Text>
  </View></View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: 12, backgroundColor: '#fff', borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '800', fontFamily: 'Outfit' },
  card: { padding: 18, borderWidth: 1, borderRadius: 16, backgroundColor: '#fff', elevation: 1, shadowColor: '#0b2d6b', shadowOpacity: 0.03, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  sectionTitle: { fontSize: 16, fontWeight: '800', lineHeight: 22, marginBottom: 14 },
  cardEyebrow: { fontWeight: '800', fontSize: 12, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  loading: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, backgroundColor: '#fff' },
  locationBtn: { minHeight: 46, borderRadius: 11, borderWidth: 1.5, borderStyle: 'dashed', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' },
  profileWarning: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#fed7aa', flexWrap: 'wrap' },
  completeBtn: { backgroundColor: '#ea580c', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 12 },
  recipient: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  formError: { padding: 10, borderRadius: 10, backgroundColor: '#fef2f2', color: '#b91c1c', fontSize: 12.5, overflow: 'hidden' },
  formLabel: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
  formInput: { height: 46, paddingHorizontal: 13, borderWidth: 1.5, borderRadius: 10, backgroundColor: '#fff', fontSize: 14 },
  typeBtn: { flex: 1, minHeight: 42, borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  select: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 9, height: 9, borderRadius: 5 },
  labelPill: { fontSize: 9, fontWeight: '800', color: '#fff', paddingVertical: 1, paddingHorizontal: 8, borderRadius: 20, overflow: 'hidden' },
  deliveryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1 },
  deliveryPill: { fontWeight: '700', fontSize: 11.5, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6, overflow: 'hidden' },
  walletPill: { fontSize: 10.5, fontWeight: '800', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, overflow: 'hidden' },
  couponInput: { flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 8, fontSize: 13 },
  applyBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, justifyContent: 'center' },
  offer: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed' },
  firstOrder: { fontSize: 9.5, fontWeight: '700', paddingVertical: 1, paddingHorizontal: 6, borderRadius: 4, backgroundColor: '#eff6ff', color: '#1d4ed8', borderWidth: 1, borderColor: '#bfdbfe', overflow: 'hidden' },
  saveBtn: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 6 },
  appliedCoupon: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderWidth: 1, borderStyle: 'dashed', borderRadius: 8 },
  chip: { paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 20 },
  tipChip: { paddingVertical: 7, paddingHorizontal: 15, borderRadius: 999, borderWidth: 1.5, alignItems: 'center' },
  customTip: { backgroundColor: '#f8fafc', borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, gap: 8 },
  tipInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 12, maxWidth: 220 },
  partnerPill: { fontSize: 11, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  review: { borderWidth: 1, borderRadius: 16, backgroundColor: '#fff', overflow: 'hidden' },
  reviewHead: { padding: 18, minHeight: 56, borderBottomWidth: 1, gap: 3 },
  totalLine: { borderTopWidth: 1.5, borderStyle: 'dashed', paddingTop: 12, marginTop: 14, flexDirection: 'row', justifyContent: 'space-between' },
  errorBanner: { padding: 12, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, paddingHorizontal: 12, backgroundColor: '#fff', borderTopWidth: 1, elevation: 12 },
  processing: { flex: 1, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { flexGrow: 0, maxHeight: '80%', backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, paddingBottom: 12 },
  sheetClose: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sheetEyebrow: { fontWeight: '800', fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 },
  successIcon: { width: 68, height: 68, borderRadius: 34, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 20, fontWeight: '800', fontFamily: 'Outfit', textAlign: 'center' },
  orderBadge: { paddingVertical: 4, paddingHorizontal: 14, borderRadius: 20, fontWeight: '700', overflow: 'hidden' },
  orderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1.5, borderRadius: 10 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  homeBtn: { padding: 14, borderWidth: 1.5, borderRadius: 14, alignItems: 'center' },
});
