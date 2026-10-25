import { rememberCommittedCheckout } from '../../../utils/committedCheckout';
import { readProductRoute, wholesaleDetailProduct } from '../utils/productRoute';
import { readBrowsingLocation, saveBrowsingLocation, shouldPromptForLocation, rememberLocationChoice, validPoint, revokeBrowsingGps } from '../../../utils/locationState';
import { boundedFetch, portalRequest } from '../../../utils/portalRequests';
import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { apiUrl } from '../../../utils/api';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';
import { initPushNotifications, deregisterPushToken } from '../../../utils/firebaseMessaging';
import { openRazorpayCheckout } from '../../../utils/razorpayCheckout';
import { saveUserSession, clearUserSession, openSessionDashboard, captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
import { CustomerSessionContext } from '../../../utils/customerSession';
import { normalizeProduct } from '../hooks/useProducts';
import CouponSuccessCelebration from '../components/CouponSuccessCelebration';

const UserContext = createContext();

// Default saved addresses
// Generate a unique order ID
const genOrderId = () => 'NHC' + Date.now().toString().slice(-6);
const couponCartSignature = (channel, items = []) => `${channel}:${JSON.stringify(items.map(item => [
  item.productId, item.variantId, item.qty, item.price, item.sellerId,
  item.categoryId || item.category, item.type, item.fulfillmentType, item.deliveryMode,
]))}`;

export const UserProvider = ({ children }) => {
  const restoredSession = useContext(CustomerSessionContext);
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
    // `/electronics` is a shared sub-nav slug in both modes. The remembered
    // storefront disambiguates it on refresh; without one, default to Quick.
    coupons: 'quick',
    garments: 'quick',
  };

  const getModeFromPath = () => {
    const parts = window.location.pathname.split('/').filter(Boolean);
    // The root URL is shared by both storefronts. Let the remembered mode
    // choose its theme/catalogue on refresh; a first-time visitor still
    // defaults to Quick in resolveMode().
    if (parts.length === 0) return null;
    if (parts[0].startsWith('grocery--')) return 'quick';
    if (parts[0].startsWith('ecommerce--')) return 'shop-all';
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
    if (['categories', 'orders', 'ebooks', 'account', 'profile', 'cart', 'checkout', 'wishlist', 'search', 'wholesale', 'services', 'legal-services', 'parcel-delivery'].includes(firstPart)) {
      if (firstPart === 'profile') return 'account';
      return firstPart;
    }
    return 'home';
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

  const currentModeFromPath = resolveMode();
  const [activeSubNav, setActiveSubNavState] = useState(() => getSubNavFromPath(currentModeFromPath));


  // Sync nav/mode/subNav to the URL — but only inside an effect, never during
  // render. Calling setState during render causes React to immediately re-render
  // the provider, destabilizes downstream useCallback dependencies, and is the
  // root of the "Maximum update depth exceeded" loop in this context.
  const pathMode = getModeFromPath();
  const currentMode = pathMode || activeMode;
  const currentNav = getNavFromPath();
  const currentSubNav = getSubNavFromPath(currentMode);
  useEffect(() => {
    if (pathMode && activeMode !== pathMode) setActiveModeState(pathMode);
  }, [pathMode, activeMode]);
  useEffect(() => {
    if (activeNav !== currentNav) setActiveNavState(currentNav);
  }, [currentNav, activeNav]);
  useEffect(() => {
    if (activeSubNav !== currentSubNav) setActiveSubNavState(currentSubNav);
  }, [currentSubNav, activeSubNav]);


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
    const newPath = navId === 'home' ? '/' : `/${navId}`;
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
    setActiveNavState(navId);
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
  const [imageSearchRequest, setImageSearchRequest] = useState(0);
  const openImageSearch = () => { setImageSearchRequest(value => value + 1); setActiveNav('search'); };

  const setSelectedCategoryFilter = (category) => {
    setSelectedCategoryFilterState(category);
    if (category?.slug) {
      const slug = category.slug;
      const newPath = `/categories/${slug}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState(null, '', newPath);
      }
    } else {
      if (window.location.pathname !== '/categories') {
        window.history.pushState(null, '', '/categories');
      }
    }
    setActiveNavState('categories');
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
    if (restoredSession) return restoredSession.verified ? restoredSession.profile : null;
    try {
      const token = localStorage.getItem('userToken');
      const saved = localStorage.getItem('userProfile');
      if (!token || !saved) {
        if (!token) localStorage.removeItem('userProfile');
        return null;
      }
      return JSON.parse(saved);
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
    return readBrowsingLocation()?.label || 'Set your location';
  });
  const [showLocationModal, setLocationModalOpen] = useState(() => {
    return window.location.pathname === '/' && shouldPromptForLocation();
  });
  const setShowLocationModal = value => {
    if (!value) rememberLocationChoice('dismissed');
    setLocationModalOpen(value);
  };
  useEffect(() => {
    let active = true, permission;
    localStorage.removeItem('guestLocationCoords'); // Retire untimestamped, permanent guest GPS cache.
    // Querying permission never invokes a browser prompt or requests GPS.
    navigator.permissions?.query({ name: 'geolocation' }).then(result => {
      if (!active) return;
      permission = result;
      const changed = () => {
        if (result.state === 'denied') {
          const wasGps = readBrowsingLocation()?.source === 'gps';
          revokeBrowsingGps(); rememberLocationChoice('denied'); if (wasGps) setLocation('Set your location');
        }
      };
      changed(); result.onchange = changed;
    }).catch(() => {});
    return () => { active = false; if (permission) permission.onchange = null; };
  }, []);

  // --- Product Detail ---
  const [selectedProduct, setSelectedProductState] = useState(null);
  // The URL owns the initial route, including the first paint before effects run.
  const [productDetailLoading, setProductDetailLoading] = useState(() => readProductRoute().present);
  const [productDetailError, setProductDetailError] = useState('');
  const productDetailRequest = useRef(null);
  const restoredProduct = useRef(null);
  const [productDetailRetry, setProductDetailRetry] = useState(0);
  const retryProductDetail = useCallback(() => setProductDetailRetry(value => value + 1), []);
  const setSelectedProduct = useCallback(product => {
    productDetailRequest.current?.abort();
    productDetailRequest.current = null;
    restoredProduct.current = product;
    setSelectedProductState(product); setProductDetailError(''); setProductDetailLoading(false);
    const params = new URLSearchParams(window.location.search);
    const pathname = readProductRoute().wholesalePath ? '/wholesale' : window.location.pathname;
    if (product?.id) params.set('product', product.id); else params.delete('product');
    params.delete('purchase'); params.delete('variant');
    window.history.replaceState(null, '', `${pathname}${params.size ? `?${params}` : ''}${window.location.hash || ''}`);
  }, []);
  useEffect(() => {
    let controller;
    let requestRoute;
    const restore = () => {
      const params = new URLSearchParams(window.location.search);
      const {id,variant,mode,present} = readProductRoute();
      const session = captureUserSession();
      const route = JSON.stringify([id, variant, mode, session.token]);
      // App observes push/replaceState as well as popstate. Repeated events for
      // a pending route must not cancel and restart the same request.
      if (controller && !controller.signal.aborted && requestRoute === route && productDetailRequest.current === controller) return;
      controller?.abort();
      productDetailRequest.current?.abort();
      productDetailRequest.current = null;
      if (!present) { restoredProduct.current = null; setSelectedProductState(null); setProductDetailLoading(false); setProductDetailError(''); return; }
      if (!/^[a-f0-9]{24}$/i.test(id)) { setSelectedProductState(null); setProductDetailLoading(false); setProductDetailError('Invalid product link.'); return; }
      const validateVariant = product => {
        if (variant !== null && !(product.variants || []).some(item => String(item._id || item.id) === variant)) throw new Error('This variant is unavailable. Return to the storefront and select the product again.');
      };
      // History changes to the variant do not invalidate essential product data.
      if (restoredProduct.current?.id === id && (restoredProduct.current.detailSource === 'wholesale') === (mode === 'wholesale') && (mode !== 'wholesale' || restoredProduct.current.detailSession === session.token)) {
        try { validateVariant(restoredProduct.current); setSelectedProductState(restoredProduct.current); setProductDetailError(''); }
        catch (error) { setSelectedProductState(null); setProductDetailError(error.message); }
        setProductDetailLoading(false);
        return;
      }
      controller = new AbortController();
      requestRoute = route;
      productDetailRequest.current = controller;
      const signal = controller.signal;
      const request = controller;
      const isCurrent = () => {
        if (signal.aborted || productDetailRequest.current !== request) return false;
        const current = readProductRoute();
        return current.id === id && current.variant === variant && current.mode === mode && (mode !== 'wholesale' || isCurrentUserSession(session));
      };
      setSelectedProductState(null); setProductDetailLoading(true); setProductDetailError('');
      boundedFetch(apiUrl(mode === 'wholesale' ? `/api/products/wholesale/catalog?productId=${id}` : `/api/products/${id}`), { signal, ...(mode === 'wholesale' ? {cache:'no-store'} : {}) }).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'This product could not be loaded.');
        const product = mode === 'wholesale' ? (body.data?.[0] ? {...wholesaleDetailProduct(body.data[0]),detailSession:session.token} : null) : body?.data ?? body;
        if (!product || String(product._id) !== id || !product.name) throw new Error('Product not found. Return to the storefront to choose another product.');
        validateVariant(product);
        if (isCurrent()) { restoredProduct.current = {...normalizeProduct(product),detailSession:product.detailSession}; setSelectedProductState(restoredProduct.current); }
      }).catch(error => { if (isCurrent()) setProductDetailError(error.message); })
        .finally(() => { if (isCurrent()) setProductDetailLoading(false); });
    };
    restore(); window.addEventListener('popstate', restore); window.addEventListener('app:locationchange', restore);
    return () => { controller?.abort(); window.removeEventListener('popstate', restore); window.removeEventListener('app:locationchange', restore); };
  }, [productDetailRetry, currentUser?._id, currentUser?.id]);




  // --- Coupon ---
  const [couponCode, setCouponCode] = useState('');
  const activeCouponCode = useRef(couponCode);
  activeCouponCode.current = couponCode;
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [appliedCoupon, setAppliedCoupon] = useState(null); // { code, discount }
  const [couponCelebration, setCouponCelebration] = useState(null);
  const [couponNotice, setCouponNotice] = useState('');
  const couponEventId = useRef(0);
  const couponApplying = useRef(false);
  const suppressedAuto = useRef(null);
  const offersRequest = useRef(0);

  // --- Addresses ---
  const [savedAddresses, setSavedAddresses] = useState([]);
  const [selectedAddressId, setSelectedAddressId] = useState('addr1');

  // --- Wallet Balance ---
  const [walletBalance, setWalletBalance] = useState(0);

  const fetchWalletBalance = useCallback(async () => {
    if (!isSignedIn()) { setWalletBalance(0); return; }
    try {
      const res = await portalRequest('customer', localStorage.getItem('userToken'), '/api/wallet');
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

  // --- Socket IO connections and events ---
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    const profile = localStorage.getItem('userProfile');
    if ((!restoredSession || restoredSession.verified) && token && profile) {
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
    const snapshot = captureUserSession();
    try {
      const response = await fetch(apiUrl('/api/auth/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, isLogin, name, email }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'OTP verification failed');
      }
      if (!isCurrentUserSession(snapshot)) throw new Error('Your session changed. Please sign in again.');
      saveUserSession(data);
      openSessionDashboard(data.sessionRole);
      if (data.sessionRole === 'buyer') {
        try {
          const parcelReturn = sessionStorage.getItem('bulkimart:parcel-return');
          sessionStorage.removeItem('bulkimart:parcel-return');
          if (/^\/parcel-delivery(?:\/(?:book|history|track\/[a-f0-9]{24}))?\/?$/i.test(parcelReturn || '')) {
            window.history.replaceState(null, '', parcelReturn);
            window.dispatchEvent(new Event('popstate'));
          }
        } catch { /* A missing return intent does not block sign-in. */ }
        try {
          const destination = JSON.parse(sessionStorage.getItem('bulkimart:product-return') || 'null');
          sessionStorage.removeItem('bulkimart:product-return');
          if (destination && /^[a-f0-9]{24}$/i.test(destination.productId) && /^\/(?:grocery--[a-z0-9-]+|ecommerce--[a-z0-9-]+|smart-buy|search|categories|groceries|wholesale(?:\/[a-f0-9]{24})?|)$/.test(destination.path)) {
            const params = new URLSearchParams({ product: destination.productId, purchase: 'wholesale' });
            if (/^[a-f0-9]{24}$/i.test(destination.variantId)) params.set('variant', destination.variantId);
            window.history.replaceState(null, '', `${destination.path}?${params}`);
            window.dispatchEvent(new Event('popstate'));
          }
        } catch { /* A missing or malformed return intent does not block login. */ }
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

  const updateUserProfile = async (name, email) => {
    try {
      const token = localStorage.getItem('userToken');
      const response = await fetch(apiUrl('/api/users/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name, email }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || 'Profile update failed');
      }
      if (token !== localStorage.getItem('userToken')) return { success: false, message: 'Your session changed. Please sign in again.' };
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

  const fetchProfile = useCallback(async () => {
    if (restoredSession && !restoredSession.verified) return;
    const token = localStorage.getItem('userToken');
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/users/profile'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (token !== localStorage.getItem('userToken')) return;
      if (data.user) {
        const currentProfile = JSON.parse(localStorage.getItem('userProfile') || '{}');
        const updatedProfile = { ...currentProfile, ...data.user };
        localStorage.setItem('userProfile', JSON.stringify(updatedProfile));
        setCurrentUser(updatedProfile);
      }
    } catch {}
  }, []);

  useEffect(() => {
    // /auth/me already returns the verified full profile; avoid a second
    // startup profile lookup. Explicit profile refresh remains available.
    if (!restoredSession) fetchProfile();
  }, [fetchProfile]);

  const logoutUser = () => {
    deregisterPushToken().catch(() => {});
    clearUserSession();
    setCurrentUser(null);
    setActiveNav('home');
    disconnectSocket();
    setWishlist(new Set());
    setWishlistItems([]);
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

  const checkoutHeaders = (operation, payload) => {
    const storageKey = `bulkimart:checkout:${operation}:${currentUser?._id || currentUser?.id || 'customer'}`;
    const fingerprint = JSON.stringify(payload);
    let saved;
    try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { saved = null; }
    if (!saved || saved.fingerprint !== fingerprint || !saved.key) {
      const key = globalThis.crypto?.randomUUID?.()
        || `bm-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      saved = { fingerprint, key };
      try { sessionStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* API still enforces uniqueness for this request. */ }
    }
    return { ...authHeaders(), 'Idempotency-Key': saved.key };
  };

  const clearCheckoutKey = (operation) => {
    const storageKey = `bulkimart:checkout:${operation}:${currentUser?._id || currentUser?.id || 'customer'}`;
    try { sessionStorage.removeItem(storageKey); } catch { /* storage may be unavailable */ }
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
  const [cartSummaryReady, setCartSummaryReady] = useState(false);
  const cartRequest = useRef(0);

  /**
   * "Use Coins" is intent only — the server decides everything else
   * (eligibility, max redemption, actual discount; see serverCart.coins,
   * populated by GET /api/cart). This flag just controls whether the next
   * cart fetch asks the server to apply the discount or not; it is never
   * itself the discount amount.
   */
  const [useCoinsSelected, setUseCoinsSelected] = useState(false);

  const isSignedIn = () => (!restoredSession || restoredSession.verified) && Boolean(localStorage.getItem('userToken'));

  const refreshCartSummary = useCallback(async () => {
    if (!isSignedIn()) { setCartSummary({}); setCartSummaryReady(false); return; }
    const session = captureUserSession();
    try {
      const res = await fetch(apiUrl('/api/cart/summary'), { headers: authHeaders(false) });
      if (!res.ok) return;
      const body = await res.json();
      if (isCurrentUserSession(session)) setCartSummary(body.data || {});
    } catch { /* badges are non-critical */ }
    finally { setCartSummaryReady(true); }
  }, [currentUser?._id, restoredSession?.verified]);

  useEffect(() => {
    window.addEventListener('cart:changed', refreshCartSummary);
    return () => window.removeEventListener('cart:changed', refreshCartSummary);
  }, [refreshCartSummary]);

  // Keep the latest refreshCartSummary in a ref so refreshCart can always call
  // the current version without listing it as a useCallback dependency. Adding
  // a useCallback to another useCallback's dep array recreates the outer one
  // every time the inner one rebuilds — which is what was driving the loop.
  const refreshCartSummaryRef = useRef(refreshCartSummary);
  useEffect(() => { refreshCartSummaryRef.current = refreshCartSummary; }, [refreshCartSummary]);

  const refreshCart = useCallback(async (channel, coupon, mode) => {
    const request = ++cartRequest.current;
    const ch = channel || cartChannel;
    const cp = coupon !== undefined ? coupon : couponCode;
    // An explicit mode wins, so a freshly picked one is priced immediately
    // rather than a render later.
    const wantMode = mode !== undefined ? mode : deliveryMode;
    if (!isSignedIn()) { setServerCart({ ...EMPTY_CART, channel: ch }); return null; }

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
      // The aggregate cart presents unavailable lines for explicit review/removal.
      if (['/cart', '/checkout', '/wholesale/cart'].includes(window.location.pathname)) qs.set('preserveUnavailable', 'true');
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
        // Only update when the server reports a mode that differs from what we
        // sent. An unconditional setter recreates the refreshCart useCallback
        // (deliveryMode is a dep), fires the useEffect, and starts another fetch
        // — producing the infinite "Updating…" loop visible on the checkout CTA.
        if (itemMode && itemMode !== wantMode) {
          setDeliveryModeState(itemMode);
        }
      }
      return cartData;
    } catch {
      if (request === cartRequest.current) setServerCart({ ...EMPTY_CART, channel: ch });
      return null;
    } finally {
      if (request === cartRequest.current) {
        setCartLoading(false);
        refreshCartSummaryRef.current();
      }
    }
    // getDeliveryPoint reads the saved-address list, which changes rarely and
    // never during a re-price; leaving it out keeps this from re-running on
    // every address edit while the customer is mid-checkout.
    // refreshCartSummary is held in a ref (above) rather than listed here:
    // adding a useCallback to another's dep array rebuilds the outer one
    // every time the inner rebuilds, which was the original loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartChannel, couponCode, deliveryMode, selectedAddressId, useCoinsSelected]);

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
    setCartChannel(channel);
    setAvailableCoupons([]);
    setDeliveryModeState(null);
    // Follow storefront changes only. Checkout can select another basket
    // without changing the storefront; reacting to cartChannel undoes that
    // selection and makes the two effects switch channels indefinitely.
  }, [activeMode]);

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
  const addToCart = async (productOrId, qty = 1, variantId) => {
    let product = productOrId && typeof productOrId === 'object' ? productOrId : null;
    const productId = product?.id || product?._id || productOrId;
    let variants = product?.variants || product?.raw?.variants || [];
    // Resolve the live detail record before choosing a variant. Legacy product
    // rows can acquire their durable variant IDs on this endpoint, while a
    // listing already open in the browser may still carry the old transient ID.
    // In particular, the detail page calls this function with only a product
    // ID, so limiting this lookup to compact product objects left that path
    // sending a stale variant identifier to the cart API.
    try {
      const response = await fetch(apiUrl(`/api/products/${productId}`));
      const detail = await response.json();
      if (response.ok && Array.isArray(detail?.variants)) {
        const liveVariants = detail.variants.map((variant) => ({ ...variant, id: String(variant._id) }));
        // A single variant is unambiguous, so prefer its live ID even when the
        // caller supplied an older one. Multiple variants must keep the exact
        // shopper selection and are still validated by the server.
        if (liveVariants.length === 1) variantId = liveVariants[0].id;
        variants = liveVariants;
        product = { ...(product || {}), id: String(productId), _id: String(productId), variants, raw: detail };
      }
    } catch { /* The cart API remains authoritative if detail lookup is unavailable. */ }
    if (!variantId && variants.length > 1) {
      setSelectedProduct(product);
      return { ok: false, message: 'Choose a product variant to add it to your cart.' };
    }
    const resolvedVariantId = variantId || (variants.length === 1 ? (variants[0].id || variants[0]._id) : undefined);
    const r = await cartCall('POST', '', { productId, qty, ...(resolvedVariantId ? { variantId: resolvedVariantId } : {}) });
    if (r.ok && r.data?.channel !== cartChannel) {
      // it went into the other storefront's basket; keep both views honest
      refreshCart();
    }
    return { ...r, variantId: resolvedVariantId };
  };

  const setCartItemQty = async (itemId, qty) => cartCall('PUT', `/${itemId}`, { qty });
  const deleteCartItem = async (itemId) => cartCall('DELETE', `/${itemId}`);
  const clearCart = async () => cartCall('DELETE', `?channel=${cartChannel}`);

  /** Decrease by one; the server removes the line when it reaches zero. */
  const removeFromCart = async (itemId, currentQty) =>
    setCartItemQty(itemId, Math.max(0, Number(currentQty || 1) - 1));

  const switchCartChannel = useCallback((channel) => {
    if (!['grocery', 'ecommerce'].includes(channel) || channel === cartChannel) return;
    setDeliveryModeState(null);
    setAvailableCoupons([]);
    setCartChannel(channel);
    // The refreshCart effect fetches once with the new channel and mode.
  }, [cartChannel]);

  // ---- read helpers the pages already use --------------------------------
  const getCartItems = () => serverCart.items || [];
  const getCartCount = () => Object.keys(cartSummary || {}).length
    ? Object.values(cartSummary).reduce((acc, ch) => acc + (ch.count || 0), 0) : (serverCart.count || 0);
  const getCartSubtotal = () => serverCart.pricing?.subtotal || 0;
  const getDeliveryCharge = () => serverCart.pricing?.deliveryCharge || 0;
  const getCartTotal = () => serverCart.pricing?.totalAmount || 0;
  const getCartWarnings = () => serverCart.warnings || [];

  /** Quantity of one product in the current basket, 0 if it is not in there.
   *  The old cart was a { productId: qty } map that pages indexed directly;
   *  the server cart is a list, so lookups go through this instead. */
  const getItemQty = (productId, variantId = null) =>
    (serverCart.items || []).find((i) => String(i.productId) === String(productId)
      && String(i.variantId || '') === String(variantId || ''))?.qty || 0;
  const getCouponDiscount = () => serverCart.pricing?.couponDiscount || 0;
  // There is no platform fee on the server; the cart used to invent a flat ₹5,
  // which meant the displayed total never matched what was actually charged.
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
    if (couponApplying.current || couponCode === clean && appliedCoupon?.code === clean) return { success: false, message: 'Coupon already applied.' };
    couponApplying.current = true;

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

      const priced = await refreshCart(cartChannel, clean);
      if (!priced?.appliedCoupon || priced.appliedCoupon.code !== clean || priced.couponError) {
        return { success: false, message: priced?.couponError || 'The coupon could not be applied to the current cart.' };
      }
      setCouponCode(clean);
      setAppliedCoupon(priced.appliedCoupon);
      setCouponNotice('');
      suppressedAuto.current = null;
      const savings = Number(priced.couponSavings) || 0;
      setCouponCelebration({ id: ++couponEventId.current, code: clean, savings });
      return {
        success: true,
        message: `"${clean}" applied — you save ₹${savings.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      };
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


  /** Offers this shopper can use right now, each with a reason if they cannot. */
  const fetchAvailableCoupons = useCallback(async () => {
    const request = ++offersRequest.current;
    if (!isSignedIn()) { setAvailableCoupons([]); return []; }
    try {
      const res = await fetch(apiUrl(`/api/coupons/available?channel=${cartChannel}`), {
        headers: authHeaders(false),
      });
      if (!res.ok) { if (request === offersRequest.current) setAvailableCoupons([]); return []; }
      const body = await res.json();
      const offers = body.data || [];
      if (request === offersRequest.current) setAvailableCoupons(offers);
      return request === offersRequest.current ? offers : [];
    } catch {
      if (request === offersRequest.current) setAvailableCoupons([]);
      return [];
    }
  }, [cartChannel]);

  const offerCartSignature = couponCartSignature(cartChannel, serverCart.items);
  const offerSummarySignature = Object.entries(cartSummary).map(([channel, summary]) => `${channel}:${summary.lines}`).sort().join('|');
  const couponView = ['cart', 'checkout'].includes(activeNav) ? activeNav : '';
  useEffect(() => {
    if (!serverCart.items?.length || !isSignedIn()) { setAvailableCoupons([]); return; }
    if (!cartSummaryReady) return;
    void fetchAvailableCoupons();
  }, [offerCartSignature, offerSummarySignature, cartSummaryReady, couponView, currentUser?._id, currentUser?.id, fetchAvailableCoupons]);

  useEffect(() => {
    if (!cartSummaryReady || !serverCart.items?.length || !isSignedIn() || activeCouponCode.current || couponApplying.current || suppressedAuto.current === offerCartSignature) return;
    // A coupon is one order's benefit. Grouped and wholesale baskets cannot
    // redeem it, so do not offer an automatic discount they cannot check out.
    const nonempty = Object.entries(cartSummary).filter(([, summary]) => summary.lines > 0);
    if (nonempty.length !== 1 || nonempty[0][0] !== cartChannel) return;
    const items = serverCart.items || [];
    if (new Set(items.map(item => String(item.sellerId))).size !== 1 ||
        new Set(items.map(item => item.deliveryMode || '')).size !== 1 ||
        new Set(items.map(item => item.fulfillmentType || 'physical')).size !== 1) return;
    // Preserve the backend's quoted-saving/minimum/code ordering. Membership
    // cannot yet be verified by the existing evaluator, so fail closed for it.
    const selected = availableCoupons.find(offer => offer.applicable && !offer.cdsMembersOnly);
    if (selected) applyCoupon(selected.code);
  }, [availableCoupons, offerCartSignature, offerSummarySignature, cartSummaryReady, couponView, currentUser?._id, currentUser?.id]);



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
      const res = await portalRequest('customer', localStorage.getItem('userToken'), '/api/users/addresses');
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
    const profileName = (currentUser?.name || '').trim();
    const profilePhone = (currentUser?.phone || '').trim();
    const recipientName = profileName || (address?.name && String(address.name).trim()) || '';
    const recipientPhone = profilePhone || (address?.phone && String(address.phone).trim()) || '';

    if (!recipientName) {
      return { ok: false, message: 'Please complete your profile name before adding a delivery address.' };
    }
    if (!recipientPhone) {
      return { ok: false, message: 'Please complete your profile mobile number before adding a delivery address.' };
    }

    const payload = {
      ...address,
      name: recipientName,
      phone: recipientPhone,
    };

    try {
      const res = await fetch(apiUrl('/api/users/addresses'), {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save the address' };
      await refreshAddresses();
      const addressId = body.data?.addressId;
      if (addressId) setSelectedAddressId(String(addressId));
      return { ok: true, addressId, duplicate: Boolean(body.data?.duplicate), message: body.message || 'Address saved' };
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
      const profileName = (currentUser?.name || '').trim();
      const profilePhone = (currentUser?.phone || '').trim();
      const payload = {
        ...data,
        ...(profileName ? { name: profileName } : {}),
        ...(profilePhone ? { phone: profilePhone } : {}),
      };
      const res = await fetch(apiUrl(`/api/users/addresses/${id}`), {
        method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
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
    const session = captureUserSession();
    if (!validPoint(coords)) return { ok: false, message: 'Invalid coordinates. Enter your location manually.' };
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
      saveBrowsingLocation(label, coords, source);
      return { ok: true, label, resolved: {} };
    }

    // Our own lookup, not a second geocoder called from the browser. It is
    // cached and rate limited server-side, so the same spot is not billed twice.
    let resolved = {};
    try {
      const res = await boundedFetch(apiUrl(`/api/geo/reverse?lat=${coords.lat}&lng=${coords.lng}${coords.accuracy ? `&accuracy=${Math.round(coords.accuracy)}` : ''}`), {
        headers: authHeaders(false),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) resolved = body.data || {};
    } catch { /* the pin is still worth saving without a street name */ }

    if (!isCurrentUserSession(session)) return { ok: false, message: 'Your session changed. Please select the location again.' };
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
        ? await boundedFetch(apiUrl(`/api/users/addresses/${existing._id}`), {
          method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload),
        })
        : await boundedFetch(apiUrl('/api/users/addresses'), {
          method: 'POST', headers: authHeaders(), body: JSON.stringify(payload),
        });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save your location' };

      if (!isCurrentUserSession(session)) return { ok: false, message: 'Your session changed. Select your location again.' };
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
    const session = captureUserSession();
    // Same guest gap as saveDeliveryLocation above: /api/geo/forward also
    // requires auth. A guest's typed text is saved as-is, as a label with
    // no resolved coordinates — honest about what it is, rather than
    // failing the whole "enter manually" fallback for anyone not signed in.
    if (!isSignedIn()) {
      setLocation(text);
      saveBrowsingLocation(text, null, 'manual');
      return { ok: true, label: text, resolved: {} };
    }

    try {
      const res = await boundedFetch(apiUrl(`/api/geo/forward?q=${encodeURIComponent(text)}`), {
        headers: authHeaders(false),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'We could not find that place' };

      if (!isCurrentUserSession(session)) return { ok: false, message: 'Your session changed. Enter the location again.' };
      return saveDeliveryLocation({ lat: body.data.lat, lng: body.data.lng }, 'manual');
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  const setDefaultAddress = async (id) => {
    const session = captureUserSession();
    try {
      const response = await boundedFetch(apiUrl(`/api/users/addresses/${id}/default`), {
        method: 'PUT', headers: authHeaders(false),
      });
      if (!response.ok) return { ok: false, message: 'Could not select the address. Please retry.' };
      if (!isCurrentUserSession(session)) return { ok: false, message: 'Your session changed.' };
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
    if (!addr || addr.lat === undefined || addr.lng === undefined) return readBrowsingLocation()?.coords || null;
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



  /**
   * Place the order for the storefront currently being viewed.
   * Totals are recalculated server-side from live prices, so what is charged
   * always matches what the cart showed.
   */
  const placeOrder = async (paymentMethod = 'Cash on Delivery', tipAmount = 0) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to place an order.' };
    if ((serverCart.items || []).length === 0) return { ok: false, message: 'Your cart is empty.' };

    const digitalItems = serverCart.items.filter((item) => item.fulfillmentType === 'digital');
    if (digitalItems.length > 0) {
      if (digitalItems.length !== serverCart.items.length) {
        return { ok: false, message: 'Digital and physical items require separate checkout. Remove one type and check out each group separately.' };
      }
      if (paymentMethod !== 'Online Payment') {
        return { ok: false, message: 'E-books can only be purchased using Razorpay.' };
      }
      try {
        const checkoutSession = captureUserSession();
        const checkoutPayload = { paymentMethod: 'online', coupon: couponCode || undefined };
        const requestHeaders = checkoutHeaders('digital', checkoutPayload);
        const res = await fetch(apiUrl('/api/digital/checkout'), {
          method: 'POST', headers: requestHeaders, body: JSON.stringify(checkoutPayload),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, message: body.message || 'Could not create the e-book order' };
        if (!body.data?.order?._id || !body.data?.payment?.id) throw new Error('Unconfirmed checkout response');
        if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
        rememberCommittedCheckout(currentUser?._id || currentUser?.id, 'digital', requestHeaders['Idempotency-Key']);
        clearCheckoutKey('digital');
        setCouponCode('');
        setAppliedCoupon(null);
        await Promise.all([refreshCart(cartChannel, ''), fetchOrders()]);
        return { ok: true, checkoutKey: requestHeaders['Idempotency-Key'], order: body.data.order, payment: body.data.payment, message: body.message };
      } catch (err) {
        return { ok: false, message: err.message };
      }
    }

    const addr = getSelectedAddress();
    if (!addr) return { ok: false, message: 'Please add a delivery address first.' };

    const resolvedName = (addr.name != null ? String(addr.name).trim() : '') || (currentUser?.name != null ? String(currentUser.name).trim() : '') || '';
    const resolvedPhone = (addr.phone != null ? String(addr.phone).trim() : '') || (currentUser?.phone != null ? String(currentUser.phone).trim() : '') || '';

    // Validate required address and recipient fields
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
        useCoins: useCoinsSelected,
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
      const res = await fetch(apiUrl('/api/orders'), {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(checkoutPayload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, operation: 'single', status: res.status, code: body.meta?.code, requestId: body.meta?.requestId, message: body.message || 'Could not place your order' };
      // A proxy can return a successful status with an unreadable/truncated
      // body. Retain the key until the persisted result is actually confirmed.
      if (!body.data?.order?._id || !body.data?.payment?.id) throw new Error('Unconfirmed checkout response');

      if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
      if (checkoutPayload.paymentMethod === 'online') rememberCommittedCheckout(currentUser?._id || currentUser?.id, 'single', requestHeaders['Idempotency-Key']);
      clearCheckoutKey('single');
      setCouponCode('');
      setAppliedCoupon(null);
      setUseCoinsSelected(false);
      await Promise.allSettled([refreshCart(cartChannel, ''), fetchOrders(), fetchWalletBalance()]);
      if (!isCurrentUserSession(checkoutSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
      return { ok: true, checkoutKey: requestHeaders['Idempotency-Key'], order: body.data.order, coinsUsed: body.data.coinsUsed, coinDiscount: body.data.coinDiscount, message: body.message };
    } catch (err) {
      return { ok: false, operation: 'single', code: 'CHECKOUT_OUTCOME_UNCERTAIN', message: 'We could not confirm the checkout result. Check its status before trying again.' };
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
  const placeUnifiedOrder = async (paymentMethod = 'Cash on Delivery', tipAmount = 0, options = {}) => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to place an order.' };
    const wholesaleSession = captureUserSession();

    const addr = getSelectedAddress();
    if (!addr) return { ok: false, message: 'Please add a delivery address first.' };
    const resolvedName = (addr.name != null ? String(addr.name).trim() : '') || (currentUser?.name != null ? String(currentUser.name).trim() : '') || '';
    const resolvedPhone = (addr.phone != null ? String(addr.phone).trim() : '') || (currentUser?.phone != null ? String(currentUser.phone).trim() : '') || '';

    if (!resolvedName) return { ok: false, message: 'Your profile is missing a name. Please complete your profile.' };
    if (!resolvedPhone) return { ok: false, message: 'Your profile is missing a mobile number. Please complete your profile.' };
    if (!addr.line1 && !addr.address) return { ok: false, message: 'Your saved address is missing the address line.' };
    if (!addr.city) return { ok: false, message: 'Your saved address is missing a city.' };
    if (!addr.pincode) return { ok: false, message: 'Your saved address is missing a pincode.' };

    try {
      const checkoutPayload = {
        ...(['wholesale', 'basket'].includes(options.purchaseMode) ? { purchaseMode: options.purchaseMode, quoteHash: options.quoteHash, ...(options.purchaseMode === 'basket' ? { basketHash: options.basketHash } : {}) } : {}),
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
      const requestHeaders = checkoutHeaders(['wholesale', 'basket'].includes(options.purchaseMode) ? options.purchaseMode : 'unified', checkoutPayload);
      const res = await fetch(apiUrl('/api/orders/unified'), {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(checkoutPayload),
      });
      const body = await res.json().catch(() => ({}));
      if (wholesaleSession && !isCurrentUserSession(wholesaleSession)) return { ok: false, message: 'Your customer session changed. Sign in again to view your order.' };
      if (!res.ok) return { ok: false, operation: 'unified', status: res.status, code: body.meta?.code, requestId: body.meta?.requestId, message: body.message || 'Could not place your order' };
      if (!body.data?.orders?.length || body.data.orders.some(order => !order?._id) || !body.data?.payment?.id) throw new Error('Unconfirmed checkout response');

      if (checkoutPayload.paymentMethod === 'online') rememberCommittedCheckout(currentUser?._id || currentUser?.id, 'unified', requestHeaders['Idempotency-Key']);
      clearCheckoutKey(['wholesale', 'basket'].includes(options.purchaseMode) ? options.purchaseMode : 'unified');
      window.dispatchEvent(new Event('cart:changed'));
      await Promise.allSettled([refreshCart(cartChannel, ''), fetchOrders()]);
      if (!isCurrentUserSession(wholesaleSession)) return { ok: false, message: 'Your customer session changed. Sign in again to review your order.' };
      return {
        ok: true,
        checkoutKey: requestHeaders['Idempotency-Key'],
        orders: body.data.orders,
        groupRef: body.data.groupRef,
        payment: body.data.payment,
        message: body.message,
      };
    } catch (err) {
      return { ok: false, operation: 'unified', code: 'CHECKOUT_OUTCOME_UNCERTAIN', message: 'We could not confirm the checkout result. Check its status before trying again.' };
    }
  };

  const checkCheckoutStatus = async (operation = 'single') => {
    if (!isSignedIn()) return { ok: false, message: 'Please sign in to check your order.' };
    try {
      const storageKey = `bulkimart:checkout:${operation}:${currentUser?._id || currentUser?.id || 'customer'}`;
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
      if (!saved?.key) return { ok: false, message: 'The checkout session is unavailable. Review My Orders or contact support before ordering again.' };
      const res = await fetch(apiUrl('/api/orders/checkout-status'), { method: 'POST', headers: { ...authHeaders(), 'Idempotency-Key': saved.key }, body: JSON.stringify({ operation: ['wholesale', 'basket'].includes(operation) ? 'unified' : operation }) });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok, data: body.data, message: body.message || 'Could not check your order status.' };
    } catch { return { ok: false, message: 'Could not check your order status. Please retry the status check.' }; }
  };

  /** Start the server-selected gateway. Only backend verification marks paid. */
  const initiateOnlinePayment = async (orderId) => {
    try {
      const res = await fetch(apiUrl('/api/payments/initiate'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ orderId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not start the payment' };
      if (body.data?.provider === 'razorpay') {
        return openRazorpayCheckout(body.data, authHeaders());
      }
      return { ok: true, provider: body.data?.provider, redirectUrl: body.data?.redirectUrl };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  };

  const abandonCheckoutPayment = async (orderId) => {
    try {
      const res = await fetch(apiUrl(`/api/orders/${orderId}/abandon-payment`), { method: 'POST', headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not confirm payment cancellation. Check its status before retrying.' };
      if (body.data?.cancelled) {
        window.dispatchEvent(new Event('cart:changed'));
        await Promise.allSettled([refreshCart(cartChannel, ''), fetchOrders(), fetchWalletBalance()]);
      }
      return { ok: true, ...body.data };
    } catch { return { ok: false, message: 'Could not confirm payment cancellation. Check its status before retrying.' }; }
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
      const res = await portalRequest('customer', localStorage.getItem('userToken'), '/api/wishlist');
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
        currentUser, logoutUser,
        sendOtp, verifyOtp, updateUserProfile, fetchProfile,

        // Navigation
        activeMode, setActiveMode,
        productTab, setProductTab,
        activeNav, setActiveNav,
        activeSubNav, setActiveSubNav,
        isVoiceModalOpen, setIsVoiceModalOpen, openVoiceSearch, closeVoiceSearch,
        imageSearchRequest, setImageSearchRequest, openImageSearch,
        pendingVoiceQuery, setPendingVoiceQuery,
        selectedCategoryFilter, setSelectedCategoryFilter,
        location, setLocation, saveDeliveryLocation, lookupTypedLocation,
        showLocationModal, setShowLocationModal,

        // Product Detail & Reviews
        selectedProduct, setSelectedProduct, productDetailLoading, productDetailError, retryProductDetail,
        reviewProductId, setReviewProductId,

        // Cart — server-backed, one basket per storefront
        cart: serverCart,
        serverCart, cartChannel, switchCartChannel, cartSummary, cartLoading, refreshCart,
        useCoinsSelected, toggleUseCoins,
        deliveryMode, setDeliveryMode,
        addToCart, removeFromCart, clearCart,
        setCartItemQty, deleteCartItem,
        getCartCount, getCartItems, getCartWarnings, getItemQty,
        getCartSubtotal, getDeliveryCharge, getCouponDiscount, getCartTotal,

        // Coupon
        appliedCoupon, applyCoupon, removeCoupon, couponNotice,
        // Visibility controls the manual offers/progress UI, never automatic
        // eligibility. The internal selection pool includes all active offers.
        couponCode, availableCoupons: availableCoupons.filter(offer => offer.isPublic !== false), fetchAvailableCoupons, getTotalSavings,
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
        activeRider,
        returnPickupOtp,
        placeOrder,
        placeUnifiedOrder,
        checkCheckoutStatus,
        initiateOnlinePayment,
        cancelOrder, abandonCheckoutPayment,
        fetchOrders,
        ordersLoading,
        cartChannel,
        switchCartChannel,
        cartSummary,
        cartLoading,
        refreshCart,
        setCartItemQty,
        deleteCartItem,
        getCartWarnings,

        // Wishlist
        wishlist, toggleWishlist, isWishlisted, getWishlistItems, wishlistLoading, refreshWishlist,
        addToWishlist, removeFromWishlist,

        // Notifications
        notifications, setNotifications,
        markAllNotificationsRead, getUnreadCount,
      }}
    >
      {children}
      <CouponSuccessCelebration event={couponCelebration} active={Boolean(couponView && appliedCoupon?.code === couponCelebration?.code)} />
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser must be used within a UserProvider');
  return context;
};
