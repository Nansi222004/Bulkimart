import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { useToast } from '../components/Toast';
import * as deliveryApi from '../services/delivery.api';
import { connectRiderSocket, disconnectRiderSocket, onRiderEvent } from '../services/socket';
import { getCurrentPoint, requestLocationPermission, watchPoint } from '../services/geo';
import { registerPush } from '../services/push';
import { getUnreadCount } from '../services/notifications.api';
import { codDueRupees, validateCodCollection } from '../utils/money';
import { isLicenseExpired } from '../utils/riderDocuments';
import { OFFER_POLL_MS, PRESENCE_INTERVAL_MS, PROFILE_REFRESH_MS, RETURN_POLL_MS, TRIP_PING_MIN_MS } from '../config/env';

/**
 * Everything an approved rider does on duty, ported from the web DeliveryContext:
 * duty toggle, offers, the active delivery, return pickups, earnings and live location.
 *
 * Rules carried over from the web portal:
 *  - The server is the source of truth. The duty toggle shows what the server agreed to, an offer
 *    stays only while the server still lists it, and every stage change re-reads the delivery.
 *  - The socket makes things appear instantly; polling every few seconds corrects anything missed.
 *  - No money is calculated here. Balances and earnings are read from the server.
 * Mobile additions:
 *  - Polling, GPS and the socket pause when the app is in the background (no background tracking).
 *  - Every action has an in-flight guard, so a double tap sends one request.
 */
const DutyContext = createContext(null);
export const useDuty = () => {
  const ctx = useContext(DutyContext);
  if (!ctx) throw new Error('useDuty must be used inside DutyProvider');
  return ctx;
};

// Same value as backend/shared/deliveryCash.mjs RIDER_COD_CASH_LIMIT (the web dashboard imports it).
export const RIDER_COD_CASH_LIMIT = 2000;
const offerKey = (offer) => (offer ? String(offer.orderId || offer._id) : null);

export function DutyProvider({ children }) {
  const { token, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const approved = profile?.status === 'approved';

  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [online, setOnline] = useState(Boolean(profile?.isAvailable));
  const [toggling, setToggling] = useState(false);
  const [offer, setOffer] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);
  const [activeLoaded, setActiveLoaded] = useState(false);
  const [returnPickups, setReturnPickups] = useState({ pending: [], active: [], history: [] });
  const [returnOffer, setReturnOffer] = useState(null);
  const [parcelOffer, setParcelOffer] = useState(null); // a parcel booking carrying a live `offer`
  const closedParcelOffers = useRef(new Set());          // offer tokens answered or expired on this phone
  const [summary, setSummary] = useState(null);       // GET /earnings/summary data
  const [summaryError, setSummaryError] = useState('');
  const [presence, setPresence] = useState({ state: 'idle', message: '', updatedAt: null });
  const [tripSharing, setTripSharing] = useState({ on: false, error: '' });
  const [riderLocation, setRiderLocation] = useState(null);
  const busy = useRef(new Set());

  // Profile -> duty status. The server's isAvailable wins over anything tapped.
  useEffect(() => { setOnline(Boolean(profile?.isAvailable)); }, [profile?.isAvailable]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setAppActive(next === 'active'));
    return () => sub.remove();
  }, []);

  /** Runs `fn` once at a time per key. A second tap while the first is running is ignored. */
  const guarded = useCallback(async (key, fn) => {
    if (busy.current.has(key)) return undefined;
    busy.current.add(key);
    try { return await fn(); } finally { busy.current.delete(key); }
  }, []);

  // ------------------------------------------------------------ reads
  const restoreActive = useCallback(async () => {
    if (!approved) return null;
    try {
      const active = await deliveryApi.getActiveDelivery();
      setActiveOrder(active);
      setActiveLoaded(true);
      return active;
    } catch {
      setActiveLoaded(true);
      return undefined; // offline: keep what is on screen
    }
  }, [approved]);

  const loadSummary = useCallback(async () => {
    if (!approved) return;
    try { setSummary(await deliveryApi.getEarningsSummary()); setSummaryError(''); }
    catch (e) { setSummaryError(e.message || 'Could not load earnings'); }
  }, [approved]);

  const checkOffers = useCallback(async () => {
    if (!approved || !online) return;
    try {
      const list = await deliveryApi.getPendingOffers();
      setOffer((curr) => {
        if (!list.length) return null;
        const still = curr && list.some((o) => offerKey(o) === offerKey(curr));
        return still ? curr : list[0];
      });
    } catch { /* keep the current offer; the next poll reconciles */ }
  }, [approved, online]);

  const checkParcelOffers = useCallback(async () => {
    if (!approved || !online) return;
    try {
      const open = (await deliveryApi.getParcelOffers()).filter((b) => !closedParcelOffers.current.has(b.offer.token));
      setParcelOffer((curr) => (curr && open.some((b) => b.offer.token === curr.offer.token) ? curr : open[0] || null));
    } catch { /* keep the current offer; the next poll reconciles */ }
  }, [approved, online]);

  const loadReturnPickups = useCallback(async () => {
    if (!approved) return;
    try {
      const data = await deliveryApi.getReturnPickups();
      setReturnPickups(data);
      setReturnOffer((curr) => {
        if (!online || !data.pending.length) return null;
        if (curr && data.pending.some((r) => String(r._id) === String(curr.returnId))) return curr;
        const first = data.pending[0];
        return {
          returnId: String(first._id), returnNumber: first.returnNumber, productName: first.productName, quantity: first.quantity,
          pickupAddress: first.orderId?.shippingAddress, dropAddress: first.sellerId?.storeDetails,
          sellerName: first.sellerId?.businessName || first.sellerId?.storeDetails?.name,
          pickupDistanceKm: first.pickupDistanceKm, routeDistanceKm: first.routeDistanceKm,
        };
      });
    } catch { /* keep the last list */ }
  }, [approved, online]);

  // First load for an approved rider.
  useEffect(() => {
    if (!approved) { setActiveOrder(null); setActiveLoaded(true); return; }
    restoreActive();
    loadSummary();
    loadReturnPickups();
  }, [approved, restoreActive, loadSummary, loadReturnPickups]);

  // Push: an approved rider is reachable even off duty (same as the web portal).
  // Location is asked on first open too (right after the notification prompt), not only when going on duty,
  // so a fresh install shows both prompts. Both go through the permission queue, one dialog at a time.
  useEffect(() => {
    if (!approved) return;
    (async () => { await registerPush({ askPermission: true }); await requestLocationPermission(); })();
  }, [approved, profile?._id]);

  // ------------------------------------------------------------ live: socket + polling (foreground only)
  useEffect(() => {
    if (!approved || !token || !appActive) return undefined;
    connectRiderSocket(token);
    const offs = [
      onRiderEvent('rider_ping', (order) => { if (order) setOffer((curr) => (curr && offerKey(curr) === offerKey(order) ? curr : order)); }),
      onRiderEvent('ping_cancelled', () => setOffer(null)),
      onRiderEvent('delivery_assigned', () => { setOffer(null); restoreActive(); }),
      onRiderEvent('return_pickup_ping', (incoming) => setReturnOffer((curr) => (curr && String(curr.returnId) === String(incoming?.returnId) ? curr : incoming))),
      onRiderEvent('notification_new', (n) => {
        if (['COD_CASH_SETTLED', 'PAYOUT_COMPLETED', 'PAYOUT_REJECTED'].includes(n?.event)) { refreshProfile(); loadSummary(); }
        if (n?.event === 'PARCEL_OFFER' || n?.event === 'PARCEL_UPDATED') checkParcelOffers();
      }),
      onRiderEvent('rider_rating_updated', () => refreshProfile()),
      onRiderEvent('connect', () => { checkOffers(); checkParcelOffers(); restoreActive(); }),
    ];
    return () => offs.forEach((off) => off());
  }, [approved, token, appActive, restoreActive, refreshProfile, loadSummary, checkOffers, checkParcelOffers]);

  // No live connection in the background; push notifications reach the rider instead.
  useEffect(() => { if (!appActive || !approved) disconnectRiderSocket(); }, [appActive, approved]);

  useEffect(() => {
    if (!online) { setOffer(null); setReturnOffer(null); setParcelOffer(null); return undefined; }
    if (!appActive) return undefined;
    checkOffers();
    checkParcelOffers();
    const a = setInterval(checkOffers, OFFER_POLL_MS);
    const b = setInterval(loadReturnPickups, RETURN_POLL_MS);
    const c = setInterval(checkParcelOffers, OFFER_POLL_MS);
    loadReturnPickups();
    return () => { clearInterval(a); clearInterval(b); clearInterval(c); };
  }, [online, appActive, checkOffers, loadReturnPickups, checkParcelOffers]);

  useEffect(() => {
    if (!approved || !appActive) return undefined;
    const t = setInterval(() => { refreshProfile(); }, PROFILE_REFRESH_MS);
    return () => clearInterval(t);
  }, [approved, appActive, refreshProfile]);

  // Coming back to the foreground: catch up immediately.
  useEffect(() => {
    if (appActive && approved) { refreshProfile(); restoreActive(); loadSummary(); }
  }, [appActive, approved, refreshProfile, restoreActive, loadSummary]);

  // ------------------------------------------------------------ unread notifications (header bell)
  const [unreadCount, setUnreadCount] = useState(0);
  const loadUnread = useCallback(async () => {
    if (!approved) return;
    try {
      const body = await getUnreadCount();
      const n = Number(body?.data?.count ?? body?.data?.unreadCount ?? body?.count);
      if (Number.isFinite(n)) setUnreadCount(n);
    } catch { /* keep the last count */ }
  }, [approved]);
  useEffect(() => {
    if (!approved || !appActive) return undefined;
    loadUnread();
    const t = setInterval(loadUnread, PROFILE_REFRESH_MS);
    const off = onRiderEvent('notification_new', loadUnread);
    return () => { clearInterval(t); off(); };
  }, [approved, appActive, loadUnread]);

  // ------------------------------------------------------------ presence heartbeat while on duty (foreground only)
  // Fully automatic: a fix is sent when duty starts, every minute after, and whenever the app comes back
  // to the foreground. The permission prompt is shown only on the first attempt of each duty session,
  // so a rider who said "not now" is not asked again every minute.
  const presenceAsked = useRef(false);
  const sendPresenceNow = useCallback(async () => {
    setPresence((p) => ({ ...p, state: 'updating' }));
    const ask = !presenceAsked.current;
    presenceAsked.current = true;
    const fix = await getCurrentPoint({ ask });
    if (!fix.ok) { setPresence((p) => ({ ...p, state: 'error', message: fix.message })); return; }
    try {
      await deliveryApi.sendPresence({ lat: fix.point.lat, lng: fix.point.lng, source: 'gps' });
      setRiderLocation({ lat: fix.point.lat, lng: fix.point.lng });
      setPresence({ state: 'ok', message: '', updatedAt: Date.now() });
    } catch {
      setPresence((p) => ({ ...p, state: 'error', message: 'Live location could not update. Check your connection.' }));
    }
  }, []);

  useEffect(() => {
    if (!online) presenceAsked.current = false;
    if (!online || !approved || !appActive) { setPresence((p) => ({ ...p, state: 'idle' })); return undefined; }
    sendPresenceNow();
    const t = setInterval(sendPresenceNow, PRESENCE_INTERVAL_MS);
    return () => clearInterval(t);
  }, [online, approved, appActive, sendPresenceNow]);

  // ------------------------------------------------------------ live trip location (forward first, else a return pickup)
  const activeReturn = returnPickups.active.find((r) => ['ASSIGNED', 'PICKED_UP'].includes(r.pickup?.status));
  const tripTarget = activeOrder?.orderId ? { kind: 'order', id: String(activeOrder.orderId) }
    : activeReturn ? { kind: 'return', id: String(activeReturn._id) } : null;
  const tripKey = tripTarget ? `${tripTarget.kind}:${tripTarget.id}` : null;

  useEffect(() => {
    if (!tripKey || !appActive) { setTripSharing({ on: false, error: '' }); return undefined; }
    const [kind, targetId] = tripKey.split(':');
    let stopped = false, stop = null, lastSent = 0;
    (async () => {
      const first = await getCurrentPoint({ ask: true });
      if (stopped) return;
      if (!first.ok) { setTripSharing({ on: false, error: first.message }); return; }
      setTripSharing({ on: true, error: '' });
      stop = watchPoint(async (point) => {
        setRiderLocation({ lat: point.lat, lng: point.lng });
        const now = Date.now();
        if (now - lastSent < TRIP_PING_MIN_MS) return;
        lastSent = now;
        try {
          if (kind === 'order') await deliveryApi.sendTripLocation(targetId, { lat: point.lat, lng: point.lng, accuracy: point.accuracy, source: 'gps' });
          else await deliveryApi.sendReturnLocation(targetId, { lat: point.lat, lng: point.lng });
        } catch { /* a dropped ping is not worth interrupting a delivery; the next movement sends a fresh one */ }
      }, (message) => setTripSharing({ on: false, error: message }));
    })();
    return () => { stopped = true; stop?.(); };
  }, [tripKey, appActive]);

  // ------------------------------------------------------------ duty toggle
  const licenseExpired = isLicenseExpired(profile);
  const codOutstanding = Number(profile?.finance?.reportedCodOutstanding) || 0;
  const codBlocked = codOutstanding >= RIDER_COD_CASH_LIMIT;

  const setDuty = useCallback((wantOnline) => guarded('duty', async () => {
    if (wantOnline && licenseExpired) { toast.show('Your driving licence has expired. Update it before going online.', 'error'); return false; }
    if (wantOnline && codBlocked) { toast.show('Your COD cash limit is reached. Hand over the cash to go online.', 'error'); return false; }
    setToggling(true);
    try {
      let coords;
      if (wantOnline) {
        const fix = await getCurrentPoint({ ask: true, timeout: 8000 });
        if (fix.ok) coords = { lat: fix.point.lat, lng: fix.point.lng };
      }
      const body = await deliveryApi.setAvailability(wantOnline, coords);
      setOnline(Boolean(body?.data?.isAvailable));
      toast.show(body?.message || (body?.data?.isAvailable ? 'You are online.' : 'You are offline.'), 'success');
      refreshProfile();
      return true;
    } catch (e) {
      toast.show(e.message || 'Could not change your duty status', 'error');
      return false;
    } finally {
      setToggling(false);
    }
  }), [guarded, licenseExpired, codBlocked, toast, refreshProfile]);

  // ------------------------------------------------------------ offers
  const acceptOffer = useCallback((o) => guarded('offer', async () => {
    const orderId = offerKey(o);
    try {
      await deliveryApi.acceptOffer(orderId);
    } catch (e) {
      setOffer(null); // a refused offer is stale; it comes off the screen
      toast.show(e.message || 'This order is no longer available.', 'error');
      return false;
    }
    setOffer(null);
    const active = await restoreActive();
    if (active === undefined) setActiveOrder({ ...o, orderId, step: 'pickup', stage: 'accepted', otpSent: false, items: o.items || [] });
    toast.show('Order accepted. Head to the store.', 'success');
    return true;
  }), [guarded, restoreActive, toast]);

  const declineOffer = useCallback((o) => guarded('offer', async () => {
    try { await deliveryApi.declineOffer(offerKey(o)); toast.show('Order declined.'); setOffer(null); }
    catch (e) {
      if (e.status) { setOffer(null); toast.show(e.message || 'This offer is no longer available.'); }
      else toast.show(e.message, 'error'); // network: keep it, the server never heard
    }
  }), [guarded, toast]);

  const expireOffer = useCallback((o) => guarded('offer', async () => {
    try { await deliveryApi.expireOffer(offerKey(o)); setOffer(null); }
    catch (e) { if (e.status) setOffer(null); } // network: leave it for the next poll to reconcile
  }), [guarded]);

  // ------------------------------------------------------------ parcel offers
  // The server's `offer.expiresAt` is the deadline; an expired offer just closes (the server moves it on).
  const closeParcelOffer = useCallback((b) => {
    if (b?.offer?.token) closedParcelOffers.current.add(b.offer.token);
    setParcelOffer(null);
    checkParcelOffers(); // another offer may be waiting
  }, [checkParcelOffers]);

  const respondParcel = useCallback((b, action) => guarded('parcel-offer', async () => {
    try {
      await deliveryApi.respondParcelOffer(b, action);
      closeParcelOffer(b);
      toast.show(action === 'accept' ? 'Parcel assigned to you. Open it for pickup details.' : 'Parcel offer declined.', 'success');
      return true;
    } catch (e) {
      if (e.status) { closeParcelOffer(b); toast.show(e.status === 409 || e.status === 404 ? 'This parcel is no longer available.' : (e.message || 'Could not answer this offer.'), 'error'); }
      else toast.show(e.message || 'No connection. Try again.', 'error'); // network: keep it, the server never heard
      return false;
    }
  }), [guarded, closeParcelOffer, toast]);
  const acceptParcel = useCallback((b) => respondParcel(b, 'accept'), [respondParcel]);
  const declineParcel = useCallback((b) => respondParcel(b, 'reject'), [respondParcel]);

  // ------------------------------------------------------------ active delivery
  const afterStage = useCallback(async (patch) => {
    const fresh = await restoreActive();
    if (fresh === undefined) setActiveOrder((prev) => (prev ? { ...prev, ...patch } : prev));
  }, [restoreActive]);

  const updateStage = useCallback((status, message) => guarded('stage', async () => {
    if (!activeOrder) return false;
    try {
      await deliveryApi.updateStage(activeOrder.orderId, status);
      await afterStage({ stage: status, ...(status === 'picked_up' ? { step: 'transit' } : {}) });
      toast.show(message, 'success');
      return true;
    } catch (e) {
      toast.show(e.message || 'Could not update the delivery', 'error');
      if (e.status === 409) restoreActive();
      return false;
    }
  }), [guarded, activeOrder, afterStage, toast, restoreActive]);

  const markArrivedAtStore = useCallback(() => updateStage('arrived_at_store', 'Marked as arrived. Collect the order.'), [updateStage]);
  const confirmPickup = useCallback(() => updateStage('picked_up', 'Picked up. Navigate to the customer.'), [updateStage]);
  const markArrivedAtCustomer = useCallback(() => updateStage('arrived_at_customer', 'Marked as arrived. Ask the customer for their code.'), [updateStage]);

  const sendDeliveryCode = useCallback(() => guarded('otp-send', async () => {
    if (!activeOrder) return false;
    try {
      const body = await deliveryApi.requestDeliveryOtp(activeOrder.orderId);
      await afterStage({ otpSent: true });
      toast.show(body?.message || 'Code sent to the customer. Ask them for it.', 'success');
      return true;
    } catch (e) { toast.show(e.message || 'Could not send the code', 'error'); return false; }
  }), [guarded, activeOrder, afterStage, toast]);

  /**
   * Verify the customer's code and complete. For COD the typed cash must equal the server's
   * rounded `codAmount` exactly; the request is not sent otherwise.
   * Returns { ok, message?, codWarning? }.
   */
  const completeDelivery = useCallback((otp, cashText) => guarded('otp-verify', async () => {
    if (!activeOrder) return { ok: false };
    if (!/^\d{4}$/.test(String(otp || ''))) return { ok: false, message: 'Enter the 4-digit code from the customer.' };
    let codCollected;
    if (activeOrder.paymentMethod === 'COD') {
      const check = validateCodCollection(cashText, codDueRupees(activeOrder));
      if (!check.ok) return { ok: false, message: check.message };
      codCollected = check.amount;
    }
    try {
      const body = await deliveryApi.verifyDeliveryOtp(activeOrder.orderId, otp, codCollected);
      const d = body?.data || {};
      setActiveOrder(null);
      refreshProfile();
      loadSummary();
      const earned = Number(d.earnings);
      const message = d.earningStatus === 'reconciliation_required' ? 'Delivered. Earnings are awaiting rate and distance checks.'
        : Number.isFinite(earned) ? `Delivered. Earned ₹${earned}.` : 'Delivered. Check Earnings for the payment.';
      toast.show(message, 'success');
      const codWarning = d.codCollection?.recorded === false
        ? `Delivered, but the cash amount was not saved: ${d.codCollection.message}. Report it from the Cash screen.` : null;
      return { ok: true, codWarning };
    } catch (e) {
      if (!e.status) {
        // No answer: the delivery may or may not have completed. Completion is idempotent on the server,
        // so re-reading is safe and retrying never double-credits.
        const now = await restoreActive();
        if (now === null) { refreshProfile(); loadSummary(); return { ok: true, message: 'The server shows this delivery as complete.' }; }
        return { ok: false, message: 'No confirmation from the server. Check your connection, then try again — a repeat will not complete the order twice.' };
      }
      if (e.status === 409) restoreActive();
      return { ok: false, message: e.message || 'Code could not be verified' };
    }
  }), [guarded, activeOrder, refreshProfile, loadSummary, restoreActive, toast]);

  const cancelActive = useCallback(() => guarded('cancel', async () => {
    if (!activeOrder) return false;
    try {
      const body = await deliveryApi.cancelDelivery(activeOrder.orderId);
      setActiveOrder(null);
      toast.show(body?.message || 'Delivery cancelled.');
      refreshProfile();
      return true;
    } catch (e) {
      toast.show(e.message || 'Could not cancel this delivery.', 'error');
      if (e.status) restoreActive();
      return false;
    }
  }), [guarded, activeOrder, toast, refreshProfile, restoreActive]);

  // ------------------------------------------------------------ return pickups
  const returnAction = useCallback((key, fn, okMessage) => guarded(key, async () => {
    try {
      const body = await fn();
      if (okMessage) toast.show(body?.message || okMessage, 'success');
      return { ok: true, body };
    } catch (e) {
      toast.show(e.message || 'Could not update the return pickup', 'error');
      return { ok: false, message: e.message, status: e.status };
    } finally {
      loadReturnPickups();
    }
  }), [guarded, toast, loadReturnPickups]);

  const acceptReturn = useCallback(async (returnId) => {
    const r = await returnAction(`ret:${returnId}`, () => deliveryApi.acceptReturnPickup(returnId), 'Pickup accepted');
    setReturnOffer(null);
    return r;
  }, [returnAction]);
  const declineReturn = useCallback(async (returnId) => {
    const r = await returnAction(`ret:${returnId}`, () => deliveryApi.declineReturnPickup(returnId), 'Pickup declined');
    if (r?.ok || r?.status) setReturnOffer(null);
    return r;
  }, [returnAction]);
  const expireReturn = useCallback(async (returnId) => {
    try { await deliveryApi.expireReturnPickup(returnId); } catch { /* best effort */ }
    setReturnOffer(null);
    loadReturnPickups();
  }, [loadReturnPickups]);
  const sendReturnCode = useCallback((returnId) => returnAction(`retotp:${returnId}`, () => deliveryApi.requestReturnOtp(returnId), 'Pickup code sent to the customer'), [returnAction]);
  const confirmReturnPickup = useCallback(async (returnId, otp) => {
    if (!/^\d{4}$/.test(String(otp || ''))) { toast.show('Enter the 4-digit pickup code.', 'error'); return { ok: false }; }
    const r = await returnAction(`retverify:${returnId}`, () => deliveryApi.verifyReturnOtp(returnId, otp), 'Pickup confirmed');
    if (r?.ok) loadSummary();
    return r;
  }, [returnAction, toast, loadSummary]);

  const value = useMemo(() => ({
    approved, online, toggling, setDuty, licenseExpired, codOutstanding, codBlocked, codLimit: RIDER_COD_CASH_LIMIT,
    offer, acceptOffer, declineOffer, expireOffer,
    activeOrder, activeLoaded, restoreActive, markArrivedAtStore, confirmPickup, markArrivedAtCustomer, sendDeliveryCode, completeDelivery, cancelActive,
    returnPickups, loadReturnPickups, returnOffer, acceptReturn, declineReturn, expireReturn, sendReturnCode, confirmReturnPickup,
    parcelOffer, checkParcelOffers, acceptParcel, declineParcel, closeParcelOffer,
    summary, summaryError, loadSummary,
    presence, tripSharing, riderLocation, unreadCount, loadUnread,
  }), [approved, online, toggling, setDuty, licenseExpired, codOutstanding, codBlocked, offer, acceptOffer, declineOffer, expireOffer,
    activeOrder, activeLoaded, restoreActive, markArrivedAtStore, confirmPickup, markArrivedAtCustomer, sendDeliveryCode, completeDelivery, cancelActive,
    returnPickups, loadReturnPickups, returnOffer, acceptReturn, declineReturn, expireReturn, sendReturnCode, confirmReturnPickup,
    parcelOffer, checkParcelOffers, acceptParcel, declineParcel, closeParcelOffer,
    summary, summaryError, loadSummary, presence, tripSharing, riderLocation, unreadCount, loadUnread]);

  return <DutyContext.Provider value={value}>{children}</DutyContext.Provider>;
}
