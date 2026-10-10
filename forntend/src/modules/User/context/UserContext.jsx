import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';
import { initPushNotifications, deregisterPushToken } from '../../../utils/firebaseMessaging';

const UserContext = createContext();

// Default saved addresses
// Generate a unique order ID
const genOrderId = () => 'NHC' + Date.now().toString().slice(-6);

export const UserProvider = ({ children }) => {
  // --- Navigation & Mode ---
  /**
   * Which storefront a path belongs to — or nothing, when it belongs to neither.
   *
   * This used to answer 'quick' for every path it did not recognise, and that
   * quietly emptied people's baskets. Tapping the cart icon pushes `/cart`,
   * which is not a Shop All path, so the shopper was flipped back to Quick, the
   * cart channel followed, and the Quick basket — usually empty — was fetched
   * and shown. Nothing was ever lost: the app was asking the server for the
   * wrong basket.
   *
   * Cart, checkout, orders and account belong to neither storefront. They have
   * to preserve whichever one the shopper is in rather than vote on it.
   */
  const STOREFRONT_OF_PATH = {
    'smart-buy': 'shop-all',
    'hot-deals': 'shop-all',
    fashion: 'shop-all',
    home: 'quick',
    groceries: 'quick',
    electronics: 'quick',
    coupons: 'quick',
    garments: 'quick',
  };

  const getModeFromPath = () => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return 'quick';        // the root is the Quick home
    return STOREFRONT_OF_PATH[parts[0]] || null;   // null — this path says nothing
  };

  /**
   * The storefront the shopper last chose.
   *
   * Remembered because the URL cannot always say. Reloading on `/cart` has to
   * come back to the same basket they were filling, and the path alone gives no
   * way to know which that was.
   */
  const STOREFRONT_KEY = 'nh_storefront';
  const rememberedMode = () => {
    const saved = localStorage.getItem(STOREFRONT_KEY);
    return saved === 'quick' || saved === 'shop-all' ? saved : null;
  };
  const resolveMode = () => getModeFromPath() || rememberedMode() || 'quick';

  const getNavFromPath = () => {
    const pathname = window.location.pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) return 'home';
    const firstPart = parts[0];
    // Retired legacy storefront URLs intentionally fall back to Bulkimart home.
    if (['categories', 'orders', 'account', 'profile', 'cart', 'checkout', 'wishlist', 'search'].includes(firstPart)) {
      if (firstPart === 'profile') return 'account';
      return firstPart;
    }
    return 'home';
  };

  const getSubscriptionStepFromPath = () => {
    const pathname = window.location.pathname;
    if (pathname.startsWith('/basket')) return 'basket';
    return 'products';
  };

  const getSubNavFromPath = (mode) => {
    const pathname = window.location.pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      return mode === 'quick' ? 'grocery--home' : 'ecommerce--smart-buy';
    }
    const firstPart = parts[0];

    /**
     * The built-in sections, plus whatever the admin has put in the header.
     *
     * The list used to be closed, so a tab driven by a database category could
     * never survive a refresh — the path named a real category and this returned
     * "home" anyway. Category slugs are checked by shape rather than by being
     * enumerated here, because the set changes whenever somebody ticks a box in
     * the admin panel and this file cannot know it.
     */
    const specialSubNavs = ['home', 'groceries', 'electronics', 'coupons', 'garments', 'smart-buy', 'hot-deals', 'fashion'];
    if (specialSubNavs.includes(firstPart)) return firstPart;

    // A category slug is `<channel>--<path>`; anything else is not a sub-nav.
    if (/^(grocery|ecommerce)--[a-z0-9-]+/.test(firstPart)) return firstPart;

    return mode === 'quick' ? 'grocery--home' : 'ecommerce--smart-buy';
  };

  const [activeMode, setActiveModeState] = useState(resolveMode);
  const [productTab, setProductTab] = useState('quick');
  const [activeNav, setActiveNavState] = useState(getNavFromPath);
  const [subscriptionStep, setSubscriptionStepState] = useState(getSubscriptionStepFromPath);

  const currentModeFromPath = resolveMode();
  const [activeSubNav, setActiveSubNavState] = useState(() => getSubNavFromPath(currentModeFromPath));

  // Sync states during render to immediately reflect popstate/URL pathname changes
  const pathMode = getModeFromPath();
  const currentMode = pathMode || activeMode;
  const currentNav = getNavFromPath();
  const currentSubNav = getSubNavFromPath(currentMode);
  const currentSubStep = getSubscriptionStepFromPath();

  /**
   * Only a path that names a storefront may change which one we are in.
   *
   * On `/cart` and the other shared pages `pathMode` is null, so the shopper
   * stays where they were. Writing the storefront from every path is what sent
   * people to an empty basket.
   */
  if (pathMode && activeMode !== pathMode) {
    setActiveModeState(pathMode);
  }
  if (activeNav !== currentNav) {
    setActiveNavState(currentNav);
  }
  if (subscriptionStep !== currentSubStep) {
    setSubscriptionStepState(currentSubStep);
  }
  if (activeSubNav !== currentSubNav) {
    setActiveSubNavState(currentSubNav);
  }

  const setActiveMode = (mode) => {
    setActiveModeState(mode);
  };

  /**
   * Remember the storefront across navigation and reloads.
   *
   * Without this, landing straight on `/cart` — from a refresh, a bookmark or a
   * shared link — has nothing to go on and falls back to Quick, which is the
   * same wrong-basket problem arriving by a different route.
   */
  useEffect(() => {
    localStorage.setItem(STOREFRONT_KEY, activeMode);
  }, [activeMode]);

  /**
   * Referral Program — captures `?ref=<code>` off the very first landing
   * (a shared referral link), once, into localStorage. `verifyOtp` above
   * reads and clears it at signup — this is only a short-lived carrier,
   * never the source of truth: the backend's Referral row, created inside
   * auth.controller.js's `if (!user)` branch, is what actually counts.
   */
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get('ref');
      if (ref) localStorage.setItem('pendingReferralCode', ref.toUpperCase().trim());
    } catch { /* URL parsing best-effort — never blocks app load */ }
  }, []);

  const getCategoryFromPath = () => {
    const pathname = window.location.pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'categories' && parts[1]) {
      return { slug: parts[1] };
    }
    return null;
  };

  const getReviewProductIdFromPath = () => {
    const pathname = window.location.pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] === 'review' && parts[1]) {
      return parts[1];
    }
    return null;
  };

  const setActiveNav = (navId) => {
    let newPath = navId === 'home' ? '/' : `/${navId}`;
    if (['basket', 'subscriptions', 'my-subscriptions'].includes(navId)) newPath = '/';
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
    if (['basket', 'subscriptions', 'my-subscriptions'].includes(navId)) {
      setActiveNavState('home');
      setSubscriptionStepState('products');
    } else {
      setActiveNavState(navId);
    }
    if (navId === 'home') {
      setActiveSubNavState(activeMode === 'quick' ? 'grocery--home' : 'ecommerce--smart-buy');
    }
  };

  const setActiveSubNav = (subNavId) => {
    const newPath = subNavId === 'home' ? '/' : `/${subNavId}`;
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
    setActiveSubNavState(subNavId);
  };

  const [selectedCategoryFilter, setSelectedCategoryFilterState] = useState(getCategoryFromPath);
  const [reviewProductId, setReviewProductIdState] = useState(getReviewProductIdFromPath);

  const setReviewProductId = (productId) => {
    setReviewProductIdState(productId);
    if (productId) {
      const newPath = `/review/${productId}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState(null, '', newPath);
      }
    } else {
      if (window.location.pathname.startsWith('/review')) {
        window.history.pushState(null, '', '/orders');
      }
    }
  };

  // Voice Search Global State
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [pendingVoiceQuery, setPendingVoiceQuery] = useState('');
  const openVoiceSearch = () => setIsVoiceModalOpen(true);
  const closeVoiceSearch = () => setIsVoiceModalOpen(false);

  const setSelectedCategoryFilter = (category) => {
    setSelectedCategoryFilterState(category);
    if (category) {
      const slug = category.slug;
      const newPath = `/categories/${slug}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState(null, '', newPath);
      }
      setActiveNavState('categories');
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts[0] === 'categories' && parts[1]) {
        setSelectedCategoryFilterState({ slug: parts[1] });
      } else {
        setSelectedCategoryFilterState(null);
      }

      if (parts[0] === 'review' && parts[1]) {
        setReviewProductIdState(parts[1]);
      } else {
        setReviewProductIdState(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // --- Authentication ---
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('userProfile');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Push registration, once there's an authenticated user to register it for.
  useEffect(() => {
    if (currentUser) initPushNotifications().catch(() => {});
  }, [currentUser]);

  /**
   * The delivery location shown in the header.
   *
   * Cached in localStorage so the header has something to print before the
   * profile loads, but it is only a label. The location that matters — the one
   * the map, the rider distance and checkout all read — lives on the user's
   * default address, and `saveDeliveryLocation` below is what puts it there.
   *
   * The old default was 'Lucknow, 226022' for everybody, which read as a real
   * answer rather than "we do not know yet".
   */
  const [location, setLocation] = useState(() => {
    return localStorage.getItem('userLocation') || 'Set your location';
  });
  const [showLocationModal, setShowLocationModal] = useState(() => {
    return !localStorage.getItem('locationAsked');
  });

  // --- Product Detail ---
  const [selectedProduct, setSelectedProduct] = useState(null);

  // --- Subscription ---
  const setSubscriptionStep = (step) => {
    const newPath = step === 'basket' ? '/basket' : '/subscriptions';
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
    setSubscriptionStepState(step);
  };


  // --- Coupon ---
  const [couponCode, setCouponCode] = useState('');
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null); // { code, discount }

  // --- Addresses ---
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('addr1');

  // --- Wallet Balance ---
  const [walletBalance, setWalletBalance] = useState(0);

  const fetchWalletBalance = useCallback(async () => {
    if (!isSignedIn()) { setWalletBalance(0); return; }
    try {
      const res = await fetch(apiUrl('/api/wallet'), { headers: authHeaders(false) });
      if (!res.ok) return;
      const body = await res.json();
      if (body.data?.balance !== undefined) {
        setWalletBalance(body.data.balance);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchWalletBalance(); }, [fetchWalletBalance]);

  // --- Orders --- (state lives with the API calls further down)
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [activeRider, setActiveRider] = useState(null);
  // QUICK COMMERCE ONLY — the reverse-pickup OTP a rider needs from this
  // customer at handover. Kept separate from `activeRider` (that object is
  // forward-delivery shaped and keyed by orderId, not returnId) rather than
  // overloading it with a second, unrelated meaning.
  const [returnPickupOtp, setReturnPickupOtp] = useState(null);

  // A campaign banner's landing page, same overlay pattern as selectedOrder.
  const [selectedCampaignId, setSelectedCampaignId] = useState(null);
  // A seller promotion banner's landing page — same overlay pattern, its own domain.
  const [selectedPromotionId, setSelectedPromotionId] = useState(null);

  // --- Socket IO connections and events ---
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    const profile = localStorage.getItem('userProfile');
    if (token && profile) {
      try {
        const parsed = JSON.parse(profile);
        connectSocket(token, 'buyer', parsed._id);
      } catch { }
    }

    socket.on('order_status_updated', ({ orderId, status, timeline }) => {
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status, timeline } : o));
    });

    socket.on('rider_assigned', ({ orderId, riderName, riderPhone, vehicleType, otp, deliveryId }) => {
      setActiveRider({
        orderId,
        name: riderName,
        phone: riderPhone,
        vehicleType,
        otp,
        deliveryId,
        lat: 22.71744, // Default Indore center
        lng: 75.871511,
        step: 'pickup'
      });
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: 'out_for_delivery' } : o));
    });

    socket.on('delivery_status_updated', ({ orderId, status }) => {
      setActiveRider(prev => {
        if (prev && prev.orderId === orderId) {
          return { ...prev, step: status }; // status will be 'transit' or 'arrived'
        }
        return prev;
      });
    });

    socket.on('location_update', ({ deliveryId, lat, lng }) => {
      setActiveRider(prev => {
        if (prev && prev.deliveryId === deliveryId) {
          return { ...prev, lat, lng };
        }
        return prev;
      });
    });

    socket.on('otp_ready', ({ otp }) => {
      setActiveRider(prev => prev ? { ...prev, otp } : null);
    });

    // QUICK COMMERCE ONLY — the reverse-pickup counterpart to `otp_ready`
    // above (services/returnPickup.service.js::generateReturnPickupOtp).
    socket.on('return_pickup_otp_ready', ({ returnId, otp }) => {
      setReturnPickupOtp({ returnId, otp });
    });

    socket.on('order_delivered', ({ orderId }) => {
      setActiveRider(null);
      setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: 'delivered' } : o));
    });

    return () => {
      socket.off('order_status_updated');
      socket.off('rider_assigned');
      socket.off('delivery_status_updated');
      socket.off('location_update');
      socket.off('otp_ready');
      socket.off('return_pickup_otp_ready');
      socket.off('order_delivered');
      disconnectSocket();
    };
  }, []);

  /**
   * Wishlist — backend is the source of truth (User.wishlist, product refs
   * only). `wishlist` stays a Set of product ids, same shape callers like
   * UnifiedHeader already relied on, so the count badge needed no changes.
   * `wishlistItems` holds the live Product data GET /api/wishlist returns,
   * for the Wishlist page itself.
   */
  const [wishlist, setWishlist] = useState(new Set());
  const [wishlistItems, setWishlistItems] = useState([]);
  const [wishlistLoading, setWishlistLoading] = useState(false);

  // --- Notifications ---
  const [notifications, setNotifications] = useState([
    { id: 'n1', type: 'order', title: 'Order Confirmed', desc: 'Your order NHC123456 has been confirmed!', time: '2m ago', read: false },
    { id: 'n2', type: 'offer', title: 'Special Offer', desc: 'Get 15% off on all organic products today!', time: '1h ago', read: false },
    { id: 'n3', type: 'delivery', title: 'Out for Delivery', desc: 'Your order is on the way. ETA: 30 mins.', time: '3h ago', read: true },
  ]);

  const sendOtp = async (phone, isLogin) => {
    try {
      const response = await fetch(apiUrl('/api/auth/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, isLogin }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Failed to send OTP');
      }
      return { success: true, otp: data.otp };
    } catch (err) {
      console.error(err);
      return { success: false, message: err.message };
    }
  };

  const verifyOtp = async (phone, otp, isLogin, name, email) => {
    try {
      const referralCode = localStorage.getItem('pendingReferralCode') || undefined;
      const response = await fetch(apiUrl('/api/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, referralCode, isLogin, name, email }),
      });
      localStorage.removeItem('pendingReferralCode');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'OTP verification failed');
      }
      if (data.token) {
        localStorage.setItem('userToken', data.token);
      }
      if (data.user) {
        localStorage.setItem('userProfile', JSON.stringify(data.user));
        setCurrentUser(data.user);
        connectSocket(data.token, 'buyer', data.user._id);
        refreshWishlist();
      }
      return { success: true, isNewUser: data.isNewUser, user: data.user };
    } catch (err) {
      console.error(err);
      return { success: false, message: err.message };
    }
  };

  const updateUserProfile = async (name, email, isShgMember, shgRegNo) => {
    try {
      const token = localStorage.getItem('userToken');
      const response = await fetch(apiUrl('/api/users/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, email, isShgMember, shgRegNo }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Profile update failed');
      }
      if (data.user) {
        const currentProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
        const updatedProfile = { ...currentProfile, ...data.user };
        localStorage.setItem('userProfile', JSON.stringify(updatedProfile));
        setCurrentUser(updatedProfile);
      }
      return { success: true };
    } catch (err) {
      console.error(err);
      return { success: false, message: err.message };
    }
  };

  // Keep compatibility for older code
  const loginUser = (email, password) => {
    const user = {
      name: '',
      email: email || '',
      phone: '',
      isShgMember: false,
      shgName: ''
    };
    setCurrentUser(user);
    return { success: true };
  };

  const registerUser = (details = {}) => {
    const user = {
      name: details.name || '',
      email: details.email || '',
      phone: details.phone || '',
      isShgMember: details.isShgMember || false,
      shgName: details.shgName || ''
    };
    setCurrentUser(user);
    return { success: true };
  };

  const logoutUser = () => {
    deregisterPushToken().catch(() => {});
    localStorage.removeItem('userToken');
    localStorage.removeItem('userProfile');
    setCurrentUser(null);
    setActiveNav('home');
    disconnectSocket();
    setWishlist(new Set());
    setWishlistItems([]);
  };

  const toggleUserShgMembership = () => {
    if (currentUser) {
      setCurrentUser(prev => ({
        ...prev,
        isShgMember: !prev.isShgMember
      }));
    }
  };

  // ========================
  // CART — server-backed, one basket per storefront
  // ========================
  // Quick and Shop All are fulfilled differently and never ship together, so
  // they have separate carts. The channel here follows whichever storefront the
  // shopper is browsing. Totals always come from the server, so the cart and the
  // checkout can never disagree about what the order costs.

  const authHeaders = (json = true) => {
    const token = localStorage.getItem('userToken');
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  /* ── PREMIUM MEMBERSHIP ──────────────────────────────────────────────────
   * The entitlement that lets a customer create Product Subscriptions.
   *
   * `isPremium` is whatever GET /api/premium/me last said — never derived
   * here from an expiry date. The server re-checks it on every subscription
   * creation anyway, so anything computed in the browser could only ever be
   * a second, disagreeing opinion.
   */
  const [premiumMembership, setPremiumMembership] = useState(null);
  const [isPremium, setIsPremium] = useState(false);
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumPlans, setPremiumPlans] = useState([]);
  const [premiumPlansError, setPremiumPlansError] = useState('');

  const fetchPremiumStatus = useCallback(async () => {
    if (!localStorage.getItem('userToken')) {
      setIsPremium(false);
      setPremiumMembership(null);
      return { isPremium: false };
    }
    setPremiumLoading(true);
    try {
      const res = await fetch(apiUrl('/api/premium/me'), { headers: authHeaders(false) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not read your membership');
      setIsPremium(Boolean(body.data?.isPremium));
      setPremiumMembership(body.data?.membership || null);
      return body.data;
    } catch {
      // A failed read is not proof of anything — it must not grant access,
      // and the server would refuse the creation regardless.
      setIsPremium(false);
      setPremiumMembership(null);
      return { isPremium: false };
    } finally {
      setPremiumLoading(false);
    }
  }, []);

  const fetchPremiumPlans = useCallback(async () => {
    setPremiumPlansError('');
    try {
      const res = await fetch(apiUrl('/api/premium/plans'), { headers: authHeaders(false) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not load membership plans');
      setPremiumPlans(body.data || []);
      return body.data || [];
    } catch (err) {
      setPremiumPlansError(err.message);
      setPremiumPlans([]);
      return [];
    }
  }, []);

  /**
   * Hand off to PhonePe for a plan. Only a planId is sent — the price, the
   * duration and the membership's expiry are all the server's to decide.
   */
  const startPremiumPurchase = async (planId) => {
    try {
      const res = await fetch(apiUrl('/api/premium/purchase'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ planId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.data?.redirectUrl) {
        return { ok: false, message: body.message || 'Could not start the payment' };
      }
      // The basket lives on the server (SubscriptionBasket), so leaving the
      // app for the gateway cannot lose it — PhonePe returns to /basket.
      window.location.href = body.data.redirectUrl;
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error starting the payment' };
    }
  };

  const EMPTY_CART = { items: [], count: 0, pricing: null, warnings: [], channel: 'ecommerce' };

  // Same resolution as the storefront itself, so the first fetch on a reload
  // asks for the basket the shopper was actually filling.
  const [cartChannel, setCartChannel] = useState(() =>
    (resolveMode() === 'quick' ? 'grocery' : 'ecommerce')
  );
  /**
   * Which delivery the customer picked — null until they actually pick.
   *
   * Deliberately not defaulted. Same-Day and Scheduled cost different amounts
   * and promise different days, so pre-selecting either is choosing wrong for
   * half of everyone. Checkout keeps Place Order disabled until this is set.
   *
   * Cleared whenever the basket changes storefront, because a Quick order has no
   * mode to choose and a stale choice would be carried into the wrong cart.
   */
  const [deliveryMode, setDeliveryModeState] = useState(null);

  const [serverCart, setServerCart] = useState(EMPTY_CART);
  const [cartLoading, setCartLoading] = useState(false);
  const [cartSummary, setCartSummary] = useState({});

  /**
   * "Use Coins" is intent only — the server decides everything else
   * (eligibility, max redemption, actual discount; see serverCart.coins,
   * populated by GET /api/cart). This flag just controls whether the next
   * cart fetch asks the server to apply the discount or not; it is never
   * itself the discount amount.
   */
  const [useCoinsSelected, setUseCoinsSelected] = useState(false);

  const isSignedIn = () => Boolean(localStorage.getItem('userToken'));

  const refreshCartSummary = useCallback(async () => {
    if (!isSignedIn()) { setCartSummary({}); return; }
    try {
      const res = await fetch(apiUrl('/api/cart/summary'), { headers: authHeaders(false) });
      if (!res.ok) return;
      const body = await res.json();
      setCartSummary(body.data || {});
    } catch { /* badges are non-critical */ }
  }, []);

  const refreshCart = useCallback(async (channel, coupon, mode) => {
    const ch = channel || cartChannel;
    const cp = coupon !== undefined ? coupon : couponCode;
    // An explicit mode wins, so a freshly picked one is priced immediately
    // rather than a render later.
    const wantMode = mode !== undefined ? mode : deliveryMode;
    if (!isSignedIn()) { setServerCart({ ...EMPTY_CART, channel: ch }); return; }

    setCartLoading(true);
    try {
      /**
       * The address and the chosen delivery mode go with the request.
       *
       * The server prices the basket for the mode that was picked and reports
       * which modes are on offer, so the checkout never has to work out a
       * delivery charge itself. One rule, one implementation — the alternative
       * is two, drifting apart, which is how this codebase has been bitten
       * before.
       */
      const qs = new URLSearchParams({ channel: ch });
      if (cp) qs.set('coupon', cp);
      const point = getDeliveryPoint();
      if (point) { qs.set('lat', String(point.lat)); qs.set('lng', String(point.lng)); }
      if (wantMode) qs.set('deliveryMode', wantMode);
      if (useCoinsSelected) qs.set('useCoins', 'true');

      const res = await fetch(apiUrl(`/api/cart?${qs}`), { headers: authHeaders(false) });
      if (res.status === 401) {
        localStorage.removeItem('userToken');
        localStorage.removeItem('userProfile');
        setServerCart({ ...EMPTY_CART, channel: ch });
        return;
      }
      const body = await res.json();
      const cartData = body.data || { ...EMPTY_CART, channel: ch };
      setServerCart(cartData);
      if (ch === 'ecommerce' && cartData.items?.length > 0) {
        const itemMode = cartData.items[0].deliveryMode;
        if (itemMode) {
          setDeliveryModeState(itemMode);
        }
      }
    } catch {
      setServerCart({ ...EMPTY_CART, channel: ch });
    } finally {
      setCartLoading(false);
      refreshCartSummary();
    }
    // getDeliveryPoint reads the saved-address list, which changes rarely and
    // never during a re-price; leaving it out keeps this from re-running on
    // every address edit while the customer is mid-checkout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartChannel, couponCode, deliveryMode, refreshCartSummary, selectedAddressId, useCoinsSelected]);

  /** Toggling re-fetches the cart so the discount shown is always server-calculated, never guessed client-side. */
  const toggleUseCoins = (next) => setUseCoinsSelected(Boolean(next));

  /**
   * Choose how this order should arrive, and re-price it.
   *
   * The charge is not worked out here — the cart is fetched again with the mode
   * attached and the server prices it. That keeps the number the customer agrees
   * to and the number they are charged as one figure from one function.
   */
  const setDeliveryMode = (mode) => {
    // Setting it is enough: `deliveryMode` is a dependency of refreshCart, so
    // the cart re-fetches itself with the new mode. Calling refreshCart here as
    // well would fetch the same basket twice for one tap.
    setDeliveryModeState(mode);
  };

  useEffect(() => { refreshCart(); }, [refreshCart]);

  useEffect(() => {
    const channel = activeMode === 'quick' ? 'grocery' : 'ecommerce';
    if (cartChannel !== channel) {
      setCartChannel(channel);
      // A choice made for one basket must not follow the shopper into another.
      setDeliveryModeState(null);
    }
  }, [activeMode, cartChannel]);

  /** Shared plumbing for every cart mutation. */
  const cartCall = async (method, path, body) => {
    if (!isSignedIn()) {
      return { ok: false, message: 'Please sign in to use your cart.' };
    }
    try {
      const res = await fetch(apiUrl(`/api/cart${path}`), {
        method,
        headers: authHeaders(Boolean(body)),
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const serverMessage = String(payload.message || '');
        // Keep Mongo/index internals out of customer-facing cart feedback.
        if (/E11000|duplicate key|customerId_1/i.test(serverMessage)) {
          console.error('[cart] Cart mutation rejected by a database uniqueness constraint.');
          return {
            ok: false,
            message: 'We couldn’t update your cart right now. Please try again in a moment.',
          };
        }
        return { ok: false, message: serverMessage || 'Could not update your cart' };
      }

      // The server returns the cart it just changed, which may not be the one
      // on screen — adding a grocery item while browsing Shop All, for example.
      if (payload.data?.channel === cartChannel) setServerCart(payload.data);
      refreshCartSummary();
      return { ok: true, data: payload.data, message: payload.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  // The product's own channel decides which basket it lands in — the server
  // enforces that, so this does not need to guess.
  const addToCart = async (productId, qty = 1) => {
    const r = await cartCall('POST', '', { productId, qty });
    if (r.ok && r.data?.channel !== cartChannel) {
      // it went into the other storefront's basket; keep both views honest
      refreshCart();
    }
    return r;
  };

  const setCartItemQty = async (itemId, qty) => cartCall('PUT', `/${itemId}`, { qty });
  const deleteCartItem = async (itemId) => cartCall('DELETE', `/${itemId}`);
  const clearCart = async () => cartCall('DELETE', `?channel=${cartChannel}`);

  /** Decrease by one; the server removes the line when it reaches zero. */
  const removeFromCart = async (itemId, currentQty) =>
    setCartItemQty(itemId, Math.max(0, Number(currentQty || 1) - 1));

  const switchCartChannel = (channel) => {
    setCartChannel(channel);
    refreshCart(channel);
  };

  // ---- read helpers the pages already use --------------------------------
  const getCartItems = () => serverCart.items || [];
  const getCartCount = () => {
    if (!cartSummary) return serverCart.count || 0;
    const sum = Object.values(cartSummary).reduce((acc, ch) => acc + (ch.count || 0), 0);
    return sum || serverCart.count || 0;
  };
  const getCartSubtotal = () => serverCart.pricing?.subtotal || 0;
  const getDeliveryCharge = () => serverCart.pricing?.deliveryCharge || 0;
  const getCdsDiscount = () => serverCart.pricing?.cdsDiscount || 0;
  const getCartTotal = () => serverCart.pricing?.totalAmount || 0;
  const getCartWarnings = () => serverCart.warnings || [];

  /** Quantity of one product in the current basket, 0 if it is not in there.
   *  The old cart was a { productId: qty } map that pages indexed directly;
   *  the server cart is a list, so lookups go through this instead. */
  const getItemQty = (productId) =>
    (serverCart.items || []).find((i) => String(i.productId) === String(productId))?.qty || 0;
  const getCouponDiscount = () => serverCart.pricing?.couponDiscount || 0;
  // There is no platform fee on the server; the cart used to invent a flat ₹5,
  // which meant the displayed total never matched what was actually charged.
  const getPlatformFee = () => 0;
  const getTotalSavings = () => serverCart.pricing?.totalSavings || 0;

  // ========================
  // COUPON HANDLERS
  // ========================

  /**
   * The client only ever sends a CODE. The server evaluates it against the live
   * cart and returns the discount, so a tampered request cannot manufacture a
   * bigger saving — and the number shown here is the number that gets charged.
   */

  const applyCoupon = async (code) => {
    if (!isSignedIn()) return { success: false, message: 'Please sign in to use a coupon.' };
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return { success: false, message: 'Please enter a coupon code.' };

    try {
      const res = await fetch(apiUrl('/api/coupons/validate'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ code: clean, channel: cartChannel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, message: body.message || 'Could not check that coupon' };

      // "Add ₹200 more" is a normal answer, not an error — show it as-is.
      if (!body.data?.valid) {
        return { success: false, message: body.data?.reason || 'That coupon is not valid.' };
      }

      setCouponCode(clean);
      setAppliedCoupon(body.data.coupon);
      await refreshCart(cartChannel, clean);   // re-price the cart with the coupon applied
      return {
        success: true,
        message: `"${clean}" applied — you save ₹${body.data.pricing.totalSavings}`,
      };
    } catch (err) {
      return { success: false, message: err.message };
    }
  };

  const removeCoupon = async () => {
    setCouponCode('');
    setAppliedCoupon(null);
    await refreshCart(cartChannel, '');
  };

  /**
   * Verify a CDS membership number.
   * The check itself lives on the server (services/cds.service.js), so the
   * discount a member gets can never be granted by the client.
   */
  const verifyCDS = async (membershipNo) => {
    if (!isSignedIn()) return { success: false, message: 'Please sign in first.' };
    if (!membershipNo) return { success: false, message: 'Enter your CDS membership number.' };
    try {
      const res = await fetch(apiUrl('/api/users/cds/verify'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ cdsMembershipNo: membershipNo }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, message: body.message || 'Could not verify that number' };

      // A verified member is priced differently, so refresh the cart too.
      if (body.user) {
        localStorage.setItem('userProfile', JSON.stringify(body.user));
        setCurrentUser(body.user);
      }
      await refreshCart();
      return { success: true, message: body.message || 'CDS membership verified', user: body.user };
    } catch (err) {
      return { success: false, message: err.message };
    }
  };

  /** Offers this shopper can use right now, each with a reason if they cannot. */
  const fetchAvailableCoupons = useCallback(async () => {
    if (!isSignedIn()) { setAvailableCoupons([]); return; }
    try {
      const res = await fetch(apiUrl(`/api/coupons/available?channel=${cartChannel}`), {
        headers: authHeaders(false),
      });
      if (!res.ok) { setAvailableCoupons([]); return; }
      const body = await res.json();
      setAvailableCoupons(body.data || []);
    } catch {
      setAvailableCoupons([]);
    }
  }, [cartChannel]);

  /**
   * The Help Wallet / Social Work donation prompt config for checkout.
   * Public — no sign-in required to fetch it, same as the storefront's
   * other read-only catalog data. Purely informational; the amount that
   * actually gets charged is independently re-validated server-side at
   * order placement, never taken from anything cached here.
   */
  const [donationSetting, setDonationSetting] = useState(null);
  const fetchDonationSetting = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/donation-setting'));
      const body = await res.json().catch(() => ({}));
      if (res.ok) setDonationSetting(body.data || null);
    } catch {
      // leave whatever was already loaded rather than blank the checkout on a network blip
    }
  }, []);
  useEffect(() => { fetchDonationSetting(); }, [fetchDonationSetting]);

  // Saved Donation Preference (Persistent Customer Setting)
  const [donationPref, setDonationPref] = useState(null);
  const [donationPrefLoading, setDonationPrefLoading] = useState(false);
  const [donationPrefError, setDonationPrefError] = useState('');

  const fetchDonationPreference = useCallback(async () => {
    const token = localStorage.getItem('userToken') || localStorage.getItem('token');
    if (!token) { setDonationPref(null); return null; }
    setDonationPrefLoading(true);
    setDonationPrefError('');
    try {
      const res = await fetch(apiUrl('/api/users/donation-preference'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        setDonationPref(body.data?.preference || null);
        if (body.data?.setting) setDonationSetting(body.data.setting);
        return body.data?.preference || null;
      } else {
        setDonationPrefError(body.message || 'Failed to fetch donation preference');
      }
    } catch (e) {
      setDonationPrefError(e.message || 'Error fetching donation preference');
    } finally {
      setDonationPrefLoading(false);
    }
    return null;
  }, []);

  const saveDonationPreference = useCallback(async ({ enabled, amount }) => {
    const token = localStorage.getItem('userToken') || localStorage.getItem('token');
    if (!token) throw new Error('Please login to save donation preference');
    setDonationPrefLoading(true);
    setDonationPrefError('');
    try {
      const res = await fetch(apiUrl('/api/users/donation-preference'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ enabled, amount })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        throw new Error(body.message || 'Could not save donation preference');
      }
      setDonationPref(body.data?.preference || { enabled, amount });
      return body.data?.preference;
    } catch (err) {
      setDonationPrefError(err.message);
      throw err;
    } finally {
      setDonationPrefLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      fetchDonationPreference();
    }
  }, [currentUser, fetchDonationPreference]);

  const [tipSetting, setTipSetting] = useState(null);
  const fetchTipSetting = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('/api/tip-setting'));
      const body = await res.json().catch(() => ({}));
      if (res.ok) setTipSetting(body.data || null);
    } catch {
      // leave whatever was already loaded
    }
  }, []);
  useEffect(() => { fetchTipSetting(); }, [fetchTipSetting]);

  // ========================
  // ADDRESSES — server-backed
  // ========================
  // These used to be local state seeded with a demo address, so anything a
  // shopper added vanished on refresh and checkout sent a stranger's address.
  // The backend has had full address CRUD all along; this now uses it.

  const refreshAddresses = useCallback(async () => {
    if (!isSignedIn()) { setSavedAddresses([]); return; }
    try {
      const res = await fetch(apiUrl('/api/users/addresses'), { headers: authHeaders(false) });
      if (!res.ok) return;
      const body = await res.json();
      const rawList = body.data || body.addresses || [];
      const list = rawList.map((a) => {
        const idVal = String(a._id || a.id || '');
        return {
          ...a,
          id: idVal,
          _id: idVal,
        };
      });
      setSavedAddresses(list);
      // Default to the address the shopper marked as default.
      setSelectedAddressId((cur) => {
        if (cur && list.some((a) => String(a.id) === String(cur))) return cur;
        const def = list.find((a) => a.isDefault) || list[0];
        return def ? def.id : null;
      });
    } catch { /* keep whatever is on screen */ }
  }, []);

  useEffect(() => { refreshAddresses(); }, [refreshAddresses]);

  const addAddress = async (address) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in first.' };
    try {
      const res = await fetch(apiUrl('/api/users/addresses'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(address),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save the address' };
      await refreshAddresses();
      return { ok: true, message: body.message || 'Address saved' };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const uploadLandmarkImage = async (file) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in first.' };
    try {
      const formData = new FormData();
      formData.append('image', file);
      const headers = authHeaders(false);
      delete headers['Content-Type'];
      const res = await fetch(apiUrl('/api/users/addresses/upload-landmark'), {
        method: 'POST',
        headers,
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not upload landmark image' };
      return { ok: true, imageUrl: body.imageUrl };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const updateAddress = async (targetId, data) => {
    const id = typeof targetId === 'object' ? (targetId?._id || targetId?.id) : targetId;
    if (!id || id === 'undefined') return { ok: false, message: 'Invalid address ID' };
    try {
      const res = await fetch(apiUrl(`/api/users/addresses/${id}`), {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not update the address' };
      await refreshAddresses();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const deleteAddress = async (targetId) => {
    const id = typeof targetId === 'object' ? (targetId?._id || targetId?.id) : targetId;
    if (!id || id === 'undefined') return { ok: false, message: 'Invalid address ID' };
    try {
      const res = await fetch(apiUrl(`/api/users/addresses/${id}`), {
        method: 'DELETE', headers: authHeaders(false),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { ok: false, message: body.message || 'Could not delete the address' };
      }
      if (String(selectedAddressId) === String(id)) setSelectedAddressId(null);
      await refreshAddresses();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  /**
   * Save where the shopper wants things delivered.
   *
   * This is what the header's location picker calls, and it used to do none of
   * it: the picker read the device's coordinates, threw them away, kept a
   * display string in localStorage, and never spoke to the server. So the header
   * changed and nothing else did — no pin on the tracking map, no distance for
   * the rider, and checkout still using whatever address was on file.
   *
   * The coordinates go onto the shopper's default address, because that is the
   * one record every other part of the app already reads. `line1` is only
   * written when there is nothing there: a geocoded street name is no
   * replacement for "Flat 402, second gate".
   *
   * @param {{lat:number,lng:number,accuracy?:number}} coords
   * @param {'gps'|'manual'} source
   */
  const saveDeliveryLocation = async (coords, source = 'gps') => {
    /**
     * LocationPromptModal is shown on first landing-page visit — before
     * anyone has signed in (gated only by a `locationAsked` localStorage
     * flag, not by auth). But both `/api/geo/reverse` and the address-save
     * endpoint below require `protect`. A guest granting GPS permission
     * would see the browser's own prompt succeed, then this function fail
     * silently on the very next line — reading as "location access doesn't
     * work" when the real cause was never GPS at all.
     *
     * For a guest, save locally only: no reverse geocode (would 401), no
     * address record (nothing to attach it to yet). This is exactly the
     * "show me nearby products while browsing" purpose the modal states —
     * a real saved address still only exists once they sign in and use
     * checkout/profile, which already go through the full flow below.
     */
    if (!isSignedIn()) {
      const label = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      setLocation(label);
      localStorage.setItem('userLocation', label);
      localStorage.setItem('guestLocationCoords', JSON.stringify({ lat: coords.lat, lng: coords.lng }));
      return { ok: true, label, resolved: {} };
    }

    // Our own lookup, not a second geocoder called from the browser. It is
    // cached and rate limited server-side, so the same spot is not billed twice.
    let resolved = {};
    try {
      const res = await fetch(apiUrl(`/api/geo/reverse?lat=${coords.lat}&lng=${coords.lng}${coords.accuracy ? `&accuracy=${Math.round(coords.accuracy)}` : ''}`), {
        headers: authHeaders(false),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) resolved = body.data || {};
    } catch { /* the pin is still worth saving without a street name */ }

    const existing = savedAddresses.find((a) => a.isDefault) || savedAddresses[0];

    const payload = {
      name: existing?.name || currentUser?.name || 'Home',
      phone: existing?.phone || currentUser?.phone || '',
      // Keep whatever the shopper typed; only fill a blank.
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
      const res = existing
        ? await fetch(apiUrl(`/api/users/addresses/${existing._id}`), {
          method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
        })
        : await fetch(apiUrl('/api/users/addresses'), {
          method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
        });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save your location' };

      await refreshAddresses();

      // The header label, derived from what was actually saved.
      const displayAddress = resolved.placeName || resolved.address;
      const label = displayAddress
        ? [displayAddress, resolved.city, resolved.state, resolved.pincode].filter(Boolean).join(', ')
        : [resolved.city, resolved.state, resolved.pincode].filter(Boolean).join(', ')
        || `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
      setLocation(label);
      localStorage.setItem('userLocation', label);

      return { ok: true, label, resolved };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /**
   * Resolve typed text to a point, then save it as the delivery location.
   *
   * A shopper who denies the location prompt still has to be deliverable to, and
   * a label on its own is not a place. This is the manual path: the server looks
   * the text up and the result goes through the same save as a GPS fix, marked
   * `manual` so nobody later mistakes it for a reading taken at the door.
   */
  const lookupTypedLocation = async (text) => {
    // Same guest gap as saveDeliveryLocation above: /api/geo/forward also
    // requires auth. A guest's typed text is saved as-is, as a label with
    // no resolved coordinates — honest about what it is, rather than
    // failing the whole "enter manually" fallback for anyone not signed in.
    if (!isSignedIn()) {
      setLocation(text);
      localStorage.setItem('userLocation', text);
      return { ok: true, label: text, resolved: {} };
    }

    try {
      const res = await fetch(apiUrl(`/api/geo/forward?q=${encodeURIComponent(text)}`), {
        headers: authHeaders(false),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'We could not find that place' };

      return saveDeliveryLocation({ lat: body.data.lat, lng: body.data.lng }, 'manual');
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  const setDefaultAddress = async (id) => {
    try {
      await fetch(apiUrl(`/api/users/addresses/${id}/default`), {
        method: 'PUT', headers: authHeaders(false),
      });
      await refreshAddresses();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  /**
   * Where the customer wants things delivered, as coordinates.
   *
   * Every delivery question — can this arrive today, how far is the shop, is a
   * rider near — is answered against this one point, so it is derived in one
   * place rather than each screen digging through the address list.
   *
   * `null` when there is no address yet, or when the saved one was typed rather
   * than pinned and so has no coordinates. Callers must treat that as "we cannot
   * say", not as "unavailable" — the difference matters on a product card.
   */
  const getDeliveryPoint = () => {
    const addr = getSelectedAddress();
    if (!addr || addr.lat === undefined || addr.lng === undefined) return null;
    return { lat: addr.lat, lng: addr.lng };
  };

  const getSelectedAddress = () =>
    savedAddresses.find((a) => String(a._id) === String(selectedAddressId))
    || savedAddresses.find((a) => a.isDefault)
    || savedAddresses[0]
    || null;

  const getLocationDisplayName = (addr) => {
    if (!addr) return 'Set your location';
    const primary = addr.placeName || addr.line1 || addr.city || '';
    const secondary = [addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
    if (primary && secondary && primary !== addr.city) {
      return `${primary}, ${secondary}`;
    }
    return secondary || `${addr.lat?.toFixed(4) || 0}, ${addr.lng?.toFixed(4) || 0}`;
  };

  useEffect(() => {
    const active = getSelectedAddress();
    if (active) {
      const displayName = getLocationDisplayName(active);
      setLocation(displayName);
      localStorage.setItem('userLocation', displayName);
    }
  }, [savedAddresses, selectedAddressId]);

  // ========================
  // ORDER HANDLERS
  // ========================

  // ========================
  // ORDERS — server-backed
  // ========================
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const PAYMENT_CODE = {
    'Cash on Delivery': 'cod',
    'Online Payment': 'online',
    'Wallet': 'wallet',
    'wallet': 'wallet',
    'cod': 'cod',
    'online': 'online',
  };

  const fetchOrders = useCallback(async () => {
    if (!isSignedIn()) { setOrders([]); return; }
    setOrdersLoading(true);
    try {
      const res = await fetch(apiUrl('/api/orders?limit=50'), { headers: authHeaders(false) });
      if (!res.ok) { setOrders([]); return; }
      const body = await res.json();
      setOrders(body.data || []);
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // ========================
  // SUBSCRIPTIONS — server-backed, same shape as ORDERS above
  // ========================
  const [subscriptions, setSubscriptions] = useState([]);
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(false);
  const [subscriptionsError, setSubscriptionsError] = useState('');
  const [selectedSubscription, setSelectedSubscription] = useState(null);

  const fetchSubscriptions = useCallback(async () => {
    if (!isSignedIn()) { setSubscriptions([]); return; }
    setSubscriptionsLoading(true);
    setSubscriptionsError('');
    try {
      const res = await fetch(apiUrl('/api/subscriptions'), { headers: authHeaders(false) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubscriptionsError(body.message || 'Could not load your subscriptions');
        setSubscriptions([]);
        return;
      }
      setSubscriptions(body.data || []);
    } catch (err) {
      setSubscriptionsError(err.message || 'Network error — is the server running?');
      setSubscriptions([]);
    } finally {
      setSubscriptionsLoading(false);
    }
  }, []);

  /**
   * The authoritative single subscription — always re-fetched by id, never
   * trusted from the list row alone. A list row can be seconds to minutes
   * stale (schedule/status can move via the seller's own actions or the
   * sweepers); opening the detail screen re-reads from the backend the
   * same way `selectedOrder`'s tracking screen already does for orders.
   */
  const fetchSubscriptionById = useCallback(async (id) => {
    try {
      const res = await fetch(apiUrl(`/api/subscriptions/${id}`), { headers: authHeaders(false) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not load this subscription' };
      setSelectedSubscription(body.data);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  }, []);

  /**
   * Place the order for the storefront currently being viewed.
   * Totals are recalculated server-side from live prices, so what is charged
   * always matches what the cart showed.
   */
  const placeOrder = async (paymentMethod = 'Cash on Delivery', donation = null, tipAmount = 0) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to place an order.' };
    if ((serverCart.items || []).length === 0) return { ok: false, message: 'Your cart is empty.' };

    const addr = getSelectedAddress();
    if (!addr) return { ok: false, message: 'Please add a delivery address first.' };

    // Validate required address fields — the backend returns 400 if any are missing.
    if (!addr.phone) return { ok: false, message: 'Your saved address is missing a phone number. Please add a new address with your mobile number.' };
    if (!addr.line1 && !addr.address) return { ok: false, message: 'Your saved address is missing the address line. Please add a new address.' };
    if (!addr.city) return { ok: false, message: 'Your saved address is missing a city. Please add a new address.' };
    if (!addr.pincode) return { ok: false, message: 'Your saved address is missing a pincode. Please add a new address.' };

    try {
      const res = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          channel: cartChannel,
          coupon: couponCode || undefined,
          paymentMethod: PAYMENT_CODE[paymentMethod] || 'cod',
          /**
           * The chosen mode, which the server checks again before it accepts.
           *
           * Sent only for Shop All: a Quick order has one way of arriving, and
           * the server refuses a mode on a grocery cart outright.
           *
           * By the time this is tapped the offer may already be stale — a
           * cut-off can pass while an address is typed. The server re-runs the
           * eligibility check and refuses rather than quietly downgrading, so a
           * customer never pays for one delivery and gets another.
           */
          deliveryMode: cartChannel === 'ecommerce' ? (deliveryMode || serverCart?.items?.[0]?.deliveryMode || undefined) : undefined,
          // Intent only — same discipline as the coupon code below. The
          // server recalculates eligibility, the balance, the 20% cap and
          // the actual discount itself; nothing about the amount is trusted
          // from here (see coin.service.js::calculateRedemptionEligibility).
          useCoins: useCoinsSelected,
          // The client names an amount, same as a coupon names a code — the
          // server never trusts either one, it re-validates against its own
          // live DonationSetting before a rupee of it is ever charged.
          donationOptedIn: Boolean(donation?.amount > 0),
          donationAmount: donation?.amount || undefined,
          // Likewise re-validated server-side against the fixed tip ladder
          // (tip.service.js) — a number that isn't on it is refused, not
          // rounded to something the customer never picked.
          tipAmount: tipAmount || undefined,
          addressId: addr._id || addr.id || undefined,
          shippingAddress: {
            name: addr.name || 'Customer',
            phone: addr.phone,
            line1: addr.line1 || addr.address,
            line2: addr.line2,
            city: addr.city,
            state: addr.state || '',
            pincode: addr.pincode,
            lat: addr.lat,
            lng: addr.lng,
            landmarkImage: addr.landmarkImage || addr.locationReferenceImage || null,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not place your order' };

      setCouponCode('');
      setAppliedCoupon(null);
      setUseCoinsSelected(false);
      await Promise.all([refreshCart(cartChannel, ''), fetchOrders(), fetchWalletBalance()]);
      return { ok: true, order: body.data.order, coinsUsed: body.data.coinsUsed, coinDiscount: body.data.coinDiscount, message: body.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  /**
   * Check out the whole basket at once: one payment, several deliveries.
   *
   * Used only when the basket actually spans more than one fulfilment — a single
   * group still goes through placeOrder above, which is the path every existing
   * screen and every existing order was built on.
   *
   * No delivery mode is sent. The choice already lives on the cart lines, where
   * the shopper put it, and the server regroups from there — passing it again
   * from here would be a second copy of the same decision, free to disagree.
   */
  const placeUnifiedOrder = async (paymentMethod = 'Cash on Delivery', donation = null, tipAmount = 0) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to place an order.' };

    const addr = getSelectedAddress();
    if (!addr) return { ok: false, message: 'Please add a delivery address first.' };
    if (!addr.phone) return { ok: false, message: 'Your saved address is missing a phone number.' };
    if (!addr.line1 && !addr.address) return { ok: false, message: 'Your saved address is missing the address line.' };
    if (!addr.city) return { ok: false, message: 'Your saved address is missing a city.' };
    if (!addr.pincode) return { ok: false, message: 'Your saved address is missing a pincode.' };

    try {
      const res = await fetch(apiUrl('/api/orders/unified'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          paymentMethod: PAYMENT_CODE[paymentMethod] || 'cod',
          donationOptedIn: Boolean(donation?.amount > 0),
          donationAmount: donation?.amount || undefined,
          // Likewise re-validated server-side against the fixed tip ladder
          // (tip.service.js) — a number that isn't on it is refused, not
          // rounded to something the customer never picked.
          tipAmount: tipAmount || undefined,
          addressId: addr._id || addr.id || undefined,
          shippingAddress: {
            name: addr.name || 'Customer',
            phone: addr.phone,
            line1: addr.line1 || addr.address,
            line2: addr.line2,
            city: addr.city,
            state: addr.state || '',
            pincode: addr.pincode,
            lat: addr.lat,
            lng: addr.lng,
            landmarkImage: addr.landmarkImage || addr.locationReferenceImage || null,
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not place your order' };

      await Promise.all([refreshCart(cartChannel, ''), fetchOrders()]);
      return {
        ok: true,
        orders: body.data.orders,
        groupRef: body.data.groupRef,
        payment: body.data.payment,
        message: body.message,
      };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  /**
   * Start a PhonePe payment for an order that was created with
   * paymentMethod: 'online' — same gateway, same reused pattern as the SHG
   * subscription purchase flow (POST → redirectUrl → hand the browser to
   * PhonePe). The order is never marked paid here or anywhere on the
   * client; only the signed webhook / the backend's own status check does
   * that, exactly like every other PhonePe flow in this app.
   */
  const initiateOnlinePayment = async (orderId) => {
    try {
      const res = await fetch(apiUrl('/api/payments/initiate'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ orderId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not start the payment' };
      return { ok: true, redirectUrl: body.data?.redirectUrl };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const cancelOrder = async (orderId, reason) => {
    try {
      const res = await fetch(apiUrl(`/api/orders/${orderId}/cancel`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ reason: reason || 'Cancelled by customer' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not cancel this order' };
      await fetchOrders();
      return { ok: true, message: body.message };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  // ========================
  // WISHLIST HANDLERS
  // ========================

  /** GET /api/wishlist — full items for the Wishlist page, plus the id
   *  Set every product-card heart checks against. Called once on login,
   *  not once per card (see Phase 13 of the plan: no per-card requests). */
  const refreshWishlist = useCallback(async () => {
    if (!isSignedIn()) { setWishlist(new Set()); setWishlistItems([]); return; }
    setWishlistLoading(true);
    try {
      const res = await fetch(apiUrl('/api/wishlist'), { headers: authHeaders(false) });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || 'Could not load your wishlist');
      setWishlistItems(payload.data?.items || []);
      setWishlist(new Set((payload.data?.productIds || []).map(String)));
    } catch {
      // leave whatever was already loaded rather than blank the page on a network blip
    } finally {
      setWishlistLoading(false);
    }
  }, []);

  useEffect(() => { refreshWishlist(); }, [refreshWishlist]);

  /**
   * Shared plumbing for both directions — optimistic (the Set flips before
   * the request lands), with a rollback to exactly the prior state on
   * failure, per the plan's "never show wishlisted if the backend
   * rejected it" rule. Guests get a message instead of a network call —
   * same "ask before persisting" behavior `cartCall` already uses for the
   * cart (in practice unreachable in the current UI, since the whole
   * storefront already requires sign-in to render a product card at all,
   * but kept as the correct guard for a stale/cleared session).
   */
  const wishlistCall = async (id, add) => {
    if (!isSignedIn()) {
      return { ok: false, message: 'Please sign in to save products to your Wishlist.' };
    }

    const wasWishlisted = wishlist.has(id);
    if (wasWishlisted === add) return { ok: true }; // already in the target state

    setWishlist((prev) => {
      const next = new Set(prev);
      if (add) next.add(id); else next.delete(id);
      return next;
    });

    try {
      const res = await fetch(apiUrl(`/api/wishlist/${id}`), {
        method: add ? 'POST' : 'DELETE',
        headers: authHeaders(false),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.message || 'Could not update your wishlist');

      // Keep wishlistItems (the full-data list the Wishlist page renders)
      // in sync too, without a second round trip on removal; an addition
      // needs the newly-wishlisted product's own data, so that one refetches.
      if (add) refreshWishlist();
      else setWishlistItems((prev) => prev.filter((p) => String(p._id) !== id));

      return { ok: true };
    } catch (err) {
      setWishlist((prev) => {
        const next = new Set(prev);
        if (add) next.delete(id); else next.add(id);
        return next;
      });
      return { ok: false, message: err.message };
    }
  };

  const toggleWishlist = (productId) => {
    const id = String(productId);
    return wishlistCall(id, !wishlist.has(id));
  };

  /** Directional — used by "Move to Wishlist" so an already-wishlisted
   *  product is never accidentally removed by a toggle going the wrong way. */
  const addToWishlist = (productId) => wishlistCall(String(productId), true);
  const removeFromWishlist = (productId) => wishlistCall(String(productId), false);

  const isWishlisted = (productId) => wishlist.has(String(productId));

  const getWishlistItems = () => wishlistItems;

  // ========================
  // NOTIFICATION HANDLERS
  // ========================

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const getUnreadCount = () => notifications.filter(n => !n.read).length;

  return (
    <UserContext.Provider
      value={{
        // Authentication
        currentUser, loginUser, registerUser, logoutUser, toggleUserShgMembership,
        sendOtp, verifyOtp, updateUserProfile,

        // Navigation
        activeMode, setActiveMode,
        productTab, setProductTab,
        // Premium Membership — the gate in front of Product Subscriptions
        premiumMembership, isPremium, premiumLoading, premiumPlans, premiumPlansError,
        fetchPremiumStatus, fetchPremiumPlans, startPremiumPurchase,

        activeNav, setActiveNav,
        activeSubNav, setActiveSubNav,
        isVoiceModalOpen, setIsVoiceModalOpen, openVoiceSearch, closeVoiceSearch,
        pendingVoiceQuery, setPendingVoiceQuery,
        selectedCategoryFilter, setSelectedCategoryFilter,
        location, setLocation, saveDeliveryLocation, lookupTypedLocation,
        showLocationModal, setShowLocationModal,

        // Product Detail & Reviews
        selectedProduct, setSelectedProduct,
        reviewProductId, setReviewProductId,

        // Cart — server-backed, one basket per storefront
        cart: serverCart,
        serverCart, cartChannel, switchCartChannel, cartSummary, cartLoading, refreshCart,
        useCoinsSelected, toggleUseCoins,
        deliveryMode, setDeliveryMode,
        addToCart, removeFromCart, clearCart,
        setCartItemQty, deleteCartItem,
        getCartCount, getCartItems, getCartWarnings, getItemQty,
        getCartSubtotal, getDeliveryCharge, getCouponDiscount, getPlatformFee, getCartTotal,

        // Coupon
        verifyCDS,
        appliedCoupon, applyCoupon, removeCoupon,
        couponCode, availableCoupons, fetchAvailableCoupons, getTotalSavings,
        donationSetting, fetchDonationSetting,
        donationPref, donationPrefLoading, donationPrefError, fetchDonationPreference, saveDonationPreference,
        tipSetting, fetchTipSetting,

        // Addresses
        savedAddresses, selectedAddressId, setSelectedAddressId,
        addAddress, updateAddress, deleteAddress, setDefaultAddress, uploadLandmarkImage,
        getSelectedAddress, getDeliveryPoint, getLocationDisplayName, refreshAddresses,

        // Wallet Balance
        walletBalance, setWalletBalance, fetchWalletBalance,

        // Orders
        orders, setOrders,
        selectedOrder, setSelectedOrder,
        selectedCampaignId, setSelectedCampaignId,
        selectedPromotionId, setSelectedPromotionId,
        activeRider,
        returnPickupOtp,
        placeOrder,
        placeUnifiedOrder,
        initiateOnlinePayment,
        cancelOrder,
        fetchOrders,
        ordersLoading,
        subscriptions, subscriptionsLoading, subscriptionsError, fetchSubscriptions,
        selectedSubscription, setSelectedSubscription, fetchSubscriptionById,
        cartChannel,
        switchCartChannel,
        cartSummary,
        cartLoading,
        refreshCart,
        setCartItemQty,
        deleteCartItem,
        getCdsDiscount,
        getCartWarnings,

        // Subscription
        subscriptionStep, setSubscriptionStep,

        // Wishlist
        wishlist, toggleWishlist, isWishlisted, getWishlistItems, wishlistLoading, refreshWishlist,
        addToWishlist, removeFromWishlist,

        // Notifications
        notifications, setNotifications,
        markAllNotificationsRead, getUnreadCount,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};
