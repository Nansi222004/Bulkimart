// Port of modules/User/pages/OrderTrackingPage.jsx (route /order/[id], web /orders/:id): live status, map and
// delivery code, courier AWB, rider card, fulfilment + return timeline, rating, items with reorder / review /
// return, invoices and the bill. Every status, eligibility and amount is read from the backend.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useUser } from '../context/UserContext';
import { useAppTheme } from '../theme/ThemeContext';
import { mediaUrl, request } from '../api/client';
import { socket } from '../lib/socket';
import { useFeedback } from '../lib/feedback';
import { orderDiscountRows } from '../lib/orderDiscounts';
import { deliveryLabelFor, hasLiveRider, goesByCourier } from '../lib/deliveryLabel';
import { useRefreshHandler } from '../lib/refresh';
import { useSession } from '../context/SessionContext';
import AuthPage from './AuthPage';
import { Text } from '../components/ui';
import { ChevronLeft } from '../components/icons';
import DeliveryMap from '../components/DeliveryMap';
import DeliveryPartnerRating from '../components/DeliveryPartnerRating';
import OrderInvoices from '../components/OrderInvoices';
import AttachmentUploader from '../components/AttachmentUploader';
import SelectField from '../components/SelectField';
import { ProductGstBreakdown } from '../components/cart/CartUI';

const RETURN_TIMELINE_STEPS = [
  { key: 'RETURN_REQUESTED', label: 'Return Requested', desc: 'Your return request was submitted.' },
  { key: 'UNDER_REVIEW', label: 'Under Review', desc: 'Admin is reviewing your request.' },
  { key: 'APPROVED', label: 'Return Approved', desc: 'Your return was approved.' },
  { key: 'ASSIGNED', label: 'Rider Assigned', desc: 'A delivery partner will collect the item from you.' },
  { key: 'PICKED_UP', label: 'Picked Up', desc: 'Item collected — on its way back to the seller.' },
  { key: 'DELIVERED_TO_SELLER', label: 'Returned to Seller', desc: 'Item has reached the seller.' },
  { key: 'RETURN_RECEIVED', label: 'Return Received', desc: 'Seller/Admin confirmed the item was received.' },
  { key: 'REFUND_PENDING', label: 'Refund Processing', desc: 'Your refund is being processed.' },
  { key: 'REFUNDED', label: 'Refunded', desc: 'Refund completed.' },
];
const RETURN_STATUS_LABEL = {
  RETURN_REQUESTED: 'Return requested', UNDER_REVIEW: 'Under review', APPROVED: 'Return approved', AWAITING_RETURN: 'Awaiting return',
  RETURN_RECEIVED: 'Return received', REFUND_PENDING: 'Refund pending', REFUND_FAILED: 'Refund pending — retrying', REFUNDED: 'Refund completed',
  REJECTED: 'Return rejected', CANCELLED: 'Return cancelled',
};
const RETURN_REASONS = ['DAMAGED', 'DEFECTIVE', 'WRONG_PRODUCT', 'WRONG_SIZE', 'NOT_AS_DESCRIBED', 'MISSING_PARTS', 'QUALITY_ISSUE', 'OTHER'];
const returnTimelineKeyFor = ret => {
  if (['RETURN_RECEIVED', 'REFUND_PENDING', 'REFUND_FAILED', 'REFUNDED'].includes(ret.status)) return ret.status === 'REFUND_FAILED' ? 'REFUND_PENDING' : ret.status;
  if (['APPROVED', 'AWAITING_RETURN'].includes(ret.status) && ret.pickup?.status && ret.pickup.status !== 'NOT_ASSIGNED' && ret.pickup.status !== 'CANCELLED') return ret.pickup.status;
  return ret.status;
};
const formatTime = iso => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '');
const formatDate = iso => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const newKey = () => globalThis.crypto?.randomUUID?.() || `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function Card({ children, style }) { return <View style={[styles.card, style]}>{children}</View>; }
function Eyebrow({ children, style }) { return <Text style={[styles.eyebrow, style]}>{children}</Text>; }
function Step({ done, failed, label, desc, children, connector, connectorDone, primary }) {
  return <View style={{ flexDirection: 'row', gap: 12 }}>
    {connector && <View style={{ position: 'absolute', left: 9, top: 20, bottom: -22, width: 2, backgroundColor: connectorDone ? primary : '#e2e8f0' }} />}
    <View style={[styles.dot, failed ? { backgroundColor: '#dc2626', borderColor: '#dc2626' } : { backgroundColor: done ? primary : '#fff', borderColor: done ? primary : '#cbd5e1' }]}>
      {(done || failed) && <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{failed ? '✗' : '✓'}</Text>}
    </View>
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: failed ? '#dc2626' : done ? '#172b4d' : '#94a3b8' }}>{label}</Text>
      <Text style={{ fontSize: 11, color: '#94a3b8' }}>{desc}</Text>
      {children}
    </View>
  </View>;
}

export default function OrderTrackingScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const sessionState = useSession();
  const { currentUser, selectedOrder, setSelectedOrderState } = useUser();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const order = selectedOrder && String(selectedOrder._id) === String(id) ? selectedOrder : null;
  useEffect(() => {
    if (order || !currentUser || !/^[a-f\d]{24}$/i.test(String(id))) return undefined;
    let cancelled = false;
    setError('');
    request(`/api/orders/${id}`).then(({ ok, body }) => {
      if (cancelled) return;
      if (ok && body.data?._id) setSelectedOrderState(body.data);
      else setError(body.message || 'This order could not be loaded.');
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [id, currentUser?._id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => (router.canGoBack() ? router.back() : router.replace('/orders'));
  if (!currentUser) {
    if (sessionState.loading) return <View style={[styles.center, { paddingTop: insets.top }]}><Text>Verifying your session…</Text></View>;
    return <View style={{ flex: 1 }}><StatusBar style="dark" /><AuthPage /></View>;
  }
  if (!order) return <View style={[styles.center, { paddingTop: insets.top }]}>
    <StatusBar style="dark" />
    <Text accessibilityRole={error ? 'alert' : undefined}>{error || 'Loading order…'}</Text>
    {error ? <Pressable onPress={() => setAttempt(n => n + 1)} style={styles.outlineBtn}><Text style={{ fontWeight: '700' }}>Retry</Text></Pressable> : null}
    <Pressable onPress={close} style={styles.outlineBtn}><Text style={{ fontWeight: '700' }}>Back</Text></Pressable>
  </View>;
  return <TrackingBody key={order._id} selectedOrder={order} close={close} theme={theme} insets={insets} />;
}

function TrackingBody({ selectedOrder, close, theme, insets }) {
  const ui = useFeedback();
  const { activeRider, returnPickupOtp, setReviewProductId, addToCart, replaceNav, switchCartChannel, setActiveMode, fetchOrders } = useUser();
  const primary = theme.primaryColor;
  const orderId = selectedOrder._id;
  const [track, setTrack] = useState(null);
  const [riderLive, setRiderLive] = useState(null);

  const loadTrack = useCallback(async () => {
    try {
      const { ok, body } = await request(`/api/orders/${orderId}/track`);
      if (ok) setTrack(body.data || null);
    } catch { /* the page still works without the map */ }
  }, [orderId]);
  useRefreshHandler(async () => { await Promise.allSettled([loadTrack(), fetchOrders()]); });
  useEffect(() => {
    loadTrack();
    const settled = ['delivered', 'cancelled', 'returned', 'refunded'];
    const timer = setInterval(() => { if (!settled.includes(track?.status) && AppState.currentState === 'active') loadTrack(); }, 15000);
    const onStatus = payload => { if (String(payload.orderId) === String(orderId)) loadTrack(); };
    const events = ['order_status_updated', 'rider_assigned', 'order_delivered', 'delivery_status_updated', 'otp_ready'];
    events.forEach(event => socket.on(event, onStatus));
    return () => { clearInterval(timer); events.forEach(event => socket.off(event, onStatus)); };
  }, [orderId, track?.status, loadTrack]);
  useEffect(() => {
    const onMove = payload => { if (String(payload.orderId) === String(orderId)) setRiderLive({ lat: payload.lat, lng: payload.lng, updatedAt: payload.at }); };
    socket.on('location_update', onMove);
    return () => socket.off('location_update', onMove);
  }, [orderId]);

  const handleReorderSingleItem = async item => {
    const pId = item.productId || item._id;
    if (!pId) return;
    try {
      const res = await addToCart(pId, item.qty || 1, item.variantId);
      if (res?.ok) {
        ui.notify(`Added "${item.name}" to cart!`, { type: 'success' });
        if (res.data?.channel) { switchCartChannel?.(res.data.channel); setActiveMode?.(res.data.channel === 'grocery' ? 'quick' : 'shop-all'); }
        replaceNav('cart');
      } else ui.notify(res?.message || 'Could not add item to cart', { type: 'error' });
    } catch (err) { ui.notify(err.message || 'Error adding item', { type: 'error' }); }
  };

  // Reviews already on file (server), used for the "✓ Reviewed" badge.
  const [reviewedProductIds, setReviewedProductIds] = useState(new Set());
  const productIdOf = item => String(item?.productId?._id || item?.productId || '');
  // Returns (server-authoritative)
  const [returnEligibilityByItem, setReturnEligibilityByItem] = useState({});
  const [returnsByItem, setReturnsByItem] = useState({});
  const [returnModalItem, setReturnModalItem] = useState(null);
  const [returnQty, setReturnQty] = useState(1);
  const [returnReason, setReturnReason] = useState('DAMAGED');
  const [returnDescription, setReturnDescription] = useState('');
  const [returnFiles, setReturnFiles] = useState([]);
  const [submittingReturn, setSubmittingReturn] = useState(false);
  const [returnFormError, setReturnFormError] = useState('');
  const [returnRequestKey, setReturnRequestKey] = useState('');
  const [viewingReturn, setViewingReturn] = useState(null);

  const refreshReturnData = useCallback(async () => {
    if (selectedOrder.status !== 'delivered') return undefined;
    const items = selectedOrder.items || [];
    const [eligEntries, returnsRes] = await Promise.all([
      Promise.all(items.map(async item => {
        try { const { ok, body } = await request(`/api/orders/${selectedOrder._id}/items/${item._id}/return-eligibility`); return [item._id, ok ? body.data : { eligible: false }]; }
        catch { return [item._id, { eligible: false }]; }
      })),
      request(`/api/returns?orderId=${selectedOrder._id}`).then(r => r.body).catch(() => ({ data: [] })),
    ]);
    setReturnEligibilityByItem(Object.fromEntries(eligEntries));
    const grouped = {};
    for (const ret of returnsRes.data || []) { const key = String(ret.orderItemId); (grouped[key] = grouped[key] || []).push(ret); }
    setReturnsByItem(grouped);
    return grouped;
  }, [selectedOrder._id, selectedOrder.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { refreshReturnData(); }, [refreshReturnData]);
  useEffect(() => {
    if (selectedOrder.status !== 'delivered') return undefined;
    const refresh = async () => {
      const grouped = await refreshReturnData();
      setViewingReturn(current => (current ? (Object.values(grouped || {}).flat().find(r => r._id === current._id) || current) : current));
    };
    const onNotification = notification => {
      const forThisOrder = String(notification?.route || '').includes(String(selectedOrder._id));
      if (/^(RETURN_|REFUND_)/.test(notification?.event || '') && (forThisOrder || notification?.metadata?.returnId)) refresh();
    };
    socket.on('notification_new', onNotification); socket.on('return_pickup_assigned', refresh); socket.on('connect', refresh);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { socket.off('notification_new', onNotification); socket.off('return_pickup_assigned', refresh); socket.off('connect', refresh); appState.remove(); };
  }, [selectedOrder._id, selectedOrder.status, refreshReturnData]);
  useEffect(() => {
    if (!viewingReturn || viewingReturn.pickup?.status !== 'ASSIGNED') return undefined;
    const timer = setInterval(async () => {
      const grouped = await refreshReturnData();
      const fresh = Object.values(grouped || {}).flat().find(r => r._id === viewingReturn._id);
      if (fresh) setViewingReturn(fresh);
    }, 5000);
    return () => clearInterval(timer);
  }, [viewingReturn?._id, viewingReturn?.pickup?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const openReturnModal = item => {
    setReturnRequestKey(newKey());
    const eligibility = returnEligibilityByItem[item._id];
    setReturnModalItem(item); setReturnQty(1); setReturnReason('DAMAGED'); setReturnDescription(''); setReturnFiles([]); setReturnFormError('');
    if (!eligibility?.eligible) setReturnFormError(eligibility?.reason || 'This item is no longer eligible for return.');
  };
  const submitReturn = async () => {
    if (!returnModalItem || submittingReturn) return;
    if (returnReason === 'OTHER' && !returnDescription.trim()) { setReturnFormError('Please describe the issue when selecting "Other".'); return; }
    setSubmittingReturn(true); setReturnFormError('');
    try {
      const fd = new FormData();
      fd.append('orderId', selectedOrder._id); fd.append('orderItemId', returnModalItem._id); fd.append('quantity', String(returnQty)); fd.append('reason', returnReason);
      if (returnDescription.trim()) fd.append('customerDescription', returnDescription.trim());
      returnFiles.forEach(f => fd.append('attachments', { uri: f.uri, name: f.name, type: f.type }));
      const { ok, body } = await request('/api/returns', { method: 'POST', form: fd, headers: { 'Idempotency-Key': returnRequestKey } });
      if (!ok) throw new Error(body.message || 'Could not submit your return request');
      setReturnModalItem(null);
      await refreshReturnData();
      ui.notify(`Return ${body.data.returnNumber} requested.`);
    } catch (err) { setReturnFormError(err.message || 'Error submitting return request'); } finally { setSubmittingReturn(false); }
  };
  useEffect(() => {
    if (selectedOrder.status !== 'delivered') return undefined;
    const ids = [...new Set((selectedOrder.items || []).map(productIdOf).filter(Boolean))];
    if (!ids.length) return undefined;
    let cancelled = false;
    request(`/api/products/reviews/mine?productIds=${ids.join(',')}`).then(({ ok, body }) => { if (!cancelled && ok) setReviewedProductIds(new Set(body.data?.reviewedProductIds || [])); }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedOrder._id, selectedOrder.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const statusSequence = ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery', 'delivered'];
  const currentStatus = track?.status || selectedOrder.status || 'placed';
  const isCancelled = currentStatus === 'cancelled';
  const currentIndex = statusSequence.indexOf(currentStatus);
  const liveRider = hasLiveRider(track, selectedOrder);
  const byCourier = goesByCourier(track, selectedOrder);
  const deliveryLabel = deliveryLabelFor(track) || deliveryLabelFor(selectedOrder);
  const a = selectedOrder.shippingAddress || {};
  const addrText = `${a.line1 || a.address || ''}${a.line2 ? ', ' + a.line2 : ''}, ${a.city || ''} - ${a.pincode || ''}`;
  const mainSteps = [
    { label: 'Order Placed', desc: 'We have received your order.', status: 'placed' },
    { label: 'Confirmed', desc: 'Seller has accepted your order.', status: 'confirmed' },
    { label: 'Dispatched', desc: 'Ready for rider pickup.', status: 'dispatched' },
    { label: 'Out for Delivery', desc: 'Rider is on the way to your address.', status: 'out_for_delivery' },
    { label: 'Delivered', desc: 'Order successfully delivered.', status: 'delivered' },
  ];
  const pickupOtpFor = ret => (returnPickupOtp?.returnId === ret._id ? returnPickupOtp.otp : null) || ret.pickup?.otp;
  const eligibilityMax = returnModalItem ? returnEligibilityByItem[returnModalItem._id]?.maxReturnableQuantity : 1;

  return <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
    <StatusBar style="dark" />
    <View style={{ height: insets.top, backgroundColor: '#fff' }} />
    <View style={styles.header}>
      <Pressable onPress={close} accessibilityLabel="Back" style={{ padding: 8 }}><ChevronLeft size={20} width={2.5} color="#172b4d" /></Pressable>
      <Text style={styles.headerTitle}>TRACK ORDER</Text>
    </View>
    <ScrollView contentContainerStyle={{ paddingVertical: 20, paddingHorizontal: 16, gap: 16, paddingBottom: 40 + insets.bottom }}>
      <Card style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: '#94a3b8' }}>ORDER NUMBER</Text>
          <Text style={[styles.pill, { color: deliveryLabel?.tone === 'sameday' ? '#166534' : primary, backgroundColor: deliveryLabel?.tone === 'sameday' ? '#dcfce7' : theme.primaryLight }]}>
            {selectedOrder.type === 'grocery' ? 'Quick Commerce' : deliveryLabel ? `${deliveryLabel.icon} ${deliveryLabel.text}` : byCourier ? '📦 Scheduled Delivery' : 'Delivery'}
          </Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{selectedOrder.orderNo || selectedOrder._id}</Text>
        <Text style={{ fontSize: 12, color: '#94a3b8' }}>Placed on {formatDate(selectedOrder.createdAt)} at {formatTime(selectedOrder.createdAt)}</Text>
      </Card>

      {liveRider && ['confirmed', 'preparing', 'dispatched', 'out_for_delivery'].includes(currentStatus) && <View>
        <DeliveryMap pickup={track?.pickup} drop={track?.drop} status={currentStatus} stage={track?.stage} etaMin={track?.route?.durationMin} routePolyline={track?.route?.polyline}
          rider={track?.rider ? { ...track.rider, location: riderLive || track.rider.location } : null} height={260} />
        {track?.deliveryOtp ? <View style={[styles.otpBox, { backgroundColor: theme.primaryLight, borderColor: primary }]}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: primary, letterSpacing: 0.5, textAlign: 'center' }}>SHARE THIS CODE WITH YOUR DELIVERY PARTNER</Text>
          <Text style={{ fontSize: 34, fontWeight: '900', letterSpacing: 10, marginTop: 8, marginBottom: 4, textAlign: 'center' }} selectable>{track.deliveryOtp}</Text>
          <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600', textAlign: 'center' }}>Only give it once your order is in your hands</Text>
        </View> : null}
      </View>}

      {byCourier && track?.shiprocket?.awb ? <View style={[styles.courier, { backgroundColor: theme.primaryLight, borderColor: primary }]}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: primary, letterSpacing: 0.5 }}>ON ITS WAY WITH {String(track.shiprocket.courier || '').toUpperCase()}</Text>
        <Text style={{ fontSize: 20, fontWeight: '900', letterSpacing: 1.5, marginTop: 6, marginBottom: 4 }} selectable>{track.shiprocket.awb}</Text>
        <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600' }}>Quote this tracking number to {track.shiprocket.courier}</Text>
        {track.shiprocket.trackingUrl ? <Pressable onPress={() => Linking.openURL(track.shiprocket.trackingUrl).catch(() => {})} style={{ marginTop: 10 }}><Text style={{ fontSize: 12, fontWeight: '800', color: primary, textDecorationLine: 'underline' }}>Track on the courier's site</Text></Pressable> : null}
      </View> : null}
      {byCourier && !track?.shiprocket?.awb && ['confirmed', 'preparing'].includes(currentStatus) && <View style={styles.packing}><Text style={{ fontSize: 12, color: '#94a3b8', fontWeight: '600' }}>📦 The store is packing your order. A tracking number will appear here once it is handed to the courier.</Text></View>}

      {currentStatus === 'out_for_delivery' && activeRider && String(activeRider.orderId) === String(selectedOrder._id) && <View style={[styles.riderCard, { backgroundColor: theme.primaryLight, borderColor: primary }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <Text style={{ fontWeight: '800', fontSize: 12, color: primary, letterSpacing: 0.5 }}>🛵 ACTIVE RIDER DELIVERY</Text>
          <Text style={[styles.pill, { color: '#fff', backgroundColor: primary, fontSize: 10 }]}>{activeRider.step === 'pickup' ? 'Heading to Merchant' : activeRider.step === 'arrived' ? 'At Merchant Store' : 'On the way to you'}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <View style={styles.riderAvatar}><Text style={{ fontSize: 20 }}>🛵</Text></View>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '800', fontSize: 14 }}>{activeRider.name}</Text><Text style={{ fontSize: 12, color: '#94a3b8' }}>{activeRider.vehicleType?.toUpperCase()} • {activeRider.phone}</Text></View>
        </View>
        {activeRider.otp ? <View style={[styles.otpInline, { borderColor: primary }]}><Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8' }}>DELIVERY OTP</Text><Text style={{ fontSize: 20, fontWeight: '900', color: primary, letterSpacing: 3 }}>{activeRider.otp}</Text></View> : null}
      </View>}

      <Card>
        <Eyebrow style={{ marginBottom: 16 }}>Fulfillment Live Timeline</Eyebrow>
        <View style={{ gap: 20 }}>
          {isCancelled ? <Step failed label="Cancelled" desc={selectedOrder.cancelReason || 'This order was cancelled.'} primary={primary} />
            : mainSteps.map((step, idx) => {
              const stepIndex = statusSequence.indexOf(step.status);
              const isDone = stepIndex !== -1 && stepIndex <= currentIndex;
              const entry = selectedOrder.timeline?.find(t => t.status === step.status);
              return <Step key={step.status} done={isDone} label={step.label} desc={`${step.desc}${entry ? ` • ${formatTime(entry.timestamp)}` : ''}`} connector={idx < 5} connectorDone={isDone && idx < currentIndex} primary={primary} />;
            })}
          {!isCancelled && Object.values(returnsByItem).flat().map(ret => {
            if (['REJECTED', 'CANCELLED'].includes(ret.status)) return <Step key={ret._id} failed label={`${ret.status === 'REJECTED' ? 'Return Rejected' : 'Return Cancelled'} — ${ret.productName}`} desc={ret.rejectionReason || `Return ${ret.returnNumber} did not proceed.`} primary={primary} />;
            const rawKey = returnTimelineKeyFor(ret);
            const normalizedKey = rawKey === 'AWAITING_RETURN' ? 'APPROVED' : rawKey;
            const returnCurrentIndex = RETURN_TIMELINE_STEPS.findIndex(s => s.key === normalizedKey);
            return <View key={ret._id} style={{ gap: 20 }}>
              <Text style={{ marginLeft: 32, marginBottom: -12, fontSize: 11, fontWeight: '800', color: '#94a3b8' }}>RETURN — {String(ret.productName).toUpperCase()} ({ret.returnNumber})</Text>
              {RETURN_TIMELINE_STEPS.map((step, idx) => {
                const isDone = returnCurrentIndex !== -1 && idx <= returnCurrentIndex;
                const otp = step.key === 'ASSIGNED' && (normalizedKey === 'ASSIGNED' || ret.pickup?.status === 'ASSIGNED') ? pickupOtpFor(ret) : undefined;
                return <Step key={step.key} done={isDone} label={step.label} desc={step.desc} connector={idx < RETURN_TIMELINE_STEPS.length - 1} connectorDone={isDone && idx < returnCurrentIndex} primary={primary}>
                  {step.key === 'ASSIGNED' && (normalizedKey === 'ASSIGNED' || ret.pickup?.status === 'ASSIGNED') && (otp
                    ? <View style={styles.pickupCode}><View style={{ flex: 1 }}><Text style={{ fontSize: 10, fontWeight: '800', color: '#15803d', letterSpacing: 0.5 }}>PICKUP CODE</Text><Text style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>Share code with rider</Text></View><Text style={{ fontSize: 20, fontWeight: '900', color: '#16a34a', letterSpacing: 2 }}>{otp}</Text></View>
                    : <Text style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', marginTop: 4 }}>Waiting for the rider to request your pickup code…</Text>)}
                </Step>;
              })}
            </View>;
          })}
        </View>
      </Card>

      <Card>
        <Eyebrow style={{ marginBottom: 12 }}>Shipping Address</Eyebrow>
        <Text style={{ fontWeight: '600', lineHeight: 18, fontSize: 13 }}>{addrText}</Text>
        <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Recipient: {a.name} • {a.phone}</Text>
      </Card>

      {currentStatus === 'delivered' && <DeliveryPartnerRating orderId={orderId} riderName={track?.rider?.name} deliveryRating={track?.deliveryRating}
        onRated={rating => setTrack(previous => ({ ...previous, deliveryRating: { ...previous?.deliveryRating, rating } }))} />}

      <Card>
        <Eyebrow style={{ marginBottom: 12 }}>Items Summary</Eyebrow>
        {selectedOrder.items?.map((item, idx) => {
          const productId = productIdOf(item);
          const existing = returnsByItem[item._id] || [];
          const eligibility = returnEligibilityByItem[item._id];
          return <View key={item._id || idx} style={{ paddingVertical: 10, borderBottomWidth: idx < selectedOrder.items.length - 1 ? 1 : 0, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {item.image ? <Image source={{ uri: mediaUrl(item.image) }} style={{ width: 36, height: 36, borderRadius: 8 }} contentFit="cover" /> : null}
              <View style={{ flex: 1 }}><Text style={{ fontWeight: '600', fontSize: 13 }}>{item.name}</Text><Text style={{ fontSize: 11, color: '#94a3b8' }}>Qty: {item.qty} • ₹{item.price} each</Text></View>
              <Text style={{ fontWeight: '700', fontSize: 13 }}>₹{item.qty * item.price}</Text>
            </View>
            {currentStatus === 'delivered' && <View style={{ marginTop: 8, flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              <Pressable onPress={() => handleReorderSingleItem(item)} style={[styles.smallBtn, { borderColor: '#16a34a' }]}><Text style={{ color: '#16a34a', fontSize: 11, fontWeight: '800' }}>🔄 Reorder</Text></Pressable>
              {reviewedProductIds.has(productId) ? <Text style={styles.reviewed}>✓ Reviewed</Text>
                : <Pressable onPress={() => productId && setReviewProductId(productId)} style={[styles.smallBtn, { borderColor: primary }]}><Text style={{ color: primary, fontSize: 11, fontWeight: '800' }}>⭐ Rate &amp; Review</Text></Pressable>}
            </View>}
            {currentStatus === 'delivered' && <View style={{ marginTop: 8, gap: 6, alignItems: 'flex-end' }}>
              {existing.map(ret => <Pressable key={ret._id} onPress={async () => { setViewingReturn(ret); const grouped = await refreshReturnData(); const fresh = (grouped?.[item._id] || []).find(r => r._id === ret._id); if (fresh) setViewingReturn(fresh); }}
                style={[styles.retPill, { backgroundColor: ret.status === 'REJECTED' ? '#fef2f2' : ret.status === 'REFUNDED' ? '#f0fdf4' : '#fffbeb' }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: ret.status === 'REJECTED' ? '#b91c1c' : ret.status === 'REFUNDED' ? '#16a34a' : '#92400e' }}>{RETURN_STATUS_LABEL[ret.status] || ret.status} ({ret.quantity}) ›</Text>
              </Pressable>)}
              {eligibility?.eligible && eligibility.maxReturnableQuantity > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 10.5, color: '#94a3b8', flexShrink: 1 }}>Return available until {formatDate(eligibility.returnEligibleUntil)}</Text>
                <Pressable onPress={() => openReturnModal(item)} style={[styles.smallBtn, { borderColor: '#b45309' }]}><Text style={{ color: '#b45309', fontSize: 11, fontWeight: '800' }}>↩ Return Item</Text></Pressable>
              </View>}
              {eligibility && !eligibility.eligible && existing.length === 0 && <Text style={{ fontSize: 10.5, color: '#94a3b8' }}>{eligibility.code === 'RETURN_WINDOW_EXPIRED' ? 'Return window expired' : 'Non-returnable'}</Text>}
            </View>}
          </View>;
        })}
      </Card>

      <Card style={{ gap: 10 }}>
        <Eyebrow style={{ marginBottom: 4 }}>Bill Details</Eyebrow>
        <View style={styles.billRow}><Text style={styles.billLabel}>Subtotal (including product GST)</Text><Text style={styles.billValue}>₹{selectedOrder.pricing?.subtotal || 0}</Text></View>
        <ProductGstBreakdown tax={selectedOrder.productTax} whenMissing="GST details were not recorded for this older order." />
        {selectedOrder.productTax && (selectedOrder.deliveredAt || currentStatus === 'delivered' || selectedOrder.status === 'delivered') && <OrderInvoices label="View / download invoice" load={async () => {
          const { ok, body } = await request(`/api/orders/${selectedOrder._id}/invoices`);
          if (!ok || body.success === false || !Array.isArray(body.data)) throw new Error(body.message || 'Could not load the invoice');
          return body.data;
        }} />}
        <View style={styles.billRow}><Text style={styles.billLabel}>Delivery Charge (no GST)</Text><Text style={styles.billValue}>₹{selectedOrder.pricing?.deliveryCharge || 0}</Text></View>
        {orderDiscountRows(selectedOrder.pricing).map(([title, amount]) => <View key={title} style={styles.billRow}><Text style={{ color: '#10b981', fontSize: 13 }}>{title}</Text><Text style={{ color: '#10b981', fontSize: 13 }}>-₹{amount.toFixed(2)}</Text></View>)}
        <View style={{ height: 1, backgroundColor: theme.border, marginVertical: 4 }} />
        <View style={styles.billRow}><Text style={{ fontWeight: '800', fontSize: 14 }}>Total Amount</Text><Text style={{ fontWeight: '800', fontSize: 14 }}>₹{selectedOrder.pricing?.totalAmount || 0}</Text></View>
        <View style={styles.billRow}><Text style={{ fontSize: 11, color: '#94a3b8' }}>Payment Method</Text><Text style={{ fontSize: 11, color: '#94a3b8' }}>{String(selectedOrder.paymentMethod || '').toUpperCase()}</Text></View>
      </Card>
    </ScrollView>

    <Modal visible={Boolean(returnModalItem)} transparent animationType="slide" statusBarTranslucent onRequestClose={() => !submittingReturn && setReturnModalItem(null)}>
      <KeyboardAvoidingView behavior="height" style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => !submittingReturn && setReturnModalItem(null)} />
        {returnModalItem && <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 18 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', flexShrink: 1 }}>
              {returnModalItem.image ? <Image source={{ uri: mediaUrl(returnModalItem.image) }} style={{ width: 44, height: 44, borderRadius: 10 }} contentFit="cover" /> : null}
              <View style={{ flexShrink: 1 }}><Text style={styles.label}>RETURN ITEM</Text><Text style={{ fontSize: 14, fontWeight: '800' }}>{returnModalItem.name}</Text></View>
            </View>
            <Pressable onPress={() => setReturnModalItem(null)} disabled={submittingReturn} accessibilityLabel="Close" hitSlop={10}><Text style={{ fontSize: 18, color: '#94a3b8' }}>✕</Text></Pressable>
          </View>
          {returnEligibilityByItem[returnModalItem._id]?.eligible ? <>
            <Text style={styles.label}>QUANTITY (MAX {eligibilityMax})</Text>
            <TextInput keyboardType="number-pad" value={String(returnQty)} onChangeText={v => setReturnQty(Math.max(1, Math.min(Number(v.replace(/\D/g, '')) || 1, eligibilityMax)))} style={[styles.input, { marginBottom: 14 }]} />
            <SelectField label="REASON" labelStyle={styles.label} value={returnReason} onChange={setReturnReason} options={RETURN_REASONS.map(r => ({ value: r, label: r.replace(/_/g, ' ') }))} style={{ marginBottom: 14 }} />
            <Text style={styles.label}>DESCRIPTION{returnReason === 'OTHER' ? ' (REQUIRED)' : ' (OPTIONAL)'}</Text>
            <TextInput value={returnDescription} onChangeText={setReturnDescription} placeholder="Tell us what went wrong..." placeholderTextColor="#94a3b8" multiline numberOfLines={3} style={[styles.input, { minHeight: 80, textAlignVertical: 'top', marginBottom: 14 }]} />
            <Text style={styles.label}>EVIDENCE PHOTOS (OPTIONAL, UP TO 5)</Text>
            <AttachmentUploader files={returnFiles} maxFiles={5} onAddFiles={selected => setReturnFiles(prev => [...(prev || []), ...selected].slice(0, 5))} onRemoveFile={i => setReturnFiles(prev => (prev || []).filter((_, idx) => idx !== i))} />
            {returnFormError ? <Text style={{ marginBottom: 10, fontSize: 12, color: '#b91c1c' }}>{returnFormError}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setReturnModalItem(null)} disabled={submittingReturn} style={[styles.action, { flex: 1, borderWidth: 1.5, borderColor: '#cbd5e1' }]}><Text style={{ color: '#475569', fontWeight: '800', fontSize: 13 }}>Cancel</Text></Pressable>
              <Pressable onPress={submitReturn} disabled={submittingReturn} style={[styles.action, { flex: 2, backgroundColor: submittingReturn ? '#94a3b8' : '#b45309' }]}><Text style={{ color: '#fff', fontWeight: '900', fontSize: 13 }}>{submittingReturn ? 'Submitting…' : 'Submit Return Request'}</Text></Pressable>
            </View>
          </> : <Text style={{ fontSize: 13, color: '#b91c1c' }}>{returnFormError || 'This item is no longer eligible for return.'}</Text>}
        </ScrollView>}
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={Boolean(viewingReturn)} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setViewingReturn(null)}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewingReturn(null)} />
        {viewingReturn && <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <View style={{ flexShrink: 1 }}><Text style={styles.label}>{viewingReturn.returnNumber}</Text><Text style={{ fontSize: 14, fontWeight: '800' }}>{viewingReturn.productName} × {viewingReturn.quantity}</Text></View>
            <Pressable onPress={() => setViewingReturn(null)} accessibilityLabel="Close" hitSlop={10}><Text style={{ fontSize: 18, color: '#94a3b8' }}>✕</Text></Pressable>
          </View>
          <Text style={styles.retLine}><Text style={{ fontWeight: '700' }}>Status:</Text> {RETURN_STATUS_LABEL[viewingReturn.status] || viewingReturn.status}</Text>
          {viewingReturn.pickup && viewingReturn.pickup.status !== 'NOT_ASSIGNED' ? <Text style={styles.retLine}><Text style={{ fontWeight: '700' }}>Pickup:</Text> {{ ASSIGNED: 'Rider assigned — on the way to you', PICKED_UP: 'Picked up — returning to seller', DELIVERED_TO_SELLER: 'Delivered back to the seller', CANCELLED: 'Pickup cancelled' }[viewingReturn.pickup.status] || viewingReturn.pickup.status}{viewingReturn.pickup.riderName ? ` (${viewingReturn.pickup.riderName})` : ''}</Text> : null}
          {viewingReturn.pickup?.status === 'ASSIGNED' && (pickupOtpFor(viewingReturn)
            ? <View style={[styles.otpInline, { borderColor: primary, marginBottom: 6 }]}><Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', flexShrink: 1 }}>PICKUP CODE — SHARE WITH RIDER</Text><Text style={{ fontSize: 20, fontWeight: '900', color: primary, letterSpacing: 3 }}>{pickupOtpFor(viewingReturn)}</Text></View>
            : <Text style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 6 }}>Waiting for the rider to request your pickup code…</Text>)}
          <Text style={styles.retLine}><Text style={{ fontWeight: '700' }}>Reason:</Text> {viewingReturn.reason?.replace(/_/g, ' ')}</Text>
          {viewingReturn.customerDescription ? <Text style={styles.retLine}><Text style={{ fontWeight: '700' }}>Description:</Text> {viewingReturn.customerDescription}</Text> : null}
          {viewingReturn.rejectionReason ? <Text style={[styles.retLine, { color: '#b91c1c' }]}><Text style={{ fontWeight: '700', color: '#b91c1c' }}>Rejection reason:</Text> {viewingReturn.rejectionReason}</Text> : null}
          {viewingReturn.refundAmount !== undefined && viewingReturn.refundAmount !== null && <Text style={styles.retLine}><Text style={{ fontWeight: '700' }}>Refund:</Text> ₹{viewingReturn.refundAmount} · {viewingReturn.refundDestination === 'wallet' ? 'Bulkimart Wallet' : viewingReturn.refundDestination === 'original_source' ? 'Original payment source' : 'Destination pending'}{viewingReturn.status === 'REFUNDED' ? ` — completed${viewingReturn.refundedAt ? ` on ${new Date(viewingReturn.refundedAt).toLocaleDateString('en-IN')}` : ''}${viewingReturn.refundReference ? ` (Ref: ${viewingReturn.refundReference})` : ''}` : ` — ${viewingReturn.refundStatus || 'pending'}`}</Text>}
          {viewingReturn.pickupMethod === 'SHIPROCKET' ? <Text style={styles.retLine}>Shiprocket pickup: {viewingReturn.reverseBooking?.trackingState || viewingReturn.reverseBooking?.state}{viewingReturn.awbNumber ? ` · AWB ${viewingReturn.awbNumber}` : ''}</Text> : null}
          {viewingReturn.attachments?.length > 0 && <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginVertical: 10 }}>
            {viewingReturn.attachments.map((att, i) => <Pressable key={i} onPress={() => Linking.openURL(mediaUrl(att.url)).catch(() => {})}><Image source={{ uri: mediaUrl(att.url) }} style={{ width: 56, height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' }} contentFit="cover" /></Pressable>)}
          </View>}
          <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 }}>
            <Text style={[styles.label, { marginBottom: 8 }]}>TIMELINE</Text>
            {(viewingReturn.history || []).map((h, i) => <View key={i} style={{ marginBottom: 8, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: '#e2e8f0' }}>
              <Text style={{ fontWeight: '700', fontSize: 12 }}>{RETURN_STATUS_LABEL[h.toStatus] || h.toStatus}</Text>
              <Text style={{ color: '#94a3b8', fontSize: 11 }}>{formatDate(h.timestamp)} · {formatTime(h.timestamp)}</Text>
              {h.comment ? <Text style={{ color: '#475569', fontSize: 11.5 }}>{h.comment}</Text> : null}
            </View>)}
          </View>
        </ScrollView>}
      </View>
    </Modal>
  </View>;
}


const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20, backgroundColor: '#f8fafc' },
  outlineBtn: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1.5, borderBottomColor: '#e2e8f0', backgroundColor: '#fff' },
  headerTitle: { marginLeft: 8, fontSize: 16, fontWeight: '800', letterSpacing: 0.5, fontFamily: 'Outfit' },
  card: { padding: 16, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, backgroundColor: '#fff' },
  eyebrow: { fontWeight: '800', fontSize: 12, color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase' },
  pill: { fontSize: 12, fontWeight: '800', borderRadius: 20, paddingVertical: 2, paddingHorizontal: 8, overflow: 'hidden' },
  otpBox: { marginTop: 12, padding: 16, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed' },
  courier: { padding: 16, borderRadius: 12, borderWidth: 1.5 },
  packing: { padding: 14, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#cbd5e1' },
  riderCard: { padding: 16, borderWidth: 1.5, borderRadius: 12 },
  riderAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' },
  otpInline: { backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  pickupCode: { backgroundColor: '#f0fdf4', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#16a34a', flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 4, maxWidth: 280 },
  smallBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12 },
  reviewed: { fontSize: 11, fontWeight: '700', color: '#16a34a', backgroundColor: '#f0fdf4', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20, overflow: 'hidden' },
  retPill: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 20 },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  billLabel: { color: '#64748b', fontSize: 13, flexShrink: 1 },
  billValue: { fontSize: 13 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', justifyContent: 'flex-end', padding: 12 },
  sheet: { flexGrow: 0, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 20 },
  label: { fontSize: 10.5, fontWeight: '800', color: '#94a3b8', marginBottom: 6 },
  input: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#e2e8f0', fontSize: 13, color: '#0f172a' },
  action: { paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  retLine: { fontSize: 12.5, marginBottom: 6, lineHeight: 18 },
});
