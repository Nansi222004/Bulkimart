import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { apiUrl } from '../../../utils/api';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';
import { initPushNotifications, deregisterPushToken } from '../../../utils/firebaseMessaging';

import productTurmeric from '../../../assets/product_turmeric.png';
import productPickle from '../../../assets/product_pickle.png';
import productHoney from '../../../assets/product_honey.png';
import productRice from '../../../assets/product_rice.png';
import categoryPersonal from '../../../assets/category_personal.png';

const SHGContext = createContext();

export const SHGProvider = ({ children }) => {
  // ── GLOBAL UI ──────────────────────────────────────────────────────────────
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  
  // Derive active tab from URL path
  const getActiveTabFromPath = (path) => {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'shg' && segments[1]) {
      return segments[1];
    }
    return 'dashboard';
  };

  const [activeTab, setActiveTabState] = useState(() => getActiveTabFromPath(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => {
      setActiveTabState(getActiveTabFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const setActiveTab = (tabId) => {
    const targetPath = tabId === 'dashboard' ? '/shg' : `/shg/${tabId}`;
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
      setActiveTabState(tabId);
    }
  };

  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState('success'); // 'success' | 'error' | 'info'

  // ── STOREFRONT MODE ────────────────────────────────────────────────────────
  // An SHG's products always live under the `shg` category tree (that never
  // changes — see SHGProductsTab's "Category" field), but the panel itself
  // is scoped to whichever cross-listed storefront the group is managing —
  // same two choices as the Seller panel, no neutral "SHG only" view.
  const [activeMode, setActiveMode] = useState('ecommerce'); // 'ecommerce' | 'quick'
  const CHANNEL_OF_MODE = { ecommerce: 'ecommerce', quick: 'grocery' };
  const activeChannel = CHANNEL_OF_MODE[activeMode] || 'ecommerce';

  // ── ONBOARDING — OTP ───────────────────────────────────────────────────────
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpTimer, setOtpTimer] = useState(0);

  // ── ONBOARDING — AADHAAR (Group Leader) ───────────────────────────────────
  const [aadhaarVerified, setAadhaarVerified] = useState(false);
  const [aadhaarVerifying, setAadhaarVerifying] = useState(false);
  const [aadhaarNo, setAadhaarNo] = useState('');

  // ── ONBOARDING — GROUP INFO ────────────────────────────────────────────────
  const [groupForm, setGroupForm] = useState({
    groupName: '',
    leaderName: '',
    leaderDesignation: 'President',
    totalMembers: '',
    formationYear: '',
    primaryCategory: 'Organic Foods & Groceries',
    description: '',
    houseNo: '',
    street: '',
    landmark: '',
    village: '',
    block: '',
    district: '',
    state: 'Uttar Pradesh',
    pincode: '',
    lat: null,
    lng: null
  });

  // ── ONBOARDING — SHG REGISTRATION DOCS ────────────────────────────────────
  const [registrationForm, setRegistrationForm] = useState({
    shgRegId: '',          // SHG Registration ID (e.g. SHG20249876)
    nrlmId: '',            // NRLM / DAY-NRLM ID
    federationName: '',    // SHG Federation / VO name
    bankAccountNo: '',     // Group bank account
    ifscCode: '',
    bankName: '',
    bankBranch: ''
  });

  // ── ONBOARDING — DOCUMENT UPLOADS ─────────────────────────────────────────
  const [uploadedDocs, setUploadedDocs] = useState({
    leaderAadhaar: null,
    shgCertificate: null,    // SHG Registration Certificate
    nrlmCertificate: null,   // NRLM Certificate
    groupPassbook: null,     // Group Bank Passbook
    groupPhoto: null         // Group Photo
  });

  // ── ONBOARDING — APPLICATION STATUS ───────────────────────────────────────
  const [applicationId] = useState(() => 'SHG' + Math.floor(10000000 + Math.random() * 90000000));
  const [applicationDate] = useState(() =>
    new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  );

  // ── DASHBOARD PANEL STATE ─────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [activeProductTab, setActiveProductTab] = useState('All');
  const [activeOrderTab, setActiveOrderTab] = useState('All');
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [activeActionsMenuId, setActiveActionsMenuId] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);

  // ── NEW PRODUCT FORM ───────────────────────────────────────────────────────
  // Same shape as the Seller module's variant-based form (ProductModal is
  // shared between the two) — pricing/stock/unit/weight live per-variant,
  // not on the form root. `storefrontTarget` is SHG-only: which shopper-facing
  // channel(s) this listing goes out on, independent of the category (an SHG
  // group's products always sit under the SHG category tree regardless).
  const defaultProductForm = () => ({
    name: '',
    categoryId: '',
    desc: '',
    gstRate: 0,
    variants: [{ name: 'Default', price: '', mrp: '', stock: '', unit: 'piece', weight: '' }],
    storefrontTarget: activeChannel, // 'ecommerce' | 'grocery' | 'both'
    sameDayEnabled: false,
    processingMinutes: '',
  });
  const [newProductForm, setNewProductForm] = useState(defaultProductForm());
  const [savingProduct, setSavingProduct] = useState(false);
  const [productError, setProductError] = useState('');

  // A rider/customer app screen's Same-Day radius/processing ceilings — the
  // Seller module fetches these live off GET /api/sellers/me; there is no
  // SHG-scoped equivalent endpoint, so ProductModal gets the same sane
  // defaults the Seller side shows before its own fetch lands.
  const [platformLimits] = useState({ sameDayMaxRadiusKm: 20, sameDayMaxProcessingMinutes: 480 });

  /**
   * Which listing is being edited, if any — mirrors the Seller module's
   * `editingProduct`/`editingProductId` pair so the shared ProductModal can
   * treat both context sources identically.
   */
  const [editingProduct, setEditingProduct] = useState(null);
  const editingProductId = editingProduct?._id || editingProduct?.id || null;
  const setEditingProductId = (v) => { if (!v) setEditingProduct(null); };

  /** Which storefront(s) a saved listing is already live on. */
  const deriveStorefrontTarget = (raw) => {
    const hasEcom = raw.type === 'ecommerce' || (raw.channels || []).some((c) => c.type === 'ecommerce');
    const hasGrocery = raw.type === 'grocery' || (raw.channels || []).some((c) => c.type === 'grocery');
    if (hasEcom && hasGrocery) return 'both';
    return raw.type === 'ecommerce' ? 'ecommerce' : 'grocery';
  };

  /** Open the modal on an existing listing — takes the raw API product. */
  const startEditProduct = (raw) => {
    if (!raw) return;
    setEditingProduct(raw);
    setNewProductForm({
      name: raw.name || '',
      categoryId: raw.category?._id || raw.category || '',
      desc: raw.description || '',
      gstRate: raw.gstRate ?? 0,
      variants: raw.variants?.length
        ? raw.variants.map((v) => ({ ...v }))
        : [{ name: 'Default', price: raw.price ?? '', mrp: raw.mrp ?? '', stock: raw.stock ?? '', unit: raw.unit || 'piece', weight: raw.weight ?? '' }],
      storefrontTarget: deriveStorefrontTarget(raw),
      sameDayEnabled: Boolean(raw.sameDay?.enabled),
      processingMinutes: raw.sameDay?.processingMinutes ?? '',
    });
    setShowAddProductModal(true);
  };

  // Selectable leaf categories per channel, for the Add Product form's
  // dropdowns — { _id, name, path }[].
  const [shgCategories, setShgCategories] = useState([]);
  const [quickCategories, setQuickCategories] = useState([]);
  const [ecommerceCategories, setEcommerceCategories] = useState([]);

  const fetchListingCategories = async () => {
    try {
      const [shgRes, quickRes, ecomRes] = await Promise.all([
        fetch(apiUrl('/api/categories/selectable?type=shg')),
        fetch(apiUrl('/api/categories/selectable?type=grocery')),
        fetch(apiUrl('/api/categories/selectable?type=ecommerce'))
      ]);
      const [shgData, quickData, ecomData] = await Promise.all([shgRes.json(), quickRes.json(), ecomRes.json()]);
      setShgCategories(shgData.data || []);
      setQuickCategories(quickData.data || []);
      setEcommerceCategories(ecomData.data || []);
    } catch (e) {
      console.error('Error fetching listing categories:', e);
    }
  };

  // ── BUSINESS SUBSCRIPTION ─────────────────────────────────────────────────
  // Separate from admin approval: approval opens the panel, an active
  // subscription is what unlocks product/stock writes. `hasActiveSubscription`
  // is only a UX hint — the backend re-checks on every gated call and returns
  // a 403 with meta.code === 'SUBSCRIPTION_REQUIRED' if this is stale.
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [mySubscription, setMySubscription] = useState(null);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [showSubscriptionModal, setShowSubscriptionModal] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);

  const fetchSubscriptionPlans = async () => {
    try {
      const res = await fetch(apiUrl('/api/shg-subscriptions/plans'), {
        headers: { Authorization: `Bearer ${localStorage.getItem('userToken')}` },
      });
      const body = await res.json();
      if (res.ok) setSubscriptionPlans(body.data || []);
    } catch (e) {
      console.error('Error fetching subscription plans:', e);
    }
  };

  const fetchMySubscription = async () => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/shg-subscriptions/me'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (res.ok) {
        setMySubscription(body.data?.subscription || null);
        setHasActiveSubscription(Boolean(body.data?.isActive));
      }
    } catch (e) {
      console.error('Error fetching subscription:', e);
    }
  };

  const purchasePlan = async (planId) => {
    setSubscriptionLoading(true);
    try {
      const res = await fetch(apiUrl('/api/shg-subscriptions/purchase'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('userToken')}`,
        },
        body: JSON.stringify({ planId }),
      });
      const body = await res.json();
      if (res.ok && body.data?.redirectUrl) {
        // Hand off to PhonePe. The subscription only becomes active when the
        // signed webhook (or our own server-side status check) confirms the
        // money arrived — never because the browser came back.
        window.location.href = body.data.redirectUrl;
        return;
      }
      triggerToast(body.message || 'Could not start the payment', 'error');
    } catch (e) {
      triggerToast('Network error starting the payment', 'error');
    } finally {
      setSubscriptionLoading(false);
    }
  };

  /**
   * Every subscription-gated write funnels through this so a 403 from the
   * backend opens the plan chooser instead of showing a dead-end toast.
   * Returns true when the response was the subscription gate.
   */
  const handledSubscriptionBlock = (res, body) => {
    if (res.status === 403 && body?.meta?.code === 'SUBSCRIPTION_REQUIRED') {
      setHasActiveSubscription(false);
      setShowSubscriptionModal(true);
      fetchSubscriptionPlans();
      return true;
    }
    return false;
  };

  // ── PAYOUT STATE ───────────────────────────────────────────────────────────
  const [payoutAmount, setPayoutAmount] = useState('');

  // ── SUPPORT ────────────────────────────────────────────────────────────────

  // ── REAL DATA STATES ──────────────────────────────────────────────────────
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [members, setMembers] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [dashboardKpis, setDashboardKpis] = useState(null);

  // This group's own SHGStore id/status — the socket room is keyed by the
  // store document, not the User behind it (same as the Seller panel).
  const [shgStoreId, setShgStoreId] = useState(null);
  const [shgStoreStatus, setShgStoreStatus] = useState(null);

  // ── CUSTOMER GROCERY SUBSCRIPTIONS ────────────────────────────────────────
  // Recurring ration plans a shopper bought from this group's Quick Commerce
  // listings. Not to be confused with the group's OWN paid platform
  // subscription (SHGSubscription / `mySubscription` above) — different
  // thing entirely, same word.
  const [shgSubscriptions, setShgSubscriptions] = useState([]);
  const [shgSubscriptionsLoading, setShgSubscriptionsLoading] = useState(false);
  const [shgSubscriptionsError, setShgSubscriptionsError] = useState('');
  // One ring at a time, same shape as the Seller panel's incoming order.
  const [incomingSubscriptionRequest, setIncomingSubscriptionRequest] = useState(null);
  // Prep alerts queue rather than overwrite — several plans can come due
  // close together.
  const [subscriptionPrepAlerts, setSubscriptionPrepAlerts] = useState([]);

  // ── TOAST ──────────────────────────────────────────────────────────────────
  const triggerToast = (msg, type = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // ── DATA FETCHING ──────────────────────────────────────────────────────────
  const fetchMySHGProfile = async () => {
    const token = localStorage.getItem('userToken');
    if (!token) return;

    try {
      const res = await fetch(apiUrl('/api/shg/me'), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.shgStore) {
        setIsOnboarded(data.shgStore.status === 'approved');
        setOnboardingStep(data.shgStore.onboardingStep);
        // Needed to join this store's own socket room (`shg:<id>`), which is
        // how subscription requests and prep alerts reach this panel.
        setShgStoreId(data.shgStore._id || null);
        setShgStoreStatus(data.shgStore.status || null);
        setGroupForm({
          groupName: data.shgStore.groupName || '',
          leaderName: data.shgStore.leaderName || '',
          leaderDesignation: data.shgStore.leaderDesignation || 'President',
          totalMembers: data.shgStore.totalMembers || '',
          formationYear: data.shgStore.formationYear || '',
          primaryCategory: data.shgStore.primaryCategory || 'Organic Foods & Groceries',
          houseNo: data.shgStore.houseNo || '',
          street: data.shgStore.street || '',
          landmark: data.shgStore.landmark || '',
          village: data.shgStore.village || '',
          district: data.shgStore.district || '',
          block: data.shgStore.block || '',
          state: data.shgStore.state || 'Uttar Pradesh',
          pincode: data.shgStore.pincode || '',
          lat: data.shgStore.lat ?? null,
          lng: data.shgStore.lng ?? null,
          accuracy: data.shgStore.accuracy ?? null,
          locationSource: data.shgStore.locationSource || null,
        });
        setRegistrationForm({
          shgRegId: data.shgStore.shgRegId || '',
          nrlmId: data.shgStore.nrlmId || '',
          federationName: data.shgStore.federationName || '',
          bankAccountNo: data.shgStore.groupBankAccount?.accountNo || '',
          ifscCode: data.shgStore.groupBankAccount?.ifsc || '',
          bankName: data.shgStore.groupBankAccount?.bankName || '',
          bankBranch: data.shgStore.groupBankAccount?.bankBranch || ''
        });
      }
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Exit the SHG panel entirely — clears the session (same `userToken`/
   * `userProfile` keys the Shopping App and Seller panel use, since SHG
   * sign-in reuses the shared User identity) and sends the browser to the
   * SHG login screen. Previously the "Exit" button only reset the local
   * `isOnboarded` flag, which left the token in place and dropped the user
   * back on the onboarding wizard instead of a login screen.
   */
  const logoutSHG = () => {
    deregisterPushToken().catch(() => {});
    localStorage.removeItem('userToken');
    localStorage.removeItem('userProfile');
    disconnectSocket();
    window.location.href = '/shg/login';
  };

  /**
   * Real-time channel for this store.
   *
   * Mirrors the Seller panel exactly: the room is keyed by the SHGStore
   * document (`shg:<id>`, joined server-side from the JWT — see
   * socket/socket.js), and only an approved store may join, since these
   * events carry a customer's name, address and plan value.
   */
  useEffect(() => {
    const token = localStorage.getItem('userToken');
    if (token && shgStoreId && shgStoreStatus === 'approved') {
      connectSocket(token, 'shg', shgStoreId);
    }

    socket.on('subscription_request', (request) => {
      setIncomingSubscriptionRequest(request);
    });

    socket.on('subscription_prep_alert', (alert) => {
      setSubscriptionPrepAlerts((prev) => [...prev, alert]);
    });

    return () => {
      socket.off('subscription_request');
      socket.off('subscription_prep_alert');
      disconnectSocket();
    };
  }, [shgStoreId, shgStoreStatus]);

  /** Removes one prep alert once this group has opened/handled it. */
  const dismissSubscriptionPrepAlert = (deliveryEntryId) => {
    setSubscriptionPrepAlerts((prev) => prev.filter((a) => a.deliveryEntryId !== deliveryEntryId));
  };

  /** Every customer subscription this SHG store fulfils. */
  const fetchShgSubscriptions = useCallback(async () => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    setShgSubscriptionsLoading(true);
    setShgSubscriptionsError('');
    try {
      const res = await fetch(apiUrl('/api/subscriptions/shg'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not load your subscriptions');
      setShgSubscriptions(body.data || []);
    } catch (err) {
      setShgSubscriptionsError(err.message);
      setShgSubscriptions([]);
    } finally {
      setShgSubscriptionsLoading(false);
    }
  }, []);

  // Products and orders are scoped to `activeChannel` — the backend matches
  // either a product's primary channel or an active cross-listing (see
  // buildChannelMatch in product.controller.js), and either no order-type
  // filter at all ('shg') or the exact storefront ('ecommerce'/'grocery') —
  // see ORDER_FILTERABLE_TYPES in shg.controller.js for why 'shg' means "all".
  const fetchSHGData = async () => {
    const token = localStorage.getItem('userToken');
    if (!token || !isOnboarded) return;

    try {
      // 1. Fetch products
      const prodRes = await fetch(apiUrl(`/api/products/seller/mine?roleContext=shg&type=${activeChannel}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (prodRes.ok) {
        const prodData = await prodRes.json();
        const rows = Array.isArray(prodData) ? prodData : (prodData.products || []);
        const mappedProducts = rows.map(p => ({
          _id: p._id,
          name: p.name,
          category: p.category,
          type: p.type,
          price: p.price,
          stock: p.stock,
          isHandmade: p.isHandmade,
          images: p.images,
          img: p.images?.[0] || null,
          status: p.status === 'approved' ? (p.isActive ? 'Active' : 'Inactive')
            : p.status === 'rejected' ? 'Rejected' : 'Pending Approval',
          channels: p.channels || [],
          // The full API document — ProductModal's edit path (startEditProduct)
          // needs variants/gstRate/sameDay/category-id, none of which the
          // flattened row above carries.
          raw: p,
        }));
        setProducts(mappedProducts);
      }

      // 2. Fetch orders
      const orderRes = await fetch(apiUrl(`/api/shg/orders?type=${activeChannel}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (orderRes.ok) {
        const orderData = await orderRes.json();
        const mappedOrders = (orderData.data || []).map(o => ({
          id: o._id,
          orderNo: o.orderNo,
          customer: o.shipping?.name || 'Customer',
          items: o.items ? o.items.map(i => `${i.qty}x ${i.name}`).join(', ') : '',
          itemsList: o.items || [],
          date: o.placedAt ? new Date(o.placedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '',
          total: o.totals?.subtotal || 0,
          status: o.status,
          statusType: o.status ? o.status.toLowerCase() : 'pending'
        }));
        setOrders(mappedOrders);
      }

      // 3. Fetch members — a group's membership isn't scoped by storefront.
      const memberRes = await fetch(apiUrl('/api/shg/members'), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (memberRes.ok) {
        const memberData = await memberRes.json();
        const mappedMembers = (memberData.members || []).map(m => ({
          ...m,
          id: m._id,
          contribution: m.contribution || 500,
          status: m.status || 'Active'
        }));
        setMembers(mappedMembers);
      }

      // 4. Fetch dashboard KPIs, scoped the same way
      const dashRes = await fetch(apiUrl(`/api/shg/dashboard?type=${activeChannel}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (dashRes.ok) {
        const dashData = await dashRes.json();
        setDashboardKpis(dashData.kpis || null);
      }
    } catch (e) {
      console.error('Error fetching SHG data:', e);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('userToken');
    if (token) {
      fetchMySHGProfile();
    }
  }, []);

  useEffect(() => {
    if (isOnboarded) initPushNotifications().catch(() => {});
  }, [isOnboarded]);

  // Re-fetch whenever onboarding completes or the storefront toggle changes —
  // switching SHG Store / Ecommerce / Quick Commerce re-scopes every list.
  useEffect(() => {
    fetchSHGData();
  }, [isOnboarded, activeChannel]);

  // Subscription state only exists once the store is approved (the endpoints
  // sit behind requireApprovedSHG), so it follows isOnboarded rather than
  // firing on mount. The plan list is fetched alongside it so the "renew"
  // banner and the blocked-action modal both have prices ready.
  useEffect(() => {
    if (!isOnboarded) return;
    fetchMySubscription();
    fetchSubscriptionPlans();
  }, [isOnboarded]);

  useEffect(() => {
    fetchListingCategories();
  }, []);

  // ── ONBOARDING ACTIONS ────────────────────────────────────────────────────
  const startOnboarding = async () => {
    try {
      const response = await fetch(apiUrl('/api/shg/start'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        }
      });
      if (response.ok) {
        setOnboardingStep(2);
      } else {
        const data = await response.json();
        console.error('startOnboarding error:', data);
        triggerToast(data.message || 'Failed to start onboarding', 'error');
      }
    } catch (err) {
      triggerToast('Network error starting onboarding', 'error');
    }
  };

  const lookupAddress = async (lat, lng, accuracy) => {
    try {
      const res = await fetch(apiUrl(`/api/geo/reverse?lat=${lat}&lng=${lng}${accuracy ? `&accuracy=${Math.round(accuracy)}` : ''}`), {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        }
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not look up address' };
      return { ok: true, address: body.data };
    } catch (err) {
      return { ok: false, message: err.message || 'Could not reach address service' };
    }
  };

  const [updatingLocation, setUpdatingLocation] = useState(false);

  /**
   * Fetch current store coordinates from browser GPS, reverse-geocode using platform endpoint,
   * and update the SHG store profile location in SHGStore.
   */
  const pinSHGStoreLocation = async () => {
    if (!navigator.geolocation) {
      triggerToast('Geolocation is not supported by your browser.', 'error');
      return;
    }

    setUpdatingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy);

          let address = '';
          let city = '';
          let state = '';
          let pincode = '';

          try {
            const geoRes = await lookupAddress(lat, lng, accuracy);
            if (geoRes.ok && geoRes.address) {
              const a = geoRes.address;
              address = a.address || '';
              city = a.city || '';
              state = a.state || '';
              pincode = a.pincode || '';
            }
          } catch (e) {
            console.warn('Reverse geocoding failed, sending coordinates only', e);
          }

          const updateBody = {
            lat,
            lng,
            accuracy,
            locationSource: 'gps',
          };
          if (city) updateBody.district = city;
          if (state) updateBody.state = state;
          if (pincode) updateBody.pincode = pincode;
          if (address) updateBody.street = address;

          const res = await fetch(apiUrl('/api/shg/step/1'), {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('userToken')}`
            },
            body: JSON.stringify(updateBody)
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.message || 'Failed to update store location');
          }

          triggerToast('Store location pinned successfully!');
          await fetchMySHGProfile();
        } catch (error) {
          console.error(error);
          triggerToast(error.message || 'Error updating location.', 'error');
        } finally {
          setUpdatingLocation(false);
        }
      },
      (err) => {
        setUpdatingLocation(false);
        let errorMsg = 'Failed to get location.';
        if (err.code === 1) {
          errorMsg = 'Location permission was denied. Please allow location access in your browser.';
        } else if (err.code === 2) {
          errorMsg = 'Location position is unavailable. Please check your device GPS.';
        } else if (err.code === 3) {
          errorMsg = 'Location request timed out. Please try again.';
        }
        triggerToast(errorMsg, 'error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const submitGroupProfile = async () => {
    try {
      const response = await fetch(apiUrl('/api/shg/step/1'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify(groupForm)
      });
      if (response.ok) {
        setOnboardingStep(5);
      } else {
        const data = await response.json();
        console.error('submitGroupProfile error:', data);
        triggerToast(data.message || 'Failed to save group details', 'error');
      }
    } catch (err) {
      triggerToast('Network error saving details', 'error');
    }
  };

  const submitApplication = async () => {
    try {
      const res = await fetch(apiUrl('/api/shg/submit'), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        }
      });
      if (res.ok) {
        setOnboardingStep(7);
      } else {
        const data = await res.json();
        console.error('submitApplication error:', data);
        triggerToast(data.message || 'Failed to submit application', 'error');
      }
    } catch (err) {
      triggerToast('Network error submitting application', 'error');
    }
  };

  // ── OTP TIMER ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (otpTimer > 0) {
      const t = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [otpTimer]);

  const sendOtp = () => {
    setOtpSent(true);
    setOtpTimer(30);
    triggerToast('OTP sent to registered mobile number!');
  };

  const verifyAadhaar = async () => {
    if (aadhaarNo.length !== 12) {
      triggerToast('Aadhaar must be 12 digits', 'error');
      return;
    }
    setAadhaarVerifying(true);
    try {
      const formData = new FormData();
      formData.append('number', aadhaarNo);
      // Simulate file upload with dummy binary blob for KYC front/back requirement
      const dummyFile = new Blob(['aadhaar'], { type: 'image/png' });
      formData.append('leaderAadhaarFront', dummyFile, 'aadhaar_front.png');
      formData.append('leaderAadhaarBack', dummyFile, 'aadhaar_back.png');

      const res = await fetch(apiUrl('/api/shg/step/2'), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: formData
      });

      if (res.ok) {
        setAadhaarVerified(true);
        triggerToast('Leader Aadhaar verified successfully!');
      } else {
        const data = await res.json();
        triggerToast(data.message || 'Aadhaar verification failed', 'error');
      }
    } catch (err) {
      triggerToast('Aadhaar verification failed', 'error');
    } finally {
      setAadhaarVerifying(false);
    }
  };
  const handleDocUpload = async (docKey, file) => {
    if (!file) return;
    try {
      const formData = new FormData();
      let url = '';
      if (docKey === 'shgCertificate') {
        formData.append('shgCert', file);
        formData.append('nrlmId', registrationForm.nrlmId || 'NRLM12345');
        url = '/api/shg/step/3';
      } else if (docKey === 'nrlmCertificate') {
        formData.append('nrlmCert', file);
        formData.append('nrlmId', registrationForm.nrlmId || 'NRLM12345');
        url = '/api/shg/step/3';
      } else if (docKey === 'groupPassbook') {
        formData.append('passbook', file);
        formData.append('accountNo', registrationForm.bankAccountNo || '1234567890');
        formData.append('ifsc', registrationForm.ifscCode || 'IFSC0001234');
        formData.append('holderName', groupForm.groupName || 'SHG Group');
        formData.append('bankName', registrationForm.bankName || 'State Bank');
        url = '/api/shg/step/4';
      } else {
        setUploadedDocs(prev => ({ ...prev, [docKey]: file }));
        triggerToast(`Document uploaded successfully!`);
        return;
      }

      const res = await fetch(apiUrl(url), {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: formData
      });

      if (res.ok) {
        setUploadedDocs(prev => ({ ...prev, [docKey]: file }));
        triggerToast(`Document uploaded successfully!`);
      } else {
        const data = await res.json();
        console.error('handleDocUpload error:', data);
        triggerToast(data.message || 'Upload failed', 'error');
      }
    } catch (err) {
      console.error(err);
      triggerToast('Upload failed', 'error');
    }
  };

  const handleDocDelete = (docKey) => {
    setUploadedDocs(prev => ({ ...prev, [docKey]: null }));
    triggerToast('Document removed.');
  };

  // ── PRODUCT ACTIONS ────────────────────────────────────────────────────────
  /**
   * Map the per-listing Storefront Target choice to the `type`/`channels`
   * pair the backend actually stores. `type` is the primary channel — fixed
   * forever once a product is created — `channels` is the optional
   * cross-listing on top of it. "Both" always primarys onto `grocery` with
   * `ecommerce` cross-listed, matching the spec exactly.
   */
  const resolveStorefrontFields = (storefrontTarget, categoryId) => {
    if (storefrontTarget === 'ecommerce') return { type: 'ecommerce', channels: [] };
    if (storefrontTarget === 'both') return { type: 'grocery', channels: [{ type: 'ecommerce', category: categoryId }] };
    return { type: 'grocery', channels: [] };
  };

  /**
   * Create a listing for real: POST /api/products as multipart, roleContext
   * 'shg'. The server re-validates everything (SHG tree category, 1-5
   * images, per-variant price/stock sanity), so the form's own checks are
   * only there to give faster feedback.
   */
  const submitNewProduct = async (form, files) => {
    setSavingProduct(true);
    setProductError('');
    try {
      const token = localStorage.getItem('userToken');
      if (!token) throw new Error('Your session expired. Please sign in again.');
      if (!form.categoryId) throw new Error('Please select a category.');
      if (!files || files.length === 0) throw new Error('Please add at least one product image.');
      if (!Array.isArray(form.variants) || form.variants.length === 0) {
        throw new Error('Please add at least one variant with pricing and stock.');
      }

      const { type, channels } = resolveStorefrontFields(form.storefrontTarget, form.categoryId);

      const fd = new FormData();
      fd.append('roleContext', 'shg');
      fd.append('type', type);
      fd.append('name', form.name.trim());
      fd.append('category', form.categoryId);
      if (form.desc) fd.append('description', form.desc);
      fd.append('gstRate', form.gstRate || 0);
      fd.append('variants', JSON.stringify(form.variants));
      // Every SHG listing is flagged handmade automatically — there is no
      // brand-name/corporate identity concept on this side of the app.
      fd.append('isHandmade', 'true');
      if (channels.length) fd.append('channels', JSON.stringify(channels));

      // Same-Day only makes sense on the Ecommerce (Shop All) leg.
      if ((type === 'ecommerce' || channels.some((c) => c.type === 'ecommerce')) && form.sameDayEnabled) {
        fd.append('sameDay', JSON.stringify({ enabled: true, processingMinutes: Number(form.processingMinutes) }));
      }

      files.forEach(({ file }) => fd.append('images', file));

      const res = await fetch(apiUrl('/api/products'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (handledSubscriptionBlock(res, body)) {
          setShowAddProductModal(false);
          return { ok: false };
        }
        throw new Error(body.message || 'Could not save the product');
      }

      triggerToast('Product published successfully!');
      setShowAddProductModal(false);
      setNewProductForm(defaultProductForm());
      await fetchSHGData();
      return { ok: true };
    } catch (err) {
      setProductError(err.message);
      return { ok: false };
    } finally {
      setSavingProduct(false);
    }
  };

  /**
   * Save an edit. PUT /api/products/:id. The primary `type` a listing was
   * created under never changes (the backend doesn't even accept it on
   * update) — only the cross-listing `channels` array can move a listing
   * in or out of "Both Storefronts".
   */
  const submitProductEdit = async (form) => {
    setSavingProduct(true);
    setProductError('');
    try {
      if (!form.categoryId) throw new Error('Please select a category.');
      if (!Array.isArray(form.variants) || form.variants.length === 0) {
        throw new Error('Please add at least one variant with pricing and stock.');
      }

      const { type, channels } = resolveStorefrontFields(form.storefrontTarget, form.categoryId);

      const fd = new FormData();
      fd.append('name', form.name.trim());
      fd.append('category', form.categoryId);
      if (form.desc) fd.append('description', form.desc);
      fd.append('gstRate', form.gstRate || 0);
      fd.append('variants', JSON.stringify(form.variants));
      fd.append('isHandmade', 'true');
      fd.append('channels', JSON.stringify(channels));

      if (type === 'ecommerce' || channels.some((c) => c.type === 'ecommerce')) {
        fd.append('sameDay', JSON.stringify(
          form.sameDayEnabled
            ? { enabled: true, processingMinutes: Number(form.processingMinutes) }
            : { enabled: false }
        ));
      }

      const res = await fetch(apiUrl(`/api/products/${editingProductId}`), {
        method: 'PUT',
        headers: { Authorization: `Bearer ${localStorage.getItem('userToken')}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (handledSubscriptionBlock(res, body)) {
          setShowAddProductModal(false);
          setEditingProduct(null);
          return { ok: false };
        }
        throw new Error(body.message || 'Could not save your changes');
      }

      triggerToast('Product updated.');
      setShowAddProductModal(false);
      setEditingProduct(null);
      await fetchSHGData();
      return { ok: true };
    } catch (err) {
      setProductError(err.message);
      return { ok: false };
    } finally {
      setSavingProduct(false);
    }
  };

  // Flip (or add) one cross-listed channel on an existing product — the
  // per-row "list this in Quick / Ecommerce too" toggle. `category` is only
  // required the first time a channel is switched on.
  const handleUpdateProductChannel = async (productId, type, isActive, category) => {
    try {
      const response = await fetch(apiUrl(`/api/products/${productId}/channels`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify({ type, isActive, category })
      });
      const data = await response.json();
      if (response.ok) {
        fetchSHGData();
        triggerToast(data.message || 'Listing updated!');
        return true;
      }
      if (!handledSubscriptionBlock(response, data)) {
        triggerToast(data.message || 'Failed to update listing', 'error');
      }
      return false;
    } catch (err) {
      triggerToast('Network error updating listing', 'error');
      return false;
    }
  };

  const handleUpdateStock = async (productId, change) => {
    const product = products.find(p => p._id === productId);
    if (!product) return;
    const newStock = Math.max(0, product.stock + change);

    try {
      const response = await fetch(apiUrl(`/api/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify({ stock: newStock })
      });
      if (response.ok) {
        fetchSHGData();
        triggerToast('Stock updated!');
      } else {
        const data = await response.json();
        if (!handledSubscriptionBlock(response, data)) {
          triggerToast(data.message || 'Failed to update stock', 'error');
        }
      }
    } catch (err) {
      triggerToast('Network error updating stock', 'error');
    }
  };

  const handleToggleProductStatus = async (productId, newStatus) => {
    try {
      const response = await fetch(apiUrl(`/api/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        fetchSHGData();
        setActiveActionsMenuId(null);
        triggerToast(`Status changed to ${newStatus}`);
      } else {
        const data = await response.json();
        if (!handledSubscriptionBlock(response, data)) {
          triggerToast(data.message || 'Failed to change status', 'error');
        }
      }
    } catch (err) {
      triggerToast('Network error changing status', 'error');
    }
  };

  const handleDeleteProduct = async (productId) => {
    if (window.confirm('Remove this product from SHG store?')) {
      try {
        const response = await fetch(apiUrl(`/api/products/${productId}`), {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('userToken')}`
          }
        });
        if (response.ok) {
          fetchSHGData();
          setActiveActionsMenuId(null);
          triggerToast('Product removed.');
        } else {
          const data = await response.json();
          if (!handledSubscriptionBlock(response, data)) {
            triggerToast(data.message || 'Failed to remove product', 'error');
          }
        }
      } catch (err) {
        triggerToast('Network error removing product', 'error');
      }
    }
  };

  const handleUpdateProductFields = async (productId, fields) => {
    try {
      const response = await fetch(apiUrl(`/api/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify(fields)
      });
      if (response.ok) {
        fetchSHGData();
        triggerToast('Product details updated!');
        return true;
      } else {
        const data = await response.json();
        if (!handledSubscriptionBlock(response, data)) {
          triggerToast(data.message || 'Failed to update product details', 'error');
        }
        return false;
      }
    } catch (err) {
      triggerToast('Network error updating product details', 'error');
      return false;
    }
  };

  // ── ORDER ACTIONS ──────────────────────────────────────────────────────────
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const response = await fetch(apiUrl(`/api/shg/orders/${orderId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        fetchSHGData();
        setSelectedOrder(null);
        triggerToast(`Order updated to ${newStatus}`);
      } else {
        const data = await response.json();
        triggerToast(data.message || 'Failed to update order status', 'error');
      }
    } catch (err) {
      triggerToast('Network error updating status', 'error');
    }
  };

  // ── MEMBER ACTIONS ─────────────────────────────────────────────────────────
  const handleAddMember = async (name, phone, role) => {
    try {
      const res = await fetch(apiUrl('/api/shg/members'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('userToken')}`
        },
        body: JSON.stringify({ name, phone, role })
      });
      const data = await res.json();
      if (res.ok) {
        const mappedMembers = (data.members || []).map(m => ({
          ...m,
          id: m._id,
          contribution: m.contribution || 500,
          status: m.status || 'Active'
        }));
        setMembers(mappedMembers);
        triggerToast('Member added successfully!');
      } else {
        triggerToast(data.message || 'Failed to add member', 'error');
      }
    } catch (err) {
      triggerToast('Network error adding member', 'error');
    }
  };

  const handleDeleteMember = async (memberId) => {
    if (window.confirm('Remove this member from SHG registry?')) {
      try {
        const res = await fetch(apiUrl(`/api/shg/members/${memberId}`), {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('userToken')}`
          }
        });
        const data = await res.json();
        if (res.ok) {
          const mappedMembers = (data.members || []).map(m => ({
            ...m,
            id: m._id,
            contribution: m.contribution || 500,
            status: m.status || 'Active'
          }));
          setMembers(mappedMembers);
          triggerToast('Member removed.');
        } else {
          triggerToast(data.message || 'Failed to remove member', 'error');
        }
      } catch (err) {
        triggerToast('Network error removing member', 'error');
      }
    }
  };

  // ── PAYOUT REQUEST ─────────────────────────────────────────────────────────
  const handleRequestPayout = (e) => {
    e.preventDefault();
    triggerToast('Payout system integrated with joint bank account ledger.');
  };

  return (
    <SHGContext.Provider value={{
      // Onboarding
      isOnboarded, setIsOnboarded,
      onboardingStep, setOnboardingStep,
      logoutSHG,
      otpSent, setOtpSent, otpCode, setOtpCode, otpTimer, sendOtp,
      aadhaarVerified, aadhaarVerifying, aadhaarNo, setAadhaarNo, verifyAadhaar,
      groupForm, setGroupForm,
      registrationForm, setRegistrationForm,
      uploadedDocs, handleDocUpload, handleDocDelete,
      applicationId, applicationDate,
      startOnboarding, submitGroupProfile, submitApplication, lookupAddress,
      pinSHGStoreLocation, updatingLocation, fetchMySHGProfile,
      // Panel
      activeTab, setActiveTab,
      activeMode, setActiveMode, activeChannel,
      dashboardKpis,
      toastMessage, toastType, triggerToast,
      searchQuery, setSearchQuery,
      activeProductTab, setActiveProductTab,
      activeOrderTab, setActiveOrderTab,
      showAddProductModal, setShowAddProductModal,
      selectedOrder, setSelectedOrder,
      activeActionsMenuId, setActiveActionsMenuId,
      showNotifications, setShowNotifications,
      newProductForm, setNewProductForm,
      submitNewProduct, submitProductEdit, savingProduct, productError,
      platformLimits,
      editingProduct, editingProductId, setEditingProductId, startEditProduct,
      shgCategories, quickCategories, ecommerceCategories,
      handleUpdateStock, handleToggleProductStatus, handleDeleteProduct, handleUpdateProductFields,
      handleUpdateProductChannel,
      handleUpdateOrderStatus,
      handleAddMember, handleDeleteMember,
      payoutAmount, setPayoutAmount, handleRequestPayout,
      // Customer grocery subscriptions this store fulfils
      shgStoreId, shgStoreStatus,
      shgSubscriptions, shgSubscriptionsLoading, shgSubscriptionsError, fetchShgSubscriptions,
      incomingSubscriptionRequest, setIncomingSubscriptionRequest,
      subscriptionPrepAlerts, dismissSubscriptionPrepAlert,
      // Business subscription (this group's own paid platform plan)
      subscriptionPlans, mySubscription, hasActiveSubscription,
      showSubscriptionModal, setShowSubscriptionModal,
      subscriptionLoading, purchasePlan,
      fetchMySubscription, fetchSubscriptionPlans,
      // Data
      products, orders, members, payouts, fetchSHGData
    }}>
      {children}
    </SHGContext.Provider>
  );
};

export const useSHG = () => {
  const ctx = useContext(SHGContext);
  if (!ctx) throw new Error('useSHG must be used within SHGProvider');
  return ctx;
};

export default SHGContext;
