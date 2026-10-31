// Port of frontend/src/modules/User/context/UserContext.jsx — the customer app's state: navigation, session,
// cart, coupons, addresses, wallet, orders, wishlist, realtime updates and checkout.
// Business rules are unchanged: every total, charge, coupon and eligibility comes from the server.
// Platform changes only: window.history → Expo Router, localStorage → storage mirror, window events → app events.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePathname, useRouter, useRootNavigationState } from 'expo-router';
import { boundedFetch, portalRequest, request as apiRequest, authHeaders as clientAuthHeaders } from '../api/client';
import { local, session as sessionStore, readJSON } from '../lib/storage';
import { emit, on, EVENTS } from '../lib/events';
import { saveUserSession, clearUserSession, captureUserSession, isCurrentUserSession, onSessionCleared } from '../lib/session';
import { socket, connectSocket, disconnectSocket } from '../lib/socket';
import { initPushNotifications, deregisterPushToken, setPushRecipient } from '../lib/push';
import { rememberCommittedCheckout, committedCheckouts, deferCommittedCheckout } from '../lib/committedCheckout';
import { readBrowsingLocation, saveBrowsingLocation, shouldPromptForLocation, rememberLocationChoice, validPoint } from '../lib/locationState';
import { productHref } from '../lib/productRoute';
import { normalizeProduct } from '../hooks/useProducts';
import { useSession } from './SessionContext';
import { openRazorpayCheckout } from '../lib/razorpay';

const UserContext = createContext(null);

const couponCartSignature = (channel, items = []) => `${channel}:${JSON.stringify(items.map(item => [
  item.productId, item.variantId, item.qty, item.price, item.sellerId,
  item.categoryId || item.category, item.type, item.fulfillmentType, item.deliveryMode,
]))}`;

const STOREFRONT_KEY = 'nh_storefront';
const rememberedMode = () => { const saved = local.getItem(STOREFRONT_KEY); return saved === 'quick' || saved === 'shop-all' ? saved : null; };
const defaultSubNav = mode => (mode === 'quick' ? 'grocery--home' : 'ecommerce--smart-buy');

// Which screen a route path belongs to (web: getNavFromPath).
const NAV_ROUTES = ['categories', 'orders', 'ebooks', 'account', 'cart', 'checkout', 'wishlist', 'search', 'wholesale', 'services', 'legal-services', 'parcel-delivery'];
export const navFromPath = pathname => {
  const first = String(pathname || '/').split('/').filter(Boolean)[0];
  if (!first) return 'home';
  if (first === 'wholesale-cart') return 'wholesale';
  if (first === 'order') return 'order';
  return NAV_ROUTES.includes(first) || ['product', 'campaign', 'review'].includes(first) ? first : 'home';
};

const PAYMENT_CODE = { 'Cash on Delivery': 'cod', 'Online Payment': 'online', Wallet: 'wallet', wallet: 'wallet', cod: 'cod', online: 'online' };

export function UserProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const rootState = useRootNavigationState();
  const restoredSession = useSession();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  // ---------------- Navigation & mode ----------------
  const [activeMode, setActiveModeState] = useState(() => rememberedMode() || 'quick');
  const [productTab, setProductTab] = useState('quick');
  const activeNav = navFromPath(pathname);
  const [activeSubNav, setActiveSubNavState] = useState(() => defaultSubNav(rememberedMode() || 'quick'));
  const subNavHistory = useRef([]);
  useEffect(() => { local.setItem(STOREFRONT_KEY, activeMode); }, [activeMode]);

  const setActiveMode = mode => setActiveModeState(mode);

  // Routes currently in the stack, so a tab tap returns to an open screen instead of stacking a copy.
  const stackHas = href => {
    const name = href === '/' ? 'index' : href.replace(/^\//, '');
    return Boolean(rootState?.routes?.some(route => route.name === name));
  };

  const currentUserRef = useRef(null);
  const setActiveNav = useCallback((navId) => {
    if (navId === 'checkout') {
      const customerId = currentUserRef.current?._id || currentUserRef.current?.id;
      for (const reference of committedCheckouts(customerId)) if (!reference.deferred) deferCommittedCheckout(customerId, reference.key);
    }
    const href = navId === 'home' ? '/' : `/${navId}`;
    if (navId === 'home') {
      setActiveSubNavState(defaultSubNav(activeModeRef.current));
      subNavHistory.current = [];
    }
    if (pathRef.current === href) return;
    if (stackHas(href)) router.dismissTo(href); else router.push(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, rootState]);
  const activeModeRef = useRef(activeMode);
  activeModeRef.current = activeMode;
  /** Close the current overlay screen and open `navId` in its place (web: overlay closes, URL changes). */
  const replaceNav = useCallback(navId => {
    if (navId === 'checkout') {
      const customerId = currentUserRef.current?._id || currentUserRef.current?.id;
      for (const reference of committedCheckouts(customerId)) if (!reference.deferred) deferCommittedCheckout(customerId, reference.key);
    }
    const href = navId === 'home' ? '/' : `/${navId}`;
    if (stackHas(href)) router.dismissTo(href); else router.replace(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, rootState]);

  const setActiveSubNav = useCallback(subNavId => {
    setActiveSubNavState(previous => {
      if (previous !== subNavId) subNavHistory.current = [...subNavHistory.current, previous].slice(-20);
      return subNavId;
    });
  }, []);
  /** Android back on Home steps back through sub-nav tabs first (web: history entries per tab). */
  const popSubNav = useCallback(() => {
    const previous = subNavHistory.current.pop();
    if (!previous) return false;
    setActiveSubNavState(previous);
    return true;
  }, []);

  const [selectedCategoryFilter, setSelectedCategoryFilterState] = useState(null);
  const setSelectedCategoryFilter = category => {
    setSelectedCategoryFilterState(category?.slug ? category : null);
    if (pathRef.current !== '/categories') { if (stackHas('/categories')) router.dismissTo('/categories'); else router.push('/categories'); }
  };

  // Voice / image search
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [pendingVoiceQuery, setPendingVoiceQuery] = useState('');
  const openVoiceSearch = () => setIsVoiceModalOpen(true);
  const closeVoiceSearch = () => setIsVoiceModalOpen(false);
  const [imageSearchRequest, setImageSearchRequest] = useState(0);
  const openImageSearch = () => { setImageSearchRequest(value => value + 1); setActiveNav('search'); };

  // ---------------- Session ----------------
  const [currentUser, setCurrentUser] = useState(() => (restoredSession.verified ? restoredSession.profile : null));
  currentUserRef.current = currentUser;
  useEffect(() => { setCurrentUser(restoredSession.verified ? restoredSession.profile : null); }, [restoredSession.verified, restoredSession.profile]);
  const isSignedIn = () => restoredSession.verified && Boolean(local.getItem('userToken'));
  const sessionKey = restoredSession.verified ? restoredSession.token : 'guest';
  useEffect(() => { setPushRecipient(currentUser?._id || null); }, [currentUser?._id]);

  // Push registration once there is a signed-in customer (no prompt here; see placeOrder).
  useEffect(() => { if (currentUser) initPushNotifications().catch(() => {}); }, [currentUser]);
  const requestPushPermission = async () => initPushNotifications({ requestPermission: true }).catch(() => false);

  // ---------------- Location ----------------
  const [location, setLocation] = useState(() => readBrowsingLocation()?.label || 'Set your location');
  const [showLocationModal, setLocationModalOpen] = useState(() => shouldPromptForLocation());
  const setShowLocationModal = value => { if (!value) rememberLocationChoice('dismissed'); setLocationModalOpen(value); };

  // ---------------- Product detail (opened as the /product route) ----------------
  const [selectedProduct, setSelectedProductState] = useState(null);
  const setSelectedProduct = useCallback(product => {
    const normalized = product ? (product.variants?.length && product.category !== undefined ? product : normalizeProduct(product?.raw || product)) : null;
    setSelectedProductState(normalized);
    if (normalized?.id) router.push(productHref(normalized.id, { purchase: normalized.detailSource === 'wholesale' ? 'wholesale' : undefined }));
    else if (pathRef.current === '/product' && router.canGoBack()) router.back();
  }, [router]);
  const openWholesaleProduct = useCallback((id, variantId) => router.push(productHref(id, { purchase: 'wholesale', variant: variantId })), [router]);
  const openProductById = useCallback(id => router.push(productHref(id)), [router]);

  // ---------------- Coupons ----------------
  const [couponCode, setCouponCode] = useState('');
  const activeCouponCode = useRef(couponCode);
  activeCouponCode.current = couponCode;
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponCelebration, setCouponCelebration] = useState(null);
  const [couponNotice, setCouponNotice] = useState('');
  const couponEventId = useRef(0);
  const couponApplying = useRef(false);
  const suppressedAuto = useRef(null);
  const offersRequest = useRef(0);

  // ---------------- Addresses ----------------
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState(null);

  // ---------------- Wallet ----------------
  const [walletBalance, setWalletBalance] = useState(0);
  const walletRead = useRef(0);
  const fetchWalletBalance = useCallback(async () => {
    const request = ++walletRead.current;
    if (!isSignedIn()) { setWalletBalance(0); return; }
    const snapshot = captureUserSession();
    try {
      const res = await portalRequest(snapshot.token, '/api/wallet', { fresh: true });
      if (!res.ok) return;
      const body = await res.json();
      if (request === walletRead.current && isCurrentUserSession(snapshot) && body.success !== false && Number.isFinite(body.data?.balance)) setWalletBalance(body.data.balance);
    } catch { /* balance stays as shown */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  useEffect(() => { fetchWalletBalance(); return () => { walletRead.current++; }; }, [fetchWalletBalance]);

  // ---------------- Orders ----------------
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const orderRead = useRef(0);
  const orderController = useRef(null);
  useEffect(() => () => { orderRead.current++; orderController.current?.abort(); }, []);
  const [selectedOrder, setSelectedOrderState] = useState(null);
  const fetchOrders = useCallback(async () => {
    const request = ++orderRead.current;
    orderController.current?.abort();
    if (!isSignedIn()) { setOrders([]); setSelectedOrderState(null); setOrdersLoading(false); return; }
    const controller = new AbortController();
    orderController.current = controller;
    const snapshot = captureUserSession();
    const current = () => request === orderRead.current && isCurrentUserSession(snapshot);
    setOrdersLoading(true); setOrdersError('');
    try {
      const res = await boundedFetch('/api/orders?limit=50', { signal: controller.signal, headers: { Authorization: `Bearer ${snapshot.token}` } });
      const body = await res.json().catch(() => ({}));
      if (!current()) return;
      if (!res.ok || body.success === false || !Array.isArray(body.data)) throw new Error(body.message || 'Could not refresh your orders. Please retry.');
      setOrders(body.data);
      setSelectedOrderState(previous => {
        if (!previous) return previous;
        const fresh = body.data.find(order => String(order._id) === String(previous._id));
        return fresh ? { ...previous, ...fresh } : previous;
      });
    } catch (err) {
      if (current() && err?.name !== 'AbortError') setOrdersError(err.message || 'Could not refresh your orders. Please retry.');
    } finally {
      if (current()) setOrdersLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  /** Order tracking is the /order/:id route; closing returns to wherever it was opened from. */
  const selectOrder = useCallback(order => {
    setSelectedOrderState(order);
    if (order?._id) router.push(`/order/${order._id}`);
    else if (pathRef.current.startsWith('/order/') && router.canGoBack()) router.back();
  }, [router]);

  const orderViewActive = activeNav === 'orders' || activeNav === 'order';
  useEffect(() => {
    void fetchOrders();
    if (!orderViewActive) return undefined;
    // Same refresh rules as the web: on focus and every 15 s while an order view is open.
    const refresh = () => { if (AppState.currentState === 'active') void fetchOrders(); };
    const appState = AppState.addEventListener('change', state => { if (state === 'active') void fetchOrders(); });
    const timer = setInterval(refresh, 15000);
    return () => { clearInterval(timer); appState.remove(); };
  }, [fetchOrders, orderViewActive]);

  const [activeRider, setActiveRider] = useState(null);
  const [returnPickupOtp, setReturnPickupOtp] = useState(null);
  const [selectedCampaignId, setSelectedCampaignIdState] = useState(null);
  const setSelectedCampaignId = useCallback(id => {
    setSelectedCampaignIdState(id || null);
    if (id) router.push(`/campaign/${id}`);
    else if (pathRef.current.startsWith('/campaign/') && router.canGoBack()) router.back();
  }, [router]);
  const [reviewProductId, setReviewProductIdState] = useState(null);
  const setReviewProductId = useCallback(id => {
    setReviewProductIdState(id || null);
    if (id) router.push(`/review/${id}`);
    else if (pathRef.current.startsWith('/review/') && router.canGoBack()) router.back();
  }, [router]);

  // ---------------- Wishlist ----------------
  const [wishlist, setWishlist] = useState(new Set());
  const [wishlistItems, setWishlistItems] = useState([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const refreshWishlist = useCallback(async () => {
    if (!isSignedIn()) { setWishlist(new Set()); setWishlistItems([]); return; }
    setWishlistLoading(true);
    try {
      const res = await portalRequest(local.getItem('userToken'), '/api/wishlist');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || 'Could not load your wishlist');
      setWishlistItems(payload.data?.items || []);
      setWishlist(new Set((payload.data?.productIds || []).map(String)));
    } catch { /* keep what is on screen */ } finally { setWishlistLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  useEffect(() => { refreshWishlist(); }, [refreshWishlist]);

  // ---------------- Realtime ----------------
  useEffect(() => {
    const token = local.getItem('userToken');
    const profile = readJSON(local, 'userProfile');
    if (restoredSession.verified && token && profile?._id) connectSocket(token, 'buyer', profile._id);
    const snapshot = captureUserSession();
    const updateOrder = (orderId, patch) => {
      if (!orderId) return;
      orderRead.current++;
      setOrders(previous => previous.map(order => String(order._id) === String(orderId) ? { ...order, ...patch } : order));
      setSelectedOrderState(previous => previous && String(previous._id) === String(orderId) ? { ...previous, ...patch } : previous);
      void fetchOrders();
    };
    const handlers = {
      connect: () => { void fetchOrders(); void fetchWalletBalance(); },
      notification_new: notification => {
        if (['REFUND_COMPLETED', 'WALLET_CREDIT', 'WALLET_DEBIT', 'PARCEL_UPDATED'].includes(notification?.event)) void fetchWalletBalance();
      },
      order_status_updated: ({ orderId, status, timeline }) => updateOrder(orderId, { ...(status ? { status } : {}), ...(Array.isArray(timeline) ? { timeline } : {}) }),
      rider_assigned: ({ orderId, riderName, riderPhone, vehicleType, otp, deliveryId }) => {
        setActiveRider({ orderId, name: riderName, phone: riderPhone, vehicleType, otp, deliveryId, lat: 22.71744, lng: 75.871511, step: 'pickup' });
        updateOrder(orderId, {});
      },
      delivery_status_updated: ({ orderId, stage, status }) => {
        setActiveRider(prev => (prev && prev.orderId === orderId ? { ...prev, step: stage || status } : prev));
        updateOrder(orderId, {});
      },
      location_update: ({ deliveryId, lat, lng }) => setActiveRider(prev => (prev && prev.deliveryId === deliveryId ? { ...prev, lat, lng } : prev)),
      otp_ready: ({ otp }) => setActiveRider(prev => (prev ? { ...prev, otp } : null)),
      return_pickup_otp_ready: ({ returnId, otp }) => setReturnPickupOtp({ returnId, otp }),
      order_delivered: ({ orderId }) => {
        setActiveRider(previous => (previous && String(previous.orderId) === String(orderId) ? null : previous));
        updateOrder(orderId, { status: 'delivered' });
      },
    };
    const listeners = Object.entries(handlers).map(([event, handler]) => {
      const listener = payload => { if (snapshot.token && isCurrentUserSession(snapshot)) handler(payload); };
      socket.on(event, listener);
      return [event, listener];
    });
    return () => { listeners.forEach(([event, listener]) => socket.off(event, listener)); disconnectSocket(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOrders, fetchWalletBalance]);

  // A session that ends (logout or 401) also stops push and realtime for this device.
  useEffect(() => onSessionCleared(() => { disconnectSocket(); }), []);

  // ---------------- Authentication ----------------
  const sendOtp = async (phone, isLogin) => {
    try {
      const { ok, body } = await apiRequest('/api/auth/send-otp', { method: 'POST', auth: false, body: { phone, isLogin } });
      if (!ok) throw new Error(body.message || 'Failed to send OTP');
      return { success: true, otp: body.otp };
    } catch (err) {
      return { success: false, message: err.message };
    }
  };

  const verifyOtp = async (phone, otp, isLogin, name, email) => {
    const snapshot = captureUserSession();
    try {
      const { ok, body: data } = await apiRequest('/api/auth/verify-otp', { method: 'POST', auth: false, body: { phone, otp, isLogin, name, email } });
      if (!ok) throw new Error(data.message || 'OTP verification failed');
      if (data.sessionRole !== 'buyer') throw new Error('Customer sign-in could not be completed. Please try again.');
      if (!isCurrentUserSession(snapshot)) throw new Error('Your session changed. Please sign in again.');
      saveUserSession(data);
      setCurrentUser(data.user);
      connectSocket(data.token, 'buyer', data.user._id);
      // Web: openSessionDashboard('buyer') → '/', then any saved return intent.
      let destination = '/';
      try {
        const parcelReturn = sessionStore.getItem('bulkimart:parcel-return');
        sessionStore.removeItem('bulkimart:parcel-return');
        if (/^\/parcel-delivery(?:\/(?:book|history|track\/[a-f0-9]{24}))?\/?$/i.test(parcelReturn || '')) destination = `/parcel-delivery?view=${encodeURIComponent(parcelReturn.replace(/^\/parcel-delivery\/?/, ''))}`;
      } catch { /* optional */ }
      let productReturn = null;
      try {
        const saved = JSON.parse(sessionStore.getItem('bulkimart:product-return') || 'null');
        sessionStore.removeItem('bulkimart:product-return');
        if (saved && /^[a-f0-9]{24}$/i.test(saved.productId)) productReturn = saved;
      } catch { /* optional */ }
      router.dismissTo('/');
      if (destination !== '/') setTimeout(() => router.push(destination), 0);
      else if (productReturn) setTimeout(() => router.push(productHref(productReturn.productId, { purchase: 'wholesale', variant: /^[a-f0-9]{24}$/i.test(productReturn.variantId || '') ? productReturn.variantId : undefined })), 0);
      return { success: true, isNewUser: data.isNewUser, user: data.user };
    } catch (err) {
      return { success: false, message: err.message };
    }
  };

  const updateUserProfile = async (name, email) => {
    try {
      const token = local.getItem('userToken');
      const { ok, body: data } = await apiRequest('/api/users/profile', { method: 'PUT', body: { name, email } });
      if (!ok) throw new Error(data.message || 'Profile update failed');
      if (token !== local.getItem('userToken')) return { success: false, message: 'Your session changed. Please sign in again.' };
      if (data.user) {
        const updatedProfile = { ...readJSON(local, 'userProfile', {}), ...data.user };
        local.setItem('userProfile', JSON.stringify(updatedProfile));
        setCurrentUser(updatedProfile);
      }
      return { success: true };
    } catch (err) {
      return { success: false, message: err.message };
    }
  };

  const fetchProfile = useCallback(async () => {
    if (!restoredSession.verified) return;
    const token = local.getItem('userToken');
    if (!token) return;
    try {
      const { ok, body: data } = await apiRequest('/api/users/profile');
      if (!ok || token !== local.getItem('userToken')) return;
      if (data.user) {
        const updatedProfile = { ...readJSON(local, 'userProfile', {}), ...data.user };
        local.setItem('userProfile', JSON.stringify(updatedProfile));
        setCurrentUser(updatedProfile);
      }
    } catch { /* keep the verified profile */ }
  }, [restoredSession.verified]);

  const logoutUser = async () => {
    const token = local.getItem('userToken');
    const pushCleanup = deregisterPushToken(token).catch(() => {});
    clearUserSession();
    setCurrentUser(null);
    setActiveNav('home');
    disconnectSocket();
    setWishlist(new Set());
    setWishlistItems([]);
    await pushCleanup;
  };

  // ---------------- Cart (server-backed, one basket per storefront) ----------------
  const authHeaders = (json = true) => clientAuthHeaders(json);
  const checkoutHeaders = (operation, payload) => {
    const storageKey = `bulkimart:checkout:${operation}:${currentUser?._id || currentUser?.id || 'customer'}`;
    const fingerprint = JSON.stringify(payload);
    let saved = readJSON(sessionStore, storageKey);
    if (!saved || saved.fingerprint !== fingerprint || !saved.key) {
      const key = globalThis.crypto?.randomUUID?.() || `bm-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      saved = { fingerprint, key };
      sessionStore.setItem(storageKey, JSON.stringify(saved));
    }
    return { ...authHeaders(), 'Idempotency-Key': saved.key };
  };
  const clearCheckoutKey = operation => sessionStore.removeItem(`bulkimart:checkout:${operation}:${currentUser?._id || currentUser?.id || 'customer'}`);

  const EMPTY_CART = { items: [], count: 0, pricing: null, warnings: [], channel: 'ecommerce' };
  const [cartChannel, setCartChannel] = useState(() => (activeMode === 'quick' ? 'grocery' : 'ecommerce'));
  const [deliveryMode, setDeliveryModeState] = useState(null);
  const [serverCart, setServerCart] = useState(EMPTY_CART);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartSummary, setCartSummary] = useState({});
  const [cartSummaryReady, setCartSummaryReady] = useState(false);
  const cartRequest = useRef(0);

  const refreshCartSummary = useCallback(async () => {
    if (!isSignedIn()) { setCartSummary({}); setCartSummaryReady(false); return; }
    const snapshot = captureUserSession();
    try {
      const { ok, body } = await apiRequest('/api/cart/summary');
      if (ok && isCurrentUserSession(snapshot)) setCartSummary(body.data || {});
    } catch { /* badges are non-critical */ } finally { setCartSummaryReady(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  useEffect(() => on(EVENTS.CART_CHANGED, refreshCartSummary), [refreshCartSummary]);
  const refreshCartSummaryRef = useRef(refreshCartSummary);
  useEffect(() => { refreshCartSummaryRef.current = refreshCartSummary; }, [refreshCartSummary]);

  const getSelectedAddress = () => savedAddresses.find(a => String(a._id) === String(selectedAddressId)) || savedAddresses.find(a => a.isDefault) || savedAddresses[0] || null;
  const pricingAddress = getSelectedAddress();
  const pricingPinKey = pricingAddress ? `${pricingAddress._id}:${pricingAddress.lat ?? ''},${pricingAddress.lng ?? ''}` : '';
  const getPricingPoint = () => {
    const addr = getSelectedAddress();
    if (!addr) return readBrowsingLocation()?.coords || null;
    return addr.lat != null && addr.lng != null ? { lat: addr.lat, lng: addr.lng } : null;
  };
  const getDeliveryPoint = () => {
    const addr = getSelectedAddress();
    if (!addr || addr.lat === undefined || addr.lng === undefined) return readBrowsingLocation()?.coords || null;
    return { lat: addr.lat, lng: addr.lng };
  };

  const refreshCart = useCallback(async (channel, coupon, mode) => {
    const request = ++cartRequest.current;
    const ch = channel || cartChannel;
    const cp = coupon !== undefined ? coupon : couponCode;
    const wantMode = mode !== undefined ? mode : deliveryMode;
    if (!isSignedIn()) { setServerCart({ ...EMPTY_CART, channel: ch }); return null; }
    setCartLoading(true);
    try {
      const qs = new URLSearchParams({ channel: ch });
      if (['/cart', '/checkout', '/wholesale-cart'].includes(pathRef.current)) qs.set('preserveUnavailable', 'true');
      if (cp) qs.set('coupon', cp);
      const point = getPricingPoint();
      if (point) { qs.set('lat', String(point.lat)); qs.set('lng', String(point.lng)); }
      if (wantMode) qs.set('deliveryMode', wantMode);
      const { status, body } = await apiRequest(`/api/cart?${qs}`);
      if (status === 401) { setServerCart({ ...EMPTY_CART, channel: ch }); return null; }
      const cartData = body.data || { ...EMPTY_CART, channel: ch };
      if (request !== cartRequest.current) return null;
      setServerCart(cartData);
      if (cp && (cartData.couponError || cartData.appliedCoupon?.code !== cp)) {
        setCouponNotice(cartData.couponError || 'Your coupon is no longer available for this cart.');
        setCouponCode('');
        setAppliedCoupon(null);
        suppressedAuto.current = couponCartSignature(ch, cartData.items);
      } else if (cartData.appliedCoupon) {
        setAppliedCoupon(cartData.appliedCoupon);
      }
      if (ch === 'ecommerce' && cartData.items?.length > 0) {
        const itemMode = cartData.items[0].deliveryMode;
        if (itemMode && itemMode !== wantMode) setDeliveryModeState(itemMode);
      }
      return cartData;
    } catch {
      if (request === cartRequest.current) setServerCart({ ...EMPTY_CART, channel: ch });
      return null;
    } finally {
      if (request === cartRequest.current) { setCartLoading(false); refreshCartSummaryRef.current(); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartChannel, couponCode, deliveryMode, selectedAddressId, pricingPinKey, sessionKey]);

  const setDeliveryMode = mode => setDeliveryModeState(mode);
  useEffect(() => { refreshCart(); }, [refreshCart]);
  useEffect(() => {
    setCartChannel(activeMode === 'quick' ? 'grocery' : 'ecommerce');
    setAvailableCoupons([]);
    setDeliveryModeState(null);
  }, [activeMode]);

  const cartCall = async (method, path, body) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to use your cart.' };
    try {
      const { ok, body: payload } = await apiRequest(`/api/cart${path}`, { method, body });
      if (!ok) {
        const serverMessage = String(payload.message || '');
        if (/E11000|duplicate key|customerId_1/i.test(serverMessage)) return { ok: false, message: 'We couldn’t update your cart right now. Please try again in a moment.' };
        return { ok: false, message: serverMessage || 'Could not update your cart' };
      }
      if (payload.data?.channel === cartChannel) setServerCart(payload.data);
      refreshCartSummary();
      return { ok: true, data: payload.data, message: payload.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const addToCart = async (productOrId, qty = 1, variantId) => {
    let product = productOrId && typeof productOrId === 'object' ? productOrId : null;
    const productId = product?.id || product?._id || productOrId;
    let variants = product?.variants || product?.raw?.variants || [];
    try {
      const { ok, body: detail } = await apiRequest(`/api/products/${productId}`, { auth: false });
      if (ok && Array.isArray(detail?.variants)) {
        const liveVariants = detail.variants.map(variant => ({ ...variant, id: String(variant._id) }));
        if (liveVariants.length === 1) variantId = liveVariants[0].id;
        variants = liveVariants;
        product = { ...(product || {}), id: String(productId), _id: String(productId), variants, raw: detail };
      }
    } catch { /* the cart API stays authoritative */ }
    if (!variantId && variants.length > 1) {
      setSelectedProduct(product);
      return { ok: false, message: 'Choose a product variant to add it to your cart.' };
    }
    const resolvedVariantId = variantId || (variants.length === 1 ? (variants[0].id || variants[0]._id) : undefined);
    const r = await cartCall('POST', '', { productId, qty, ...(resolvedVariantId ? { variantId: resolvedVariantId } : {}) });
    if (r.ok && r.data?.channel !== cartChannel) refreshCart();
    return { ...r, variantId: resolvedVariantId };
  };
  const setCartItemQty = async (itemId, qty) => cartCall('PUT', `/${itemId}`, { qty });
  const deleteCartItem = async itemId => cartCall('DELETE', `/${itemId}`);
  const clearCart = async () => cartCall('DELETE', `?channel=${cartChannel}`);
  const removeFromCart = async (itemId, currentQty) => setCartItemQty(itemId, Math.max(0, Number(currentQty || 1) - 1));
  const switchCartChannel = useCallback(channel => {
    if (!['grocery', 'ecommerce'].includes(channel) || channel === cartChannel) return;
    setDeliveryModeState(null);
    setAvailableCoupons([]);
    setCartChannel(channel);
  }, [cartChannel]);

  const getCartItems = () => serverCart.items || [];
  const getCartCount = () => (Object.keys(cartSummary || {}).length ? Object.values(cartSummary).reduce((acc, ch) => acc + (ch.count || 0), 0) : (serverCart.count || 0));
  const getCartSubtotal = () => serverCart.pricing?.subtotal || 0;
  const getDeliveryCharge = () => serverCart.pricing?.deliveryCharge || 0;
  const getCartTotal = () => serverCart.pricing?.totalAmount || 0;
  const getCartWarnings = () => serverCart.warnings || [];
  const getItemQty = (productId, variantId = null) => (serverCart.items || []).find(i => String(i.productId) === String(productId) && String(i.variantId || '') === String(variantId || ''))?.qty || 0;
  const getCouponDiscount = () => serverCart.pricing?.couponDiscount || 0;
  const getTotalSavings = () => serverCart.pricing?.totalSavings || 0;

  // ---------------- Coupon handlers (server evaluates; the client only sends a code) ----------------
  const applyCoupon = async code => {
    if (!isSignedIn()) return { success: false, message: 'Please sign in to use a coupon.' };
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return { success: false, message: 'Please enter a coupon code.' };
    if (couponApplying.current || (couponCode === clean && appliedCoupon?.code === clean)) return { success: false, message: 'Coupon already applied.' };
    couponApplying.current = true;
    try {
      const { ok, body } = await apiRequest('/api/coupons/validate', { method: 'POST', body: { code: clean, channel: cartChannel } });
      if (!ok) return { success: false, message: body.message || 'Could not check that coupon' };
      if (!body.data?.valid) return { success: false, message: body.data?.reason || 'That coupon is not valid.' };
      const priced = await refreshCart(cartChannel, clean);
      if (!priced?.appliedCoupon || priced.appliedCoupon.code !== clean || priced.couponError) return { success: false, message: priced?.couponError || 'The coupon could not be applied to the current cart.' };
      setCouponCode(clean);
      setAppliedCoupon(priced.appliedCoupon);
      setCouponNotice('');
      suppressedAuto.current = null;
      const savings = Number(priced.couponSavings) || 0;
      setCouponCelebration({ id: ++couponEventId.current, code: clean, savings });
      return { success: true, message: `"${clean}" applied — you save ₹${savings.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` };
    } catch (err) {
      return { success: false, message: err.message };
    } finally { couponApplying.current = false; }
  };

  const removeCoupon = async () => {
    setCouponNotice('');
    suppressedAuto.current = couponCartSignature(cartChannel, serverCart.items);
    setCouponCode('');
    setAppliedCoupon(null);
    await refreshCart(cartChannel, '');
  };

  const fetchAvailableCoupons = useCallback(async () => {
    const request = ++offersRequest.current;
    if (!isSignedIn()) { setAvailableCoupons([]); return []; }
    try {
      const { ok, body } = await apiRequest(`/api/coupons/available?channel=${cartChannel}`);
      if (!ok) { if (request === offersRequest.current) setAvailableCoupons([]); return []; }
      const offers = body.data || [];
      if (request === offersRequest.current) setAvailableCoupons(offers);
      return request === offersRequest.current ? offers : [];
    } catch {
      if (request === offersRequest.current) setAvailableCoupons([]);
      return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartChannel, sessionKey]);

  const offerCartSignature = couponCartSignature(cartChannel, serverCart.items);
  const offerSummarySignature = Object.entries(cartSummary).map(([channel, summary]) => `${channel}:${summary.lines}`).sort().join('|');
  const couponView = ['cart', 'checkout'].includes(activeNav) ? activeNav : '';
  useEffect(() => {
    if (!serverCart.items?.length || !isSignedIn()) { setAvailableCoupons([]); return; }
    if (!cartSummaryReady) return;
    void fetchAvailableCoupons();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerCartSignature, offerSummarySignature, cartSummaryReady, couponView, currentUser?._id, fetchAvailableCoupons]);

  useEffect(() => {
    if (!cartSummaryReady || !serverCart.items?.length || !isSignedIn() || activeCouponCode.current || couponApplying.current || suppressedAuto.current === offerCartSignature) return;
    // A coupon is one order's benefit; grouped and wholesale baskets cannot redeem it.
    const nonempty = Object.entries(cartSummary).filter(([, summary]) => summary.lines > 0);
    if (nonempty.length !== 1 || nonempty[0][0] !== cartChannel) return;
    const items = serverCart.items || [];
    if (new Set(items.map(item => String(item.sellerId))).size !== 1
      || new Set(items.map(item => item.deliveryMode || '')).size !== 1
      || new Set(items.map(item => item.fulfillmentType || 'physical')).size !== 1) return;
    const selected = availableCoupons.find(offer => offer.applicable && !offer.cdsMembersOnly);
    if (selected) applyCoupon(selected.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCoupons, offerCartSignature, offerSummarySignature, cartSummaryReady, couponView, currentUser?._id]);

  // ---------------- Tip setting ----------------
  const [tipSetting, setTipSetting] = useState(null);
  const fetchTipSetting = useCallback(async () => {
    try {
      const { ok, body } = await apiRequest('/api/tip-setting', { auth: false });
      if (ok) setTipSetting(body.data || null);
    } catch { /* keep what was loaded */ }
  }, []);
  useEffect(() => {
    fetchTipSetting();
    const handleTipUpdate = updated => { if (updated && typeof updated === 'object') setTipSetting(updated); else fetchTipSetting(); };
    socket.on('tip_setting_updated', handleTipUpdate);
    const appState = AppState.addEventListener('change', state => { if (state === 'active') fetchTipSetting(); });
    const stopRefresh = on(EVENTS.SOFT_REFRESH, fetchTipSetting);
    return () => { socket.off('tip_setting_updated', handleTipUpdate); appState.remove(); stopRefresh(); };
  }, [fetchTipSetting]);

  // ---------------- Addresses ----------------
  const refreshAddresses = useCallback(async () => {
    if (!isSignedIn()) { setSavedAddresses([]); return; }
    try {
      const res = await portalRequest(local.getItem('userToken'), '/api/users/addresses');
      if (!res.ok) return;
      const body = await res.json();
      const list = (body.data || body.addresses || []).map(a => { const idVal = String(a._id || a.id || ''); return { ...a, id: idVal, _id: idVal }; });
      setSavedAddresses(list);
      setSelectedAddressId(cur => {
        if (cur && list.some(a => String(a.id) === String(cur))) return cur;
        const def = list.find(a => a.isDefault) || list[0];
        return def ? def.id : null;
      });
    } catch { /* keep what is on screen */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);
  useEffect(() => { refreshAddresses(); }, [refreshAddresses]);

  const addAddress = async address => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in first.' };
    const recipientName = (currentUser?.name || '').trim() || (address?.name && String(address.name).trim()) || '';
    const recipientPhone = (currentUser?.phone || '').trim() || (address?.phone && String(address.phone).trim()) || '';
    if (!recipientName) return { ok: false, message: 'Please complete your profile name before adding a delivery address.' };
    if (!recipientPhone) return { ok: false, message: 'Please complete your profile mobile number before adding a delivery address.' };
    try {
      const { ok, body } = await apiRequest('/api/users/addresses', { method: 'POST', body: { ...address, name: recipientName, phone: recipientPhone } });
      if (!ok) return { ok: false, message: body.message || 'Could not save the address' };
      await refreshAddresses();
      const addressId = body.data?.addressId;
      if (addressId) setSelectedAddressId(String(addressId));
      return { ok: true, addressId, duplicate: Boolean(body.data?.duplicate), message: body.message || 'Address saved' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  /** `asset` is an image picker asset ({ uri, mimeType, fileName }). */
  const uploadLandmarkImage = async asset => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in first.' };
    try {
      const form = new FormData();
      form.append('image', { uri: asset.uri, name: asset.fileName || 'landmark.jpg', type: asset.mimeType || 'image/jpeg' });
      const { ok, body } = await apiRequest('/api/users/addresses/upload-landmark', { method: 'POST', form });
      if (!ok) return { ok: false, message: body.message || 'Could not upload landmark image' };
      return { ok: true, imageUrl: body.imageUrl };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const updateAddress = async (targetId, data) => {
    const id = typeof targetId === 'object' ? (targetId?._id || targetId?.id) : targetId;
    if (!id || id === 'undefined') return { ok: false, message: 'Invalid address ID' };
    try {
      const profileName = (currentUser?.name || '').trim();
      const profilePhone = (currentUser?.phone || '').trim();
      const { ok, body } = await apiRequest(`/api/users/addresses/${id}`, { method: 'PUT', body: { ...data, ...(profileName ? { name: profileName } : {}), ...(profilePhone ? { phone: profilePhone } : {}) } });
      if (!ok) return { ok: false, message: body.message || 'Could not update the address' };
      await refreshAddresses();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const deleteAddress = async targetId => {
    const id = typeof targetId === 'object' ? (targetId?._id || targetId?.id) : targetId;
    if (!id || id === 'undefined') return { ok: false, message: 'Invalid address ID' };
    try {
      const { ok, body } = await apiRequest(`/api/users/addresses/${id}`, { method: 'DELETE' });
      if (!ok) return { ok: false, message: body.message || 'Could not delete the address' };
      if (String(selectedAddressId) === String(id)) setSelectedAddressId(null);
      await refreshAddresses();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  /** Save where the shopper wants things delivered (header location picker). */
  const saveDeliveryLocation = async (coords, source = 'gps') => {
    const snapshot = captureUserSession();
    if (!validPoint(coords)) return { ok: false, message: 'Invalid coordinates. Enter your location manually.' };
    if (!isSignedIn()) {
      const label = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      setLocation(label);
      saveBrowsingLocation(label, coords, source);
      return { ok: true, label, resolved: {} };
    }
    let resolved = {};
    try {
      const { ok, body } = await apiRequest(`/api/geo/reverse?lat=${coords.lat}&lng=${coords.lng}${coords.accuracy ? `&accuracy=${Math.round(coords.accuracy)}` : ''}`);
      if (ok) resolved = body.data || {};
    } catch { /* the pin is still worth saving */ }
    if (!isCurrentUserSession(snapshot)) return { ok: false, message: 'Your session changed. Please select the location again.' };
    const existing = savedAddresses.find(a => a.isDefault) || savedAddresses[0];
    const payload = {
      name: existing?.name || currentUser?.name || 'Home',
      phone: existing?.phone || currentUser?.phone || '',
      line1: existing?.line1 || resolved.address || 'Current location',
      line2: existing?.line2,
      city: resolved.city || existing?.city,
      state: resolved.state || existing?.state,
      pincode: resolved.pincode || existing?.pincode,
      lat: coords.lat,
      lng: coords.lng,
      locationSource: source,
      isDefault: true,
      placeName: resolved.placeName || null,
    };
    try {
      const { ok, body } = existing
        ? await apiRequest(`/api/users/addresses/${existing._id}`, { method: 'PUT', body: payload })
        : await apiRequest('/api/users/addresses', { method: 'POST', body: payload });
      if (!ok) return { ok: false, message: body.message || 'Could not save your location' };
      if (!isCurrentUserSession(snapshot)) return { ok: false, message: 'Your session changed. Select your location again.' };
      await refreshAddresses();
      const displayAddress = resolved.placeName || resolved.address;
      const label = displayAddress
        ? [displayAddress, resolved.city, resolved.state, resolved.pincode].filter(Boolean).join(', ')
        : [resolved.city, resolved.state, resolved.pincode].filter(Boolean).join(', ') || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      setLocation(label);
      local.setItem('userLocation', label);
      return { ok: true, label, resolved };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — please try again.' };
    }
  };

  const lookupTypedLocation = async text => {
    const snapshot = captureUserSession();
    if (!isSignedIn()) {
      setLocation(text);
      saveBrowsingLocation(text, null, 'manual');
      return { ok: true, label: text, resolved: {} };
    }
    try {
      const { ok, body } = await apiRequest(`/api/geo/forward?q=${encodeURIComponent(text)}`);
      if (!ok) return { ok: false, message: body.message || 'We could not find that place' };
      if (!isCurrentUserSession(snapshot)) return { ok: false, message: 'Your session changed. Enter the location again.' };
      return saveDeliveryLocation({ lat: body.data.lat, lng: body.data.lng }, 'manual');
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — please try again.' };
    }
  };

  const setDefaultAddress = async id => {
    const snapshot = captureUserSession();
    try {
      const { ok } = await apiRequest(`/api/users/addresses/${id}/default`, { method: 'PUT' });
      if (!ok) return { ok: false, message: 'Could not select the address. Please retry.' };
      if (!isCurrentUserSession(snapshot)) return { ok: false, message: 'Your session changed.' };
      await refreshAddresses();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const getLocationDisplayName = addr => {
    if (!addr) return 'Set your location';
    const primary = addr.placeName || addr.line1 || addr.city || '';
    const secondary = [addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
    if (primary && secondary && primary !== addr.city) return `${primary}, ${secondary}`;
    return secondary || `${addr.lat?.toFixed(4) || 0}, ${addr.lng?.toFixed(4) || 0}`;
  };
  useEffect(() => {
    const active = getSelectedAddress();
    if (active) {
      const displayName = getLocationDisplayName(active);
      setLocation(displayName);
      local.setItem('userLocation', displayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAddresses, selectedAddressId]);

  // ---------------- Orders: checkout, payment, cancellation ----------------
  const shippingFrom = addr => {
    const resolvedName = (addr.name != null ? String(addr.name).trim() : '') || (currentUser?.name != null ? String(currentUser.name).trim() : '') || '';
    const resolvedPhone = (addr.phone != null ? String(addr.phone).trim() : '') || (currentUser?.phone != null ? String(currentUser.phone).trim() : '') || '';
    return { resolvedName, resolvedPhone };
  };

  const placeOrder = async (paymentMethod = 'Cash on Delivery', tipAmount = 0) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to place an order.' };
    if ((serverCart.items || []).length === 0) return { ok: false, message: 'Your cart is empty.' };
    const digitalItems = serverCart.items.filter(item => item.fulfillmentType === 'digital');
    if (digitalItems.length > 0) {
      if (digitalItems.length !== serverCart.items.length) return { ok: false, message: 'Digital and physical items require separate checkout. Remove one type and check out each group separately.' };
      if (paymentMethod !== 'Online Payment') return { ok: false, message: 'E-books can only be purchased using Razorpay.' };
      try {
        const checkoutSession = captureUserSession();
        const checkoutPayload = { paymentMethod: 'online', coupon: couponCode || undefined };
        const requestHeaders = checkoutHeaders('digital', checkoutPayload);
        const { ok, body } = await apiRequest('/api/digital/checkout', { method: 'POST', headers: requestHeaders, body: checkoutPayload });
        if (!ok) return { ok: false, message: body.message || 'Could not create the e-book order' };
        if (!body.data?.order?._id || !body.data?.payment?.id) throw new Error('Unconfirmed checkout response');
        if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
        rememberCommittedCheckout(currentUser?._id || currentUser?.id, 'digital', requestHeaders['Idempotency-Key']);
        clearCheckoutKey('digital');
        setCouponCode(''); setAppliedCoupon(null);
        await Promise.all([refreshCart(cartChannel, ''), fetchOrders()]);
        return { ok: true, checkoutKey: requestHeaders['Idempotency-Key'], order: body.data.order, payment: body.data.payment, message: body.message };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    }
    const addr = getSelectedAddress();
    if (!addr) return { ok: false, message: 'Please add a delivery address first.' };
    const { resolvedName, resolvedPhone } = shippingFrom(addr);
    if (!resolvedName) return { ok: false, message: 'Your profile is missing a name. Please complete your profile.' };
    if (!resolvedPhone) return { ok: false, message: 'Your profile is missing a mobile number. Please complete your profile.' };
    if (!addr.line1 && !addr.address) return { ok: false, message: 'Your saved address is missing the address line. Please add a new address.' };
    if (!addr.city) return { ok: false, message: 'Your saved address is missing a city. Please add a new address.' };
    if (!addr.pincode) return { ok: false, message: 'Your saved address is missing a pincode. Please add a new address.' };
    try {
      const checkoutPayload = {
        channel: cartChannel,
        coupon: couponCode || undefined,
        paymentMethod: PAYMENT_CODE[paymentMethod] || 'cod',
        deliveryMode: cartChannel === 'ecommerce' ? (deliveryMode || serverCart?.items?.[0]?.deliveryMode || undefined) : undefined,
        tipAmount: tipAmount || undefined,
        addressId: addr._id || addr.id || undefined,
        shippingAddress: {
          name: resolvedName, phone: resolvedPhone,
          line1: addr.line1 || addr.address, line2: addr.line2,
          city: addr.city, state: addr.state || '', pincode: addr.pincode,
          lat: addr.lat, lng: addr.lng,
          landmarkImage: addr.landmarkImage || addr.locationReferenceImage || null,
        },
      };
      const checkoutSession = captureUserSession();
      const requestHeaders = checkoutHeaders('single', checkoutPayload);
      const { ok, status, body } = await apiRequest('/api/orders', { method: 'POST', headers: requestHeaders, body: checkoutPayload, timeoutMs: 30000 });
      if (!ok) return { ok: false, operation: 'single', status, code: body.meta?.code, requestId: body.meta?.requestId, message: body.message || 'Could not place your order' };
      if (!body.data?.order?._id || !body.data?.payment?.id) throw new Error('Unconfirmed checkout response');
      if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
      if (checkoutPayload.paymentMethod === 'online') rememberCommittedCheckout(currentUser?._id || currentUser?.id, 'single', requestHeaders['Idempotency-Key']);
      clearCheckoutKey('single');
      setCouponCode(''); setAppliedCoupon(null);
      void initPushNotifications({ requestPermission: true }).catch(() => {});
      await Promise.allSettled([refreshCart(cartChannel, ''), fetchOrders(), fetchWalletBalance()]);
      if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
      return { ok: true, checkoutKey: requestHeaders['Idempotency-Key'], order: body.data.order, message: body.message };
    } catch {
      return { ok: false, operation: 'single', code: 'CHECKOUT_OUTCOME_UNCERTAIN', message: 'We could not confirm the checkout result. Check its status before trying again.' };
    }
  };

  const placeUnifiedOrder = async (paymentMethod = 'Cash on Delivery', tipAmount = 0, options = {}) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to place an order.' };
    const checkoutSession = captureUserSession();
    const addr = getSelectedAddress();
    if (!addr) return { ok: false, message: 'Please add a delivery address first.' };
    const { resolvedName, resolvedPhone } = shippingFrom(addr);
    if (!resolvedName) return { ok: false, message: 'Your profile is missing a name. Please complete your profile.' };
    if (!resolvedPhone) return { ok: false, message: 'Your profile is missing a mobile number. Please complete your profile.' };
    if (!addr.line1 && !addr.address) return { ok: false, message: 'Your saved address is missing the address line.' };
    if (!addr.city) return { ok: false, message: 'Your saved address is missing a city.' };
    if (!addr.pincode) return { ok: false, message: 'Your saved address is missing a pincode.' };
    try {
      const grouped = ['wholesale', 'basket'].includes(options.purchaseMode);
      const checkoutPayload = {
        ...(grouped ? { purchaseMode: options.purchaseMode, quoteHash: options.quoteHash, ...(options.purchaseMode === 'basket' ? { basketHash: options.basketHash } : {}) } : {}),
        paymentMethod: PAYMENT_CODE[paymentMethod] || 'cod',
        tipAmount: tipAmount || undefined,
        addressId: addr._id || addr.id || undefined,
        shippingAddress: {
          name: resolvedName, phone: resolvedPhone,
          line1: addr.line1 || addr.address, line2: addr.line2,
          city: addr.city, state: addr.state || '', pincode: addr.pincode,
          lat: addr.lat, lng: addr.lng,
          landmarkImage: addr.landmarkImage || addr.locationReferenceImage || null,
        },
      };
      const operation = grouped ? options.purchaseMode : 'unified';
      const requestHeaders = checkoutHeaders(operation, checkoutPayload);
      const { ok, status, body } = await apiRequest('/api/orders/unified', { method: 'POST', headers: requestHeaders, body: checkoutPayload, timeoutMs: 30000 });
      if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to view your order.' };
      if (!ok) return { ok: false, operation: 'unified', status, code: body.meta?.code, requestId: body.meta?.requestId, message: body.message || 'Could not place your order' };
      if (!body.data?.orders?.length || body.data.orders.some(order => !order?._id) || !body.data?.payment?.id) throw new Error('Unconfirmed checkout response');
      if (checkoutPayload.paymentMethod === 'online') rememberCommittedCheckout(currentUser?._id || currentUser?.id, 'unified', requestHeaders['Idempotency-Key']);
      clearCheckoutKey(operation);
      void initPushNotifications({ requestPermission: true }).catch(() => {});
      emit(EVENTS.CART_CHANGED);
      await Promise.allSettled([refreshCart(cartChannel, ''), fetchOrders()]);
      if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
      return { ok: true, checkoutKey: requestHeaders['Idempotency-Key'], orders: body.data.orders, groupRef: body.data.groupRef, payment: body.data.payment, message: body.message };
    } catch {
      return { ok: false, operation: 'unified', code: 'CHECKOUT_OUTCOME_UNCERTAIN', message: 'We could not confirm the checkout result. Check its status before trying again.' };
    }
  };

  const checkCheckoutStatus = async (operation = 'single') => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to check your order.' };
    try {
      const saved = readJSON(sessionStore, `bulkimart:checkout:${operation}:${currentUser?._id || currentUser?.id || 'customer'}`);
      if (!saved?.key) return { ok: false, message: 'The checkout session is unavailable. Review My Orders or contact support before ordering again.' };
      const { ok, body } = await apiRequest('/api/orders/checkout-status', { method: 'POST', headers: { 'Idempotency-Key': saved.key }, body: { operation: ['wholesale', 'basket'].includes(operation) ? 'unified' : operation } });
      return { ok, data: body.data, message: body.message || 'Could not check your order status.' };
    } catch { return { ok: false, message: 'Could not check your order status. Please retry the status check.' }; }
  };

  /** Start the server-selected gateway. Only backend verification marks an order paid. */
  const initiateOnlinePayment = async orderId => {
    try {
      const { ok, body } = await apiRequest('/api/payments/initiate', { method: 'POST', body: { orderId } });
      if (!ok) return { ok: false, message: body.message || 'Could not start the payment' };
      if (body.data?.provider === 'razorpay') return openRazorpayCheckout(body.data, authHeaders());
      return { ok: true, provider: body.data?.provider, redirectUrl: body.data?.redirectUrl };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const abandonCheckoutPayment = async orderId => {
    try {
      const { ok, body } = await apiRequest(`/api/orders/${orderId}/abandon-payment`, { method: 'POST' });
      if (!ok) return { ok: false, message: body.message || 'Could not confirm payment cancellation. Check its status before retrying.' };
      if (body.data?.cancelled) {
        emit(EVENTS.CART_CHANGED);
        await Promise.allSettled([refreshCart(cartChannel, ''), fetchOrders(), fetchWalletBalance()]);
      }
      return { ok: true, ...body.data };
    } catch { return { ok: false, message: 'Could not confirm payment cancellation. Check its status before retrying.' }; }
  };

  const cancelOrder = async (orderId, reason) => {
    try {
      const { ok, body } = await apiRequest(`/api/orders/${orderId}/cancel`, { method: 'PATCH', body: { reason: reason || 'Cancelled by customer' } });
      if (!ok) return { ok: false, message: body.message || 'Could not cancel this order' };
      await fetchOrders();
      return { ok: true, message: body.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  // ---------------- Wishlist mutations (optimistic with rollback) ----------------
  const wishlistCall = async (id, add) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to save products to your Wishlist.' };
    if (wishlist.has(id) === add) return { ok: true };
    setWishlist(prev => { const next = new Set(prev); if (add) next.add(id); else next.delete(id); return next; });
    try {
      const { ok, body } = await apiRequest(`/api/wishlist/${id}`, { method: add ? 'POST' : 'DELETE' });
      if (!ok) throw new Error(body.message || 'Could not update your wishlist');
      if (add) refreshWishlist(); else setWishlistItems(prev => prev.filter(p => String(p._id) !== id));
      return { ok: true };
    } catch (err) {
      setWishlist(prev => { const next = new Set(prev); if (add) next.delete(id); else next.add(id); return next; });
      return { ok: false, message: err.message };
    }
  };
  const toggleWishlist = productId => { const id = String(productId); return wishlistCall(id, !wishlist.has(id)); };
  const addToWishlist = productId => wishlistCall(String(productId), true);
  const removeFromWishlist = productId => wishlistCall(String(productId), false);
  const isWishlisted = productId => wishlist.has(String(productId));
  const getWishlistItems = () => wishlistItems;

  // Everything that belongs to one signed-in customer is dropped when the session changes.
  const lastSession = useRef(sessionKey);
  useEffect(() => {
    if (lastSession.current === sessionKey) return;
    lastSession.current = sessionKey;
    setCouponCode(''); setAppliedCoupon(null); setCouponNotice(''); setAvailableCoupons([]);
    setSelectedOrderState(null); setActiveRider(null); setReturnPickupOtp(null); setDeliveryModeState(null);
    if (sessionKey === 'guest') { setOrders([]); setSavedAddresses([]); setCartSummary({}); setServerCart({ ...EMPTY_CART, channel: cartChannel }); setWalletBalance(0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const value = {
    currentUser, logoutUser, sendOtp, verifyOtp, updateUserProfile, fetchProfile, session: restoredSession,
    activeMode, setActiveMode, productTab, setProductTab, activeNav, setActiveNav, replaceNav, activeSubNav, setActiveSubNav, popSubNav,
    isVoiceModalOpen, setIsVoiceModalOpen, openVoiceSearch, closeVoiceSearch,
    imageSearchRequest, setImageSearchRequest, openImageSearch, pendingVoiceQuery, setPendingVoiceQuery,
    selectedCategoryFilter, setSelectedCategoryFilter,
    location, setLocation, saveDeliveryLocation, lookupTypedLocation, showLocationModal, setShowLocationModal,
    selectedProduct, setSelectedProduct, openWholesaleProduct, openProductById,
    reviewProductId, setReviewProductId,
    cart: serverCart, serverCart, cartChannel, switchCartChannel, cartSummary, cartLoading, refreshCart,
    deliveryMode, setDeliveryMode, addToCart, removeFromCart, clearCart, setCartItemQty, deleteCartItem,
    getCartCount, getCartItems, getCartWarnings, getItemQty, getCartSubtotal, getDeliveryCharge, getCouponDiscount, getCartTotal,
    appliedCoupon, applyCoupon, removeCoupon, couponNotice, couponCode,
    availableCoupons: availableCoupons.filter(offer => offer.isPublic !== false), fetchAvailableCoupons, getTotalSavings,
    couponCelebration, couponView,
    tipSetting, fetchTipSetting,
    savedAddresses, selectedAddressId, setSelectedAddressId, addAddress, updateAddress, deleteAddress, setDefaultAddress, uploadLandmarkImage,
    getSelectedAddress, getDeliveryPoint, getPricingPoint, getLocationDisplayName, refreshAddresses,
    walletBalance, setWalletBalance, fetchWalletBalance,
    orders, setOrders, selectedOrder, setSelectedOrder: selectOrder, setSelectedOrderState,
    selectedCampaignId, setSelectedCampaignId, activeRider, returnPickupOtp,
    placeOrder, placeUnifiedOrder, checkCheckoutStatus, initiateOnlinePayment, cancelOrder, abandonCheckoutPayment,
    fetchOrders, ordersLoading, ordersError,
    wishlist, toggleWishlist, isWishlisted, getWishlistItems, wishlistLoading, refreshWishlist, addToWishlist, removeFromWishlist,
    requestPushPermission, authHeaders,
  };
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};

