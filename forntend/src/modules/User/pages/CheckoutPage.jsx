import ModalPortal from '../../../components/ModalPortal';
import CommittedCheckoutReview from '../components/CommittedCheckoutReview';
import { committedCheckouts, forgetCommittedCheckout, deferCommittedCheckout } from '../../../utils/committedCheckout';
import { CartEmptyState } from '../components/CartUI';
import { BasketGroups } from '../components/BasketGroups';
import React, { useState, useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import { DELIVERY_LABEL } from '../utils/deliveryLabel';
import LandmarkImagePicker from '../components/LandmarkImagePicker';
import CouponThresholdProgress from '../components/CouponThresholdProgress';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import '../components/CartCheckout.css';

const CheckoutPage = () => {
  const {
    savedAddresses,
    selectedAddressId,
    setSelectedAddressId,
    addAddress,
    uploadLandmarkImage,
    getCartTotal,
    getCartItems,
    placeOrder,
    placeUnifiedOrder,
    abandonCheckoutPayment,
    checkCheckoutStatus,
    initiateOnlinePayment,
    setActiveNav,
    setSelectedOrder,
    getDeliveryPoint,
    serverCart,
    cartChannel,
    deliveryMode,
    setDeliveryMode,
    getCouponDiscount,
    cartLoading,
    appliedCoupon,
    applyCoupon,
    availableCoupons,
    fetchAvailableCoupons,
    removeCoupon,
    couponCode,
    couponNotice,
    tipSetting,
    useCoinsSelected,
    toggleUseCoins,
    walletBalance,
    fetchWalletBalance,
    currentUser,
    switchCartChannel,
  } = useUser();
  const navigate = usePromotionNavigation();

  useEffect(() => {
    fetchWalletBalance();
  }, [fetchWalletBalance]);

  /**
   * The delivery choice, and whether one still has to be made.
   *
   * Both options come from the server with the cart — including the reason
   * Same-Day is refused, when it is — so this screen never works out an
   * eligibility or a charge for itself.
   */
  /**
   * Does this basket become more than one delivery?
   *
   * When it does, the whole screen switches to the unified path: the groups are
   * shown with their own charges, the choice is made per group, and one payment
   * covers all of them. A single-group basket keeps the existing screen exactly
   * as it was — which is every order placed up to now.
   */
  const unified = useUnifiedCart(getDeliveryPoint(), couponCode, 'basket');
  const groups = unified.data?.groups || [];
  const basketItems = unified.data ? unified.basketItems : (serverCart?.items || []);
  const isDigitalCart = basketItems.length > 0 && basketItems.every(item => item.fulfillmentType === 'digital');
  const hasMixedFulfillment = basketItems.some(item => item.fulfillmentType === 'digital') && !isDigitalCart;
  const hasWholesale = groups.some(group => group.salesChannel === 'wholesale');
  const isUnified = !isDigitalCart && (hasWholesale || groups.length > 1 || (groups.length === 1 && groups[0].channel !== cartChannel));
  const basketCheckout = isUnified && unified.data?.purchaseMode === 'basket';
  const checkoutOperation = basketCheckout ? 'basket' : isUnified ? 'unified' : isDigitalCart ? 'digital' : 'single';
  const canTip = !isDigitalCart && (!hasWholesale || groups.some(group => group.salesChannel === 'retail'));
  const checkoutBlocked = unified.loading || Boolean(unified.error) || !unified.data || unified.data.valid === false
    || !basketItems.length || hasMixedFulfillment || (isUnified && Boolean(appliedCoupon || couponCode));
  useEffect(() => {
    if (groups.length === 1 && groups[0].salesChannel !== 'wholesale' && groups[0].channel !== cartChannel) switchCartChannel?.(groups[0].channel);
  }, [groups[0]?.channel, groups.length, cartChannel, hasWholesale, switchCartChannel]);

  const [paymentMethod, setPaymentMethod] = useState('Cash on Delivery');
  useEffect(() => {
    if (isDigitalCart) setPaymentMethod('Online Payment');
  }, [isDigitalCart]);
  const [isOrdering, setIsOrdering] = useState(false);
  // State updates after a render; this ref closes the small interval in which
  // a double tap could start two requests with the same checkout key.
  const orderingRef = useRef(false);
  const [showBillBreakdown, setShowBillBreakdown] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [placedOrderDetails, setPlacedOrderDetails] = useState(null);
  /**
   * Every order this checkout produced.
   *
   * A unified basket becomes several, and a confirmation that names only the
   * first quietly hides the other two — the customer has no way to know a second
   * parcel is coming, or to open it. One entry for an ordinary checkout, so the
   * existing screen is unchanged when there is nothing extra to say.
   */
  const [placedOrders, setPlacedOrders] = useState([]);
  const [placedPaymentAmount, setPlacedPaymentAmount] = useState(null);

  // Coupon form states and handlers
  const [couponInput, setCouponInput] = useState('');
  const [couponMessage, setCouponMessage] = useState(null);
  const [couponMessageType, setCouponMessageType] = useState('success'); // 'success' | 'error'
  const [applying, setApplying] = useState(false);
  const [showOffers, setShowOffers] = useState(false);



  const [tipChip, setTipChip] = useState(null);
  const [tipCustomInput, setTipCustomInput] = useState('');
  const [isCustomTip, setIsCustomTip] = useState(false);
  const tipInputRef = useRef(null);

  const minCustomTip = Number(tipSetting?.minCustomAmount) || 1;
  const maxCustomTip = Number(tipSetting?.maxCustomAmount) || 1000;
  const rawCustomTipVal = tipCustomInput.trim() === '' ? null : Number(tipCustomInput);

  let customTipError = '';
  let validCustomTip = 0;

  if (isCustomTip && rawCustomTipVal !== null) {
    if (!Number.isFinite(rawCustomTipVal) || rawCustomTipVal <= 0) {
      customTipError = 'Please enter a valid amount.';
    } else if (rawCustomTipVal < minCustomTip) {
      customTipError = `Minimum tip is ₹${minCustomTip}`;
    } else if (rawCustomTipVal > maxCustomTip) {
      customTipError = `Maximum tip is ₹${maxCustomTip}`;
    } else {
      validCustomTip = Math.floor(rawCustomTipVal);
    }
  }

  const tipAmount = canTip ? (tipChip ?? (isCustomTip ? validCustomTip : 0)) : 0;
  const tipOptions = Array.isArray(tipSetting?.options) ? tipSetting.options : [];

  const handleApplyCoupon = async (e) => {
    e.preventDefault();
    if (!couponInput.trim() || applying) return;

    setApplying(true);
    const res = await applyCoupon(couponInput.trim());
    setApplying(false);

    setCouponMessage(res.message);
    setCouponMessageType(res.success ? 'success' : 'error');
    if (res.success) setCouponInput('');
  };

  const shopMoreForCoupon = offer => {
    if (offer.shopMore?.type === 'product') navigate({ type: 'PRODUCT', id: offer.shopMore.id });
    else if (offer.shopMore?.type === 'category') navigate({ type: 'CATEGORY', id: offer.shopMore.id, slug: offer.shopMore.id });
    else setActiveNav('categories');
  };

  // Address form states
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [house, setHouse] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [addressType, setAddressType] = useState('Home');
  const [addressFormError, setAddressFormError] = useState('');

  const customerName = (currentUser?.name || '').trim();
  const customerPhone = (currentUser?.phone || '').trim();
  const isProfileComplete = Boolean(customerName && customerPhone);

  // The pin captured from the device, carried through to the saved address.
  // Without it the order has no destination for the rider or the map.
  const [coords, setCoords] = useState(null);

  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState(null);

  /**
   * Capture where the customer actually is.
   *
   * Three things were wrong here, and the first broke everything downstream:
   *
   *  - The coordinates were read and then discarded. Only the reverse-geocoded
   *    text was kept, so every address was saved without lat/lng. That is why a
   *    rider was offered "Store to customer —" with no distance, why the payout
   *    collapsed to the base fare, and why the tracking map had no destination.
   *
   *  - Google was called straight from the browser with the key in the URL. The
   *    server already does this at /api/geo/reverse, with caching and a rate
   *    limit, so the same lookup does not get billed twice for one address.
   *
   *  - On failure it filled the form with a made-up Lucknow address. A shopper
   *    in Indore whose lookup failed would have had their order sent to a street
   *    they had never heard of, with nothing on screen to say so.
   */
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('This browser cannot read your location. Please type your address.');
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));

        // Kept regardless of what the address lookup does. The pin is the part
        // the rider actually navigates to.
        setCoords({ lat, lng, accuracy: Math.round(position.coords.accuracy) });

        try {
          const res = await fetch(apiUrl(`/api/geo/reverse?lat=${lat}&lng=${lng}&accuracy=${Math.round(position.coords.accuracy)}`), {
            headers: { Authorization: 'Bearer ' + localStorage.getItem('userToken') },
          });
          const body = await res.json().catch(() => ({}));

          if (!res.ok) {
            setLocationError(
              (body.message || 'Could not look up your address.')
              + ' Your location is pinned — please fill in the address below.'
            );
            return;
          }

          const a = body.data || {};
          // Only overwrite what came back, so anything already typed survives.
          if (a.address) setHouse(a.address);
          if (a.city) setCity(a.city);
          if (a.pincode) setPincode(a.pincode);
        } catch {
          setLocationError('Could not reach the address service. Your location is pinned — please fill in the address below.');
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        const messages = {
          1: 'You blocked location access. Allow it, or type your address below.',
          2: 'Your location could not be determined right now.',
          3: 'Finding your location took too long. Please try again.',
        };
        setLocationError(messages[err.code] || 'Could not read your location.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  /**
   * What the customer pays.
   *
   * On a unified basket this is the server's figure across every group — the
   * per-channel cart total would only ever describe one of them, and showing it
   * would understate the bill on the screen where the bill matters most.
   */
  // NHCONE Coins — `coins.finalPayable` is the one server-calculated figure
  // that already accounts for the discount; only read when the toggle is
  // actually on and the server actually applied one (0 otherwise, so an
  // order without Coins is byte-for-byte the pre-Coins total).
  const coinDiscountVal = (!isUnified && useCoinsSelected) ? (serverCart?.coins?.coinDiscount || 0) : 0;
  const total = (!isUnified ? getCartTotal() : (unified.data?.totals?.totalAmount ?? 0)) - coinDiscountVal;
  const grandTotalVal = total + tipAmount;
  const channelItems = getCartItems();
  const items = unified.data ? unified.basketItems : channelItems;

  const [fallbackSeller, setFallbackSeller] = useState(null);

  const quickGroup = groups.find((g) => g.channel === 'grocery');
  const isQuickCommerceCart =
    cartChannel === 'grocery' ||
    serverCart?.channel === 'grocery' ||
    Boolean(quickGroup) ||
    (Array.isArray(items) && items.some((i) => i.type === 'grocery' || i.channel === 'grocery'));

  const quickCommerceSeller =
    quickGroup?.seller ||
    serverCart?.seller ||
    (Array.isArray(groups) ? groups.find((g) => g.seller)?.seller : null) ||
    fallbackSeller ||
    null;

  useEffect(() => {
    if (!isQuickCommerceCart || quickCommerceSeller) return;
    const targetSellerId =
      items?.[0]?.sellerId ||
      serverCart?.items?.[0]?.sellerId ||
      quickGroup?.items?.[0]?.sellerId;
    if (!targetSellerId) return;

    fetch(apiUrl(`/api/sellers/public/${targetSellerId}`))
      .then((res) => res.json())
      .then((body) => {
        if (body.success && body.data) {
          setFallbackSeller(body.data);
        }
      })
      .catch(() => {});
  }, [isQuickCommerceCart, quickCommerceSeller, items, serverCart, quickGroup]);

  const subtotalVal = isUnified && unified.data ? (unified.data.totals?.subtotal || 0) : (serverCart?.pricing?.subtotal || 0);
  const couponDiscountVal = isUnified && unified.data
    ? (unified.data.totals?.couponDiscount || 0)
    : (getCouponDiscount ? getCouponDiscount() : 0);

  const sameDayFee = serverCart?.pricing?.sameDayFee || 0;
  const sameDayIncentive = serverCart?.pricing?.sameDayIncentive || 0;
  const sameDayPremiumVal = isUnified && unified.data
    ? (unified.data.totals?.sameDayPremium || 0) 
    : (deliveryMode === 'same_day' ? (sameDayFee + sameDayIncentive) : 0);

  const deliveryChargeVal = isUnified && unified.data
    ? Math.max(0, (unified.data.totals?.deliveryCharge || 0) - (unified.data.totals?.sameDayPremium || 0))
    : (deliveryMode === 'same_day' ? (serverCart?.pricing?.standardFee || 0) : (serverCart?.pricing?.deliveryCharge || 0));

  const [landmarkImgUrl, setLandmarkImgUrl] = useState('');
  const [uploadingLandmarkImg, setUploadingLandmarkImg] = useState(false);

  const handleCheckoutLandmarkFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLandmarkImg(true);
    const res = await uploadLandmarkImage(file);
    setUploadingLandmarkImg(false);
    if (res.ok) {
      setLandmarkImgUrl(res.imageUrl);
    } else {
      setAddressFormError(res.message || 'Landmark image upload failed');
    }
  };

  const handleAddAddress = async (e) => {
    e.preventDefault();
    setAddressFormError('');

    if (!customerName || !customerPhone) {
      setAddressFormError('Please complete your profile name and mobile number before saving an address.');
      return;
    }

    if (!house || !city || !pincode) {
      setAddressFormError('Please fill in Flat/House No., City, and Pincode.');
      return;
    }
    
    const res = await addAddress({
      name: customerName,
      phone: customerPhone,
      line1: house,
      line2: street,
      city,
      state: 'Madhya Pradesh',
      pincode,
      // Undefined rather than 0 when unknown: 0,0 is a real place in the
      // Atlantic, and a rider sent there would have no way to tell.
      lat: coords?.lat,
      lng: coords?.lng,
      type: addressType,
      landmarkImage: landmarkImgUrl || null,
    });
    
    if (res && res.ok === false) {
      setAddressFormError(res.message || 'Could not save the address');
      return;
    }

    setShowAddressForm(false);
    setHouse('');
    setStreet('');
    setCity('');
    setPincode('');
    setCoords(null);
    setLandmarkImgUrl('');
    setAddressFormError('');
  };

  const [, refreshCommittedReference] = useState(0);
  const recoveryCustomerId = currentUser?._id || currentUser?.id;
  const committedReference = committedCheckouts(recoveryCustomerId).find(reference => !reference.deferred);
  const [orderError, setOrderError] = useState('');
  const [orderConflict, setOrderConflict] = useState(() => {
    try {
      for (const operation of ['basket', 'wholesale', 'unified', 'single', 'digital']) {
        if (sessionStorage.getItem('bulkimart:checkout:' + operation + ':' + (currentUser?._id || currentUser?.id || 'customer'))) return { code: 'CHECKOUT_OUTCOME_UNCERTAIN', operation };
      }
    } catch { /* Storage may be unavailable. */ }
    return null;
  });
  const [checkingCheckout, setCheckingCheckout] = useState(false);
  const recoveryCodes = ['CHECKOUT_DATA_CONFLICT', 'CHECKOUT_OUTCOME_UNCERTAIN', 'CHECKOUT_IN_PROGRESS', 'CHECKOUT_SAVE_FAILED', 'CHECKOUT_RESULT_UNAVAILABLE'];
  const recoveryRequired = Boolean(orderConflict && recoveryCodes.includes(orderConflict.code) && !orderConflict.retryAllowed);

  const handleCheckoutRecovery = async () => {
    if (checkingCheckout) return;
    setCheckingCheckout(true);
    try {
      const result = await checkCheckoutStatus(orderConflict.operation || checkoutOperation);
      if (!result.ok) { setOrderError(result.message); return; }
      if (result.data?.state === 'completed' && result.data.orders?.length) {
        setActiveNav('orders');
        return;
      }
      const retryAllowed = result.data?.state === 'not_found' && result.data.canRetrySameKey === true;
      setOrderConflict(current => ({ ...current, retryAllowed }));
      setOrderError(result.data?.state === 'not_found'
        ? 'No committed checkout was found. Once the conflict is resolved, you can retry using the same checkout session.'
        : result.message);
    } finally { setCheckingCheckout(false); }
  };

  const handlePlaceOrder = async () => {
    if (committedReference || orderingRef.current || isOrdering || cartLoading || checkoutBlocked || recoveryRequired || !basketItems.length) return;
    if (hasMixedFulfillment) {
      setOrderError('Digital and physical products require separate checkout. Remove one type and check out each group separately.');
      return;
    }
    if (isCustomTip && customTipError) {
      setOrderError(customTipError);
      return;
    }

    orderingRef.current = true;
    setIsOrdering(true);
    setOrderError('');
    setOrderConflict(null);

    // Real checkout: the server reprices the cart from live product data, holds
    // the stock in a transaction, and returns the created order.
    // One basket that becomes three deliveries takes one payment; a basket that
    // is already one delivery goes down the path it always has.
    const previousReferences = new Set(committedCheckouts(recoveryCustomerId).map(reference => reference.key));
    const res = isUnified
      ? await placeUnifiedOrder(paymentMethod, tipAmount, ...(basketCheckout ? [{ purchaseMode: 'basket', quoteHash: unified.data.quoteHash, basketHash: unified.data.basketHash }] : []))
      : await placeOrder(paymentMethod, tipAmount);

    if (!res.ok) {
      orderingRef.current = false;
      setIsOrdering(false);
      setOrderError(res.message || 'Could not place your order');
      setOrderConflict(res.status === 409 || recoveryCodes.includes(res.code) ? { ...res, operation: basketCheckout ? 'basket' : res.operation } : null);
      return;
    }

    const firstOrder = res.order || res.orders?.[0];
    setPlacedPaymentAmount(res.payment?.amount ?? firstOrder?.pricing?.totalAmount ?? null);

    // "Online Payment" doesn't stop here — the order exists (stock is held,
    // pricing is locked) but is not paid yet. The backend selects the gateway;
    // only its signed/server-side verification can mark the payment paid.
    if (paymentMethod === 'Online Payment') {
      const pay = await initiateOnlinePayment(firstOrder._id);
      orderingRef.current = false;
      setIsOrdering(false);
      if (pay.ok && pay.redirectUrl) {
        window.location.href = pay.redirectUrl;
        return;
      }
      if (pay.ok && pay.verified) {
        // Other saved orders may still be unpaid. Clear only this purchase.
        const paidKey = res.checkoutKey || committedCheckouts(recoveryCustomerId).find(reference => !previousReferences.has(reference.key))?.key;
        if (paidKey) forgetCommittedCheckout(recoveryCustomerId, paidKey);
        fetchWalletBalance();
        setPlacedOrderDetails(firstOrder);
        setPlacedOrders(res.orders || [firstOrder]);
        setOrderSuccess(true);
        return;
      }
      if (pay.cancelled) {
        const pendingKey = res.checkoutKey || committedCheckouts(recoveryCustomerId).find(reference => !previousReferences.has(reference.key))?.key;
        orderingRef.current = true;
        setIsOrdering(true);
        const cancellation = await abandonCheckoutPayment(firstOrder._id);
        orderingRef.current = false;
        setIsOrdering(false);
        if (!cancellation.ok || !cancellation.cancelled && cancellation.status !== 'paid') {
          setOrderError(cancellation.message || 'Check payment status before trying again.');
          setOrderConflict({ code: 'CHECKOUT_OUTCOME_UNCERTAIN', operation: checkoutOperation });
          return;
        }
        // Keep the durable recovery locator until the backend confirms the
        // cancellation (or a payment that won the race with dismissal).
        if (pendingKey) forgetCommittedCheckout(recoveryCustomerId, pendingKey);
        if (cancellation.status === 'paid') {
          fetchWalletBalance();
          setPlacedOrderDetails(firstOrder);
          setPlacedOrders(res.orders || [firstOrder]);
          setOrderSuccess(true);
          return;
        }
        void unified.reload();
        setOrderError('Payment was cancelled. You can retry payment or select another payment method.');
        setOrderSuccess(false);
        setPlacedOrderDetails(null);
        setPlacedOrders([]);
        return;
      }

      // System payment initiation failure — order exists but is unpaid
      setOrderError(pay.message || 'Payment could not be confirmed. Check its status before trying again.');
      setOrderConflict({ code: 'CHECKOUT_OUTCOME_UNCERTAIN', operation: checkoutOperation });
      setOrderSuccess(false);
      return;
    }

    orderingRef.current = false;
    setIsOrdering(false);
    fetchWalletBalance();
    // The confirmation screen shows one order; for a unified checkout that is
    // the first of several, and the rest are in the orders list beneath it.
    setPlacedOrderDetails(firstOrder);
    setPlacedOrders(res.orders || (res.order ? [res.order] : []));
    setOrderSuccess(true);
  };

  const errorBanner = orderError || recoveryRequired ? (
    <div style={{ margin: '0 16px 12px', padding: 12, borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
                  background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.4)', color: '#b91c1c' }}>
      {orderError || 'Check your previous checkout before placing another order.'}
      {orderConflict && <div style={{ marginTop: 8 }}>
        <button type="button" className="cart-secondary-btn" onClick={() => setActiveNav('orders')}>Check My Orders</button>
        {recoveryCodes.includes(orderConflict.code) && <button type="button" className="cart-secondary-btn" disabled={checkingCheckout} onClick={handleCheckoutRecovery}>
          {checkingCheckout ? 'Checking order status…' : 'Check checkout status'}
        </button>}
        {![...recoveryCodes, 'IDEMPOTENCY_KEY_REUSED'].includes(orderConflict.code) &&
          <button type="button" className="cart-secondary-btn" onClick={() => unified.reload()}>Refresh basket</button>}
        {orderConflict.requestId && <small style={{ display: 'block' }}>Support reference: {orderConflict.requestId}</small>}
      </div>}
    </div>
  ) : null;

  // Saving an unpaid order is part of opening the payment window. Do not
  // mount recovery (or start its status requests) while that window is active.
  if (committedReference && isOrdering) return (
    <div className="checkout-page-container checkout-payment-in-progress" role="status" aria-live="polite">
      <h1>Complete your payment</h1>
      <p>Use the secure payment window to finish checkout.</p>
    </div>
  );

  if (committedReference) return <CommittedCheckoutReview
    key={recoveryCustomerId + ':' + committedReference.key}
    reference={committedReference}
    onPay={initiateOnlinePayment}
    onContinueCheckout={() => {
      deferCommittedCheckout(recoveryCustomerId, committedReference.key);
      setOrderSuccess(false); setOrderError(''); setPlacedOrderDetails(null); setPlacedOrders([]);
      refreshCommittedReference(value => value + 1);
    }}
    onOrders={() => setActiveNav('orders')}
    onResolved={key => {
      forgetCommittedCheckout(recoveryCustomerId, key);
      setOrderSuccess(false); setOrderError(''); setPlacedOrderDetails(null); setPlacedOrders([]);
      refreshCommittedReference(value => value + 1);
      setActiveNav('home');
    }}
  />;

  if (orderSuccess && placedOrderDetails) {
    // Generate beautiful timeline sequence based on real order status
    const statusSequence = ['placed', 'confirmed', 'preparing', 'dispatched', 'out_for_delivery', 'delivered'];
    const currentStatus = placedOrderDetails.status || 'placed';
    const currentIndex = statusSequence.indexOf(currentStatus);

    const timelineSteps = [
      { label: 'Order Placed', desc: 'We have received your order.', status: 'placed' },
      { label: 'Confirmed', desc: 'Seller has accepted your order.', status: 'confirmed' },
      // "Preparing" is hidden here too — the same timeline the tracking screen
      // shows, and the two must not disagree about what the stages are.
      { label: 'Dispatched', desc: 'Ready for rider pickup.', status: 'dispatched' },
      { label: 'Out for Delivery', desc: 'Rider is on the way to your address.', status: 'out_for_delivery' },
      { label: 'Delivered', desc: 'Order successfully delivered.', status: 'delivered' }
    ].map((step) => {
      // Position in the status sequence, not in this array — otherwise removing
      // a row shifts every index below it and lights up steps not yet reached.
      const stepIndex = statusSequence.indexOf(step.status);
      const isDone = stepIndex !== -1 && stepIndex <= currentIndex;
      const dbTimelineEntry = placedOrderDetails.timeline?.find(t => t.status === step.status);
      const timeText = dbTimelineEntry 
        ? new Date(dbTimelineEntry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;

      return {
        label: step.label,
        desc: step.desc,
        done: isDone,
        time: timeText
      };
    });

    const displayAddr = placedOrderDetails.shippingAddress || {};
    const addrText = `${displayAddr.line1 || displayAddr.address || ''}${displayAddr.line2 ? ', ' + displayAddr.line2 : ''}, ${displayAddr.city || ''} - ${displayAddr.pincode || ''}`;

    return (
      <div className="checkout-success-container" style={{ fontFamily: "'Outfit', sans-serif", padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        
        {errorBanner}
        {/* Success Icon */}
        <div style={{ textAlign: 'center', margin: '20px 0 10px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'var(--primary-light)', border: '2px solid var(--primary)', display: 'flex', alignItems: 'center', justifyCentert: 'center', color: 'var(--primary)', fontSize: 32, justifyContent: 'center' }}>
            ✓
          </div>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)' }}>{orderError ? 'Orders created · Review status' : 'Order Placed Successfully!'}</h3>
          {placedOrders.length > 1 ? (
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
              {placedOrders.length} orders created
            </span>
          ) : (
            <span className="order-id-badge" style={{ background: 'var(--primary-light)', color: 'var(--primary)', padding: '4px 14px', borderRadius: 20, fontWeight: 700 }}>
              Order ID: {placedOrderDetails.orderNo || placedOrderDetails._id || placedOrderDetails.id}
            </span>
          )}
        </div>

        {/*
          A basket that split names every order it became.
          Each row opens that order's tracking through the same
          `setSelectedOrder` the orders list uses — one navigation mechanism,
          not a second one invented here.
        */}
        {placedOrders.length > 1 && (
          <div className="profile-menu-card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
              {placedOrders.length} orders created
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 12 }}>
              Your basket is arriving as separate deliveries. Tap one to track it.
            </div>

            {placedOrders.map((o) => {
              const label = o.deliveryMode ? DELIVERY_LABEL[o.deliveryMode] : null;
              const text = o.salesChannel === 'wholesale' ? 'Wholesale' : label ? label.text : o.type === 'grocery' ? 'Quick Commerce' : 'E-Commerce';
              const icon = label ? label.icon : '⚡';
              return (
                <button
                  key={o._id}
                  type="button"
                  onClick={() => setSelectedOrder(o)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, padding: '11px 12px', marginBottom: 8, cursor: 'pointer', textAlign: 'left',
                    border: '1.5px solid var(--border-color)', borderRadius: 10, background: 'transparent',
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--text-primary)' }}>
                      {o.orderNo || o._id}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {icon} {text} · {o.items?.length || 0} item{(o.items?.length || 0) === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span style={{ fontWeight: 800, fontSize: 12.5, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    ₹{o.pricing?.totalAmount} ›
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Order Details Summary Card */}
        <div className="profile-menu-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Delivery Details Summary
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Payment Mode</span>
              <span style={{ fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase' }}>{placedOrderDetails.paymentMethod}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Estimated Delivery</span>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{placedOrderDetails.estimatedDelivery || 'See each order for delivery updates'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Order Amount</span>
              <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{placedPaymentAmount != null ? '₹' + placedPaymentAmount : 'See individual orders'}</span>
            </div>
            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: 10, marginTop: 4 }}>
              <span style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Delivery Address:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4, display: 'block' }}>
                {addrText}
              </span>
            </div>
          </div>
        </div>

        {/* Dynamic Timeline tracker */}
        <div className="profile-menu-card" style={{ padding: 16 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
            Fulfillment Live Timeline
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {timelineSteps.map((step, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 12, position: 'relative' }}>
                {/* Timeline connector line */}
                {idx < timelineSteps.length - 1 && (
                  <div style={{ 
                    position: 'absolute', 
                    left: 9, 
                    top: 20, 
                    bottom: -22, 
                    width: 2, 
                    background: step.done ? 'var(--primary)' : '#e2e8f0' 
                  }} />
                )}
                
                {/* Dot */}
                <div style={{ 
                  width: 20, 
                  height: 20, 
                  borderRadius: '50%', 
                  background: step.done ? 'var(--primary)' : '#fff', 
                  border: `2px solid ${step.done ? 'var(--primary)' : '#cbd5e1'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 10,
                  zIndex: 2,
                  fontWeight: 800
                }}>
                  {step.done && '✓'}
                </div>

                <div>
                  <h4 style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: step.done ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                    {step.label}
                  </h4>
                  <p style={{ margin: 0, fontSize: 11, color: 'var(--text-muted)' }}>
                    {step.desc} {step.time && `• ${step.time}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <button 
            className="pd-add-to-cart-btn"
            onClick={() => setActiveNav('orders')}
            style={{ margin: 0 }}
          >
            Track Active Orders Page
          </button>
          
          <button 
            onClick={() => setActiveNav('home')}
            style={{ 
              padding: 14, 
              background: 'none', 
              border: '1.5px solid var(--border-color)', 
              borderRadius: 14, 
              color: 'var(--text-primary)', 
              fontWeight: 700, 
              fontSize: 14, 
              cursor: 'pointer' 
            }}
          >
            Go back to Home Feed
          </button>
        </div>

      </div>
    );
  }

  if (!unified.loading && unified.data && !basketItems.length && !recoveryRequired) return <CartEmptyState onBrowse={() => setActiveNav('home')} />;

  return (
    <div className="checkout-page-container" style={{ fontFamily: "'Outfit', sans-serif" }}>
      {committedCheckouts(recoveryCustomerId).some(reference => reference.deferred) && (
        <div className="profile-menu-card" style={{ margin: 16, padding: 16 }}>
          <p>Your earlier orders are saved. Review or resume their payments in My Orders.</p>
          <button type="button" className="cart-secondary-btn" onClick={() => setActiveNav('orders')}>View My Orders</button>
        </div>
      )}
      
      {/* Loading Overlay */}
      {isOrdering && (
        <ModalPortal style={{
          position: 'fixed', 
          inset: 0, 
          background: 'rgba(255, 255, 255, 0.9)', 
          zIndex: 9999, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center', 
          gap: 16 
        }}>
          <div className="auth-spinner"></div>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>Processing Payment & Order...</span>
        </ModalPortal>
      )}

      {/* Header bar */}
      <div className="checkout-header">
        <div className="checkout-header-row">
          <button 
            className="back-arrow-white" 
            onClick={() => setActiveNav('cart')} 
            aria-label="Go to Cart"
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <h1 className="profile-title" style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Checkout</h1>
        </div>
      </div>

      <div className="checkout-content">
      <div className="checkout-form-column">
      {unified.loading && <div className="basket-loading" role="status">Checking your basket and delivery charges…</div>}
      {unified.error && <div role="alert" className="wholesale-cart-alert">{unified.error} <button type="button" className="cart-secondary-btn" onClick={unified.reload}>Retry basket check</button></div>}
      {!unified.loading && !unified.error && unified.data && !basketItems.length && <CartEmptyState onBrowse={() => setActiveNav('home')} />}
      {unified.data?.warnings?.map(message => <p role="alert" key={message}>{message}</p>)}

        
        {/* Address Selection Section */}
        {!isDigitalCart ? (<div className="profile-menu-card checkout-address-section" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="checkout-section-title">Delivery address</h2>
            
            <button 
              onClick={() => setShowAddressForm(!showAddressForm)}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
            >
              {showAddressForm ? 'Cancel' : '+ Add New'}
            </button>
          </div>

          {showAddressForm ? (
            <form onSubmit={handleAddAddress} className="checkout-address-form">
              <button
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={locating}
                className="checkout-location-btn"
              >
                <span>📍</span>
                <span>{locating ? 'Fetching Live Location...' : 'Use Current Location'}</span>
              </button>
              {locationError && (
                <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: '600', display: 'block', textAlign: 'center' }}>
                  {locationError}
                </span>
              )}

              {!isProfileComplete ? (
                <div className="checkout-profile-warning" role="alert">
                  <div className="checkout-profile-warning-text">
                    <strong>Complete your profile:</strong>{' '}
                    {!customerName && !customerPhone
                      ? 'Please add your name and mobile number to deliver your order.'
                      : !customerName
                      ? 'Please add your full name to deliver your order.'
                      : 'Please add your mobile number to deliver your order.'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveNav('account')}
                    className="checkout-complete-profile-btn"
                  >
                    Complete Profile
                  </button>
                </div>
              ) : (
                <div className="checkout-recipient-info">
                  <span className="checkout-recipient-label">Delivering to</span>
                  <span className="checkout-recipient-value">
                    {customerName} • {customerPhone}
                  </span>
                </div>
              )}

              {addressFormError && (
                <div className="checkout-form-error" role="alert">
                  {addressFormError}
                </div>
              )}
              <div className="checkout-form-group">
                <label className="checkout-form-label" htmlFor="checkout-house">Flat / House / Block No.</label>
                <input 
                  id="checkout-house"
                  type="text" 
                  className="checkout-form-input"
                  placeholder="e.g. Flat 304, Block C"
                  value={house}
                  onChange={(e) => setHouse(e.target.value)}
                  required
                />
              </div>
              <div className="checkout-form-group">
                <label className="checkout-form-label" htmlFor="checkout-street">Street / Area / Sector</label>
                <input 
                  id="checkout-street"
                  type="text" 
                  className="checkout-form-input"
                  placeholder="e.g. Regal Circle, MG Road"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  required
                />
              </div>
              <div className="checkout-form-row">
                <div className="checkout-form-group">
                  <label className="checkout-form-label" htmlFor="checkout-city">City</label>
                  <input 
                    id="checkout-city"
                    type="text" 
                    className="checkout-form-input"
                    placeholder="e.g. Lucknow"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                  />
                </div>
                <div className="checkout-form-group">
                  <label className="checkout-form-label" htmlFor="checkout-pincode">Pincode</label>
                  <input 
                    id="checkout-pincode"
                    type="text" 
                    className="checkout-form-input"
                    placeholder="e.g. 226001"
                    maxLength={6}
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    required
                  />
                </div>
              </div>
              
              <fieldset className="checkout-form-group checkout-address-type">
                <legend className="checkout-form-label">Address Type</legend>
                <div className="checkout-address-type-options">
                  {['Home', 'Work'].map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setAddressType(type)}
                      className={`checkout-address-type-btn ${addressType === type ? 'active' : ''}`}
                      aria-pressed={addressType === type}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="checkout-landmark-panel">
                <LandmarkImagePicker
                  value={landmarkImgUrl}
                  onChange={(url) => setLandmarkImgUrl(url)}
                  onUpload={uploadLandmarkImage}
                  label="Landmark Photo (Optional)"
                  sublabel="Upload a photo of your gate or house for quick delivery."
                />
              </div>

              <button type="submit" className="checkout-save-address-btn">
                Save & Select Address
              </button>
            </form>
          ) : null}

          {/* Saved Addresses list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {savedAddresses.map(addr => {
              const addrId = addr._id || addr.id;
              const isSelected = String(selectedAddressId) === String(addrId);
              return (
                <label className={`checkout-selection checkout-address${isSelected ? ' is-selected' : ''}`}
                  key={addrId}
                  style={{ 
                    display: 'flex', 
                    gap: 12, 
                    padding: 12, 
                    borderRadius: 10, 
                    border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                    background: isSelected ? 'var(--primary-light)' : '#fff',
                    cursor: 'pointer',
                    alignItems: 'flex-start'
                  }}
                >
                  <input 
                    type="radio" 
                    name="selected_addr"
                    checked={isSelected}
                    onChange={() => setSelectedAddressId(addrId)}
                    style={{ marginTop: 3, cursor: 'pointer' }}
                  />
                  <div className="checkout-selection-content">
                    <div className="checkout-address-recipient" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>
                        {addr.name || customerName || 'Delivery Address'}
                      </span>
                      <span style={{ 
                        fontSize: 9, 
                        fontWeight: 800, 
                        background: isSelected ? 'var(--primary)' : '#94a3b8', 
                        color: '#fff', 
                        padding: '1px 8px', 
                        borderRadius: 20 
                      }}>
                        {addr.type || addr.label || 'Home'}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginTop: 4, lineHeight: 1.4 }}>
                      {[addr.line1 || addr.house, addr.line2 || addr.street, addr.city, addr.pincode].filter(Boolean).join(', ')}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                      Mobile: {addr.phone || customerPhone || 'Not provided'}
                    </span>
                    {addr.landmarkImage && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                        <img src={addr.landmarkImage} alt="Landmark" style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover', border: '1px solid #cbd5e1' }} />
                        <span style={{ fontSize: '11px', color: '#15803d', fontWeight: '700' }}>📸 Landmark Photo Attached</span>
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>) : (
          <div className="profile-menu-card" style={{ padding: 16, border: '1px solid rgba(14,165,233,.3)', background: '#f0f9ff' }}>
            <strong style={{ color: '#0369a1' }}>Digital delivery</strong>
            <div style={{ marginTop: 5, fontSize: 12, color: '#475569' }}>
              No delivery address or shipping fee is required. Your e-books appear in My E-books after Razorpay verifies payment.
            </div>
          </div>
        )}



        {!isDigitalCart && <div className="profile-menu-card checkout-delivery-section" style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }} aria-hidden="true">🚚</span>
            <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>Delivery Details</strong>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groups.map(group => (
              <div className="checkout-delivery-row" key={group.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, padding: '8px 10px', background: 'var(--surface-background)', borderRadius: 8, border: '1px solid var(--border-color)' }}>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{group.seller?.name || 'Store'}</span>
                <span style={{ color: 'var(--primary)', fontWeight: 700, fontSize: 11.5, background: 'var(--primary-light)', padding: '3px 8px', borderRadius: 6 }}>
                  {group.channel === 'grocery' ? '⚡ Quick Commerce delivery' : group.requestedMode === 'same_day' ? '🚀 Same-Day via Bulkimart delivery' : '📦 Regular delivery'}
                </span>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0', lineHeight: 1.5 }}>
            Delivery arranged after store acceptance. All delivery charges are included in your bill and will not add a customer charge.
          </p>
        </div>}

        {/* Payment Methods selection */}
        <div className="profile-menu-card checkout-payment-section" style={{ padding: 16 }}>
          <h2 className="checkout-section-title">Payment method</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* NHCONE Real Money Wallet */}
            <label className={`checkout-selection checkout-payment${paymentMethod === 'wallet' ? ' is-selected' : ''}`}
              style={{ 
                display: isDigitalCart ? 'none' : 'flex',
                gap: 12, 
                padding: 12, 
                borderRadius: 10, 
                border: `1.5px solid ${paymentMethod === 'wallet' ? 'var(--primary)' : 'var(--border-color)'}`,
                background: paymentMethod === 'wallet' ? 'var(--primary-light)' : '#fff',
                cursor: walletBalance >= grandTotalVal ? 'pointer' : 'not-allowed',
                alignItems: 'center',
                opacity: walletBalance >= grandTotalVal ? 1 : 0.85
              }}
            >
              <input 
                type="radio" 
                name="payment_method"
                checked={paymentMethod === 'wallet'}
                onChange={() => {
                  if (walletBalance >= grandTotalVal) setPaymentMethod('wallet');
                }}
                disabled={walletBalance < grandTotalVal}
                style={{ cursor: walletBalance >= grandTotalVal ? 'pointer' : 'not-allowed' }}
              />
              <div className="checkout-wallet-content" style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 20 }}>💰</span>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'block' }}>
                      Bulkimart Wallet
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Available Balance: ₹{Number(walletBalance || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
                {walletBalance >= grandTotalVal ? (
                  <span style={{ fontSize: 11, fontWeight: 800, color: '#16a34a', backgroundColor: '#f0fdf4', padding: '2px 8px', borderRadius: 12 }}>
                    ✓ Sufficient Balance
                  </span>
                ) : (
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: '#dc2626', backgroundColor: '#fef2f2', padding: '2px 8px', borderRadius: 12 }}>
                    ⚠ Need ₹{(grandTotalVal - walletBalance).toFixed(2)} more
                  </span>
                )}
              </div>
            </label>

            {/* Cash on Delivery */}
            <label className={`checkout-selection checkout-payment${paymentMethod === 'Cash on Delivery' ? ' is-selected' : ''}`}
              style={{ 
                display: isDigitalCart ? 'none' : 'flex',
                gap: 12, 
                padding: 12, 
                borderRadius: 10, 
                border: `1.5px solid ${paymentMethod === 'Cash on Delivery' ? 'var(--primary)' : 'var(--border-color)'}`,
                background: paymentMethod === 'Cash on Delivery' ? 'var(--primary-light)' : '#fff',
                cursor: 'pointer',
                alignItems: 'center'
              }}
            >
              <input 
                type="radio" 
                name="payment_method"
                checked={paymentMethod === 'Cash on Delivery'}
                onChange={() => setPaymentMethod('Cash on Delivery')}
                style={{ cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 20 }}>💵</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'block' }}>Cash on Delivery (COD)</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Pay at your doorstep on delivery</span>
                </div>
              </div>
            </label>

            {/* Online Payment */}
            <label className={`checkout-selection checkout-payment${paymentMethod === 'Online Payment' ? ' is-selected' : ''}`}
              style={{ 
                display: 'flex', 
                gap: 12, 
                padding: 12, 
                borderRadius: 10, 
                border: `1.5px solid ${paymentMethod === 'Online Payment' ? 'var(--primary)' : 'var(--border-color)'}`,
                background: paymentMethod === 'Online Payment' ? 'var(--primary-light)' : '#fff',
                cursor: 'pointer',
                alignItems: 'center'
              }}
            >
              <input 
                type="radio" 
                name="payment_method"
                checked={paymentMethod === 'Online Payment'}
                onChange={() => setPaymentMethod('Online Payment')}
                style={{ cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 20 }}>💳</span>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'block' }}>Razorpay Online Payment</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>UPI, cards and supported payment methods via Razorpay</span>
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Promo Coupons section */}
        {!isUnified && <div className="profile-menu-card" style={{ padding: 16 }}>
          <h2 className="checkout-section-title">Coupons & offers</h2>
          <CouponThresholdProgress offers={availableCoupons} appliedCode={appliedCoupon?.code} onShopMore={shopMoreForCoupon} />
          {couponNotice && <p role="status" className="coupon-cart-notice">{couponNotice}</p>}

          {!appliedCoupon && (
            <form className="checkout-coupon-form" onSubmit={handleApplyCoupon} style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                placeholder="Enter coupon code"
                value={couponInput}
                onChange={(e) => {
                  setCouponInput(e.target.value.toUpperCase());
                  setCouponMessage(null);
                }}
                disabled={applying}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '10px 14px',
                  border: '1.5px solid var(--border-color)',
                  borderRadius: 8,
                  fontSize: 13,
                  outline: 'none',
                  fontFamily: "'Outfit', sans-serif"
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '10px 20px',
                  background: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                {applying ? 'Checking…' : 'Apply'}
              </button>
            </form>
          )}

          {!appliedCoupon && (
            <>
              <button
                type="button"
                onClick={() => setShowOffers((v) => !v)}
                style={{
                  marginTop: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'var(--primary)', fontWeight: 700, fontSize: 12, fontFamily: "'Outfit', sans-serif"
                }}
              >
                {showOffers ? 'Hide offers' : 'View available offers'}
              </button>

              {showOffers && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {availableCoupons.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No offers available right now.</div>
                  )}
                  {availableCoupons.map((c) => (
                    <div key={c.code}
                      style={{
                        padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border-color)',
                        opacity: c.applicable ? 1 : 0.62
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: 12.5, letterSpacing: 0.5 }}>{c.code}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.title}</div>
                        </div>
                        {c.applicable ? (
                          <button
                            type="button"
                            onClick={async () => {
                              const r = await applyCoupon(c.code);
                              setCouponMessage(r.message);
                              setCouponMessageType(r.success ? 'success' : 'error');
                              if (r.success) setShowOffers(false);
                            }}
                            style={{
                              padding: '6px 14px', background: 'var(--primary)', color: '#fff', border: 'none',
                              borderRadius: 6, fontWeight: 700, fontSize: 11.5, cursor: 'pointer'
                            }}
                          >
                            {c.freeShipping ? 'Free delivery' : `Save ₹${c.savingNow}`}
                          </button>
                        ) : (
                          <span style={{ fontSize: 10.5, color: 'var(--text-muted)', maxWidth: 160, textAlign: 'right' }}>
                            {c.reason}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {appliedCoupon && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--primary-light)', border: '1px dashed var(--primary)', borderRadius: 8 }}>
              <div>
                <span style={{ fontWeight: 800, color: 'var(--primary)', fontSize: 13 }}>{appliedCoupon.code}</span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 8 }}>({appliedCoupon.title || appliedCoupon.code} Applied)</span>
              </div>
              <button
                onClick={removeCoupon}
                style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
              >
                Remove
              </button>
            </div>
          )}

          {couponMessage && (
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 8, color: couponMessageType === 'success' ? 'var(--primary)' : 'var(--error)' }}>
              {couponMessageType === 'success' ? '✓' : '⚠'} {couponMessage}
            </div>
          )}

          {availableCoupons.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, overflowX: 'auto', paddingBottom: 4 }}>
              {availableCoupons.map(coupon => (
                <button
                  key={coupon.code}
                  type="button"
                  onClick={() => {
                    setCouponInput(coupon.code);
                    setCouponMessage(null);
                  }}
                  style={{
                    padding: '4px 10px',
                    background: 'var(--bg-page)',
                    border: '1.5px dashed var(--primary-light)',
                    borderRadius: 20,
                    fontSize: 11,
                    fontWeight: 600,
                    color: 'var(--primary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {coupon.code} ({coupon.discountType === 'free_shipping' ? 'Free delivery' : coupon.discountType === 'percentage' ? `${coupon.value}% Off` : `₹${coupon.value} Off`})
                </button>
              ))}
            </div>
          )}
        </div>}
        {isUnified && <div className="profile-menu-card" style={{ padding: 16 }}><p>Coupons and Coins are available only in eligible single retail checkout.</p>{(appliedCoupon || couponCode) && <button className="cart-secondary-btn" onClick={removeCoupon}>Remove retail coupon to continue</button>}</div>}


        {/*
          NHCONE Coins — server-calculated only. `serverCart.coins` comes
          straight from GET /api/cart (cart.controller.js::shape()); nothing
          here computes eligibility, the cap, or the discount itself.

          Hidden for the unified (multi-seller, several-deliveries) basket —
          Coins redemption is only wired into the single-channel checkout
          that produces `serverCart` (order.controller.js::createOrder), not
          the unified/grouped one, so showing the toggle there would offer
          something checkout can't actually apply.
        */}
        {!isUnified && serverCart?.coins && (
          <div className="profile-menu-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🪙</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>Bulkimart Coins</p>
                <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  Available: {serverCart.coins.availableCoins} Coins
                </p>
              </div>
            </div>

            {!serverCart.coins.eligibleForCoins ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                Coins can be used on orders of ₹500 or more.
              </p>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={useCoinsSelected}
                  onChange={(e) => toggleUseCoins(e.target.checked)}
                  disabled={serverCart.coins.availableCoins <= 0}
                  style={{ width: 16, height: 16 }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {serverCart.coins.availableCoins <= 0
                    ? 'You have no Coins yet'
                    : useCoinsSelected && serverCart.coins.coinsToUse > 0
                      ? `Using ${serverCart.coins.coinsToUse} Coins — you're saving ₹${serverCart.coins.coinDiscount}`
                      : `Use Coins — save up to ₹${serverCart.coins.maxCoinsAllowed}`}
                </span>
              </label>
            )}
          </div>
        )}

        {/* Tip your delivery partner */}
        {canTip && Boolean(tipSetting?.isEnabled) && (tipOptions.length > 0 || tipSetting?.allowCustom) && (
          <div className="profile-menu-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🛵</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.35 }}>
                  {tipSetting?.title || 'Tip your delivery partner'}
                </p>
                <p style={{ margin: '3px 0 0', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  {tipSetting?.subtitle || "100% of your tip goes to them. We don't take a cut."}
                </p>
              </div>
            </div>

            {/* Tip preset chips + Other option */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {tipOptions.map((amt) => {
                const isSelected = tipChip === amt;
                return (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => {
                      setTipChip((prev) => (prev === amt ? null : amt));
                      setTipCustomInput('');
                      setIsCustomTip(false);
                    }}
                    style={{
                      padding: '7px 15px',
                      borderRadius: 999,
                      fontSize: 12.5,
                      fontWeight: 800,
                      cursor: 'pointer',
                      border: isSelected ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                      background: isSelected ? 'var(--primary)' : '#fff',
                      color: isSelected ? '#fff' : 'var(--text-primary)',
                      boxShadow: isSelected ? '0 2px 8px rgba(16, 185, 129, 0.25)' : 'none',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    ₹{amt}
                  </button>
                );
              })}

              {Boolean(tipSetting?.allowCustom ?? true) && (
                <button
                  type="button"
                  onClick={() => {
                    if (isCustomTip) {
                      setIsCustomTip(false);
                      setTipCustomInput('');
                      setTipChip(null);
                    } else {
                      setIsCustomTip(true);
                      setTipChip(null);
                      setTimeout(() => {
                        tipInputRef.current?.focus();
                      }, 50);
                    }
                  }}
                  style={{
                    padding: '7px 16px',
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: 800,
                    cursor: 'pointer',
                    border: isCustomTip ? '1.5px solid var(--primary)' : '1.5px solid var(--border-color)',
                    background: isCustomTip ? 'var(--primary)' : '#fff',
                    color: isCustomTip ? '#fff' : 'var(--text-primary)',
                    boxShadow: isCustomTip ? '0 2px 8px rgba(16, 185, 129, 0.25)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{isCustomTip && validCustomTip > 0 ? `₹${validCustomTip}` : 'Other'}</span>
                  {!isCustomTip && <span style={{ fontSize: 13, opacity: 0.7 }}>+</span>}
                </button>
              )}
            </div>

            {/* Custom Tip Input Form — activated when user clicks 'Other' */}
            {isCustomTip && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1.5px solid var(--border-color, #e2e8f0)',
                  borderRadius: 12,
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
                    Enter Custom Tip:
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                    ₹{minCustomTip} – ₹{maxCustomTip}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: '#fff',
                      border: customTipError ? '1.5px solid var(--error, #ef4444)' : '1.5px solid var(--primary)',
                      borderRadius: 10,
                      padding: '6px 12px',
                      flex: 1,
                      maxWidth: 220,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}
                  >
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-secondary)', marginRight: 4 }}>₹</span>
                    <input
                      ref={tipInputRef}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={tipCustomInput}
                      onChange={(e) => {
                        const digitsOnly = e.target.value.replace(/\D/g, '');
                        setTipCustomInput(digitsOnly);
                      }}
                      onWheel={(e) => e.target.blur()}
                      placeholder={`e.g. 35`}
                      style={{
                        width: '100%',
                        border: 'none',
                        outline: 'none',
                        fontSize: 13.5,
                        fontWeight: 700,
                        color: 'var(--text-primary)',
                        background: 'transparent',
                      }}
                    />
                    {tipCustomInput && (
                      <button
                        type="button"
                        onClick={() => setTipCustomInput('')}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: '0 2px',
                          cursor: 'pointer',
                          color: 'var(--text-muted)',
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                        title="Clear amount"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {customTipError && (
                  <p style={{ margin: 0, fontSize: 11.5, fontWeight: 600, color: 'var(--error, #ef4444)' }}>
                    ⚠ {customTipError}
                  </p>
                )}
              </div>
            )}

            {tipAmount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                  ✓ ₹{tipAmount} tip added — 100% goes to your delivery partner.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setTipChip(null);
                    setTipCustomInput('');
                    setIsCustomTip(false);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: 11.5,
                    fontWeight: 700,
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  Remove tip
                </button>
              </div>
            )}
          </div>
        )}



        {/* Quick Commerce Partner / Store Details Card */}
        {isQuickCommerceCart && (
          <div className="profile-menu-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 20 }}>🏪</span>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Store & Seller Details
                  </span>
                  <span style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--primary)', marginTop: 1 }}>
                    ⚡ Quick Commerce Delivery
                  </span>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: 'var(--primary-light, #ebfdf2)', color: 'var(--primary, #1b7a37)' }}>
                Fulfilling Partner
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Seller / Store Name */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 16 }}>🏬</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Store Name</span>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>
                    {quickCommerceSeller?.name || 'Local Partner Store'}
                  </span>
                </div>
              </div>

              {/* Seller Phone / Contact */}
              {quickCommerceSeller?.phone ? (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📞</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Contact Number</span>
                    <a
                      href={`tel:${quickCommerceSeller.phone}`}
                      style={{ fontSize: 13, fontWeight: 800, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                      <span>+91 {quickCommerceSeller.phone}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>• Call Store</span>
                    </a>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 16 }}>📞</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Contact Number</span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      Available via live delivery partner
                    </span>
                  </div>
                </div>
              )}

              {/* Store Address */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ fontSize: 16 }}>📍</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block' }}>Store Pickup Address</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {quickCommerceSeller?.address || quickCommerceSeller?.city || 'Local Store Hub, Service Area'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        </div>
        <aside className="checkout-summary-column" aria-label="Order summary">
          <details className="checkout-order-review" open>
            <summary><span>Review your items <small>{basketItems.length} {basketItems.length === 1 ? 'item' : 'items'}</small></span><span aria-hidden="true">⌄</span></summary>
            {groups.length > 0 ? <BasketGroups groups={groups} showTotals={false} busy={isOrdering} /> : <p className="basket-note">Your items will appear after the basket loads.</p>}
          </details>
        {/* Bill Invoice Details Section */}
        <div className="profile-menu-card checkout-bill" style={{ padding: 16 }}>
          <h2 className="checkout-section-title">Payment summary</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Items Subtotal</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₹{subtotalVal}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
              <span>Delivery Charges</span>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {deliveryChargeVal === 0 ? (
                  <span style={{ color: 'var(--primary)' }}>FREE</span>
                ) : `₹${deliveryChargeVal}`}
              </span>
            </div>

            {sameDayPremiumVal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                <span>Same-Day Delivery Premium</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₹{sameDayPremiumVal}</span>
              </div>
            )}

            {couponDiscountVal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)', fontWeight: 600 }}>
                <span>Coupon Discount</span>
                <span>-₹{couponDiscountVal}</span>
              </div>
            )}

            {coinDiscountVal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)', fontWeight: 600 }}>
                <span>Bulkimart Coins ({serverCart.coins.coinsToUse} used)</span>
                <span>-₹{coinDiscountVal}</span>
              </div>
            )}

            {tipAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)', fontWeight: 700 }}>
                <span>Delivery Partner Tip</span>
                <span>+₹{tipAmount}</span>
              </div>
            )}

            <div style={{ borderTop: '1.5px dashed var(--border-color)', paddingTop: 12, marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 800 }}>
              <span style={{ color: 'var(--text-primary)' }}>Total Amount to Pay</span>
              <span style={{ color: 'var(--primary)' }}>₹{grandTotalVal}</span>
            </div>
          </div>
        </div>



        {errorBanner}

        {/* Checkout CTA Bar */}
        <div className="checkout-cta-bar">
          <button type="button" className="checkout-payable" onClick={() => setShowBillBreakdown(prev => !prev)} aria-expanded={showBillBreakdown} aria-label="View payable amount breakdown">
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>Payable Amount</span>
              <span style={{ fontSize: 9 }}>▲</span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--primary)' }}>₹{grandTotalVal}</div>
          </button>

          {/* Wait for authoritative basket pricing, without requiring a carrier. */}
          <button
            className="pd-add-to-cart-btn"
            onClick={handlePlaceOrder}
            disabled={isOrdering || cartLoading || checkoutBlocked || recoveryRequired}
            style={{ opacity: (isOrdering || cartLoading || checkoutBlocked || recoveryRequired) ? 0.5 : 1 }}
          >
            {isOrdering ? 'Placing order…'
              : cartLoading ? 'Updating…'
              : 'Confirm & Place Order'}
          </button>
        </div>
        </aside>
      </div>

      {/* Portal keeps the breakdown visible above the scrolling page and action. */}
      {showBillBreakdown && (
        <ModalPortal className="checkout-breakdown-overlay" onClick={event => { if (event.target === event.currentTarget) setShowBillBreakdown(false); }} onKeyDown={event => { if (event.key === 'Escape') setShowBillBreakdown(false); }}>
          {/* Bottom Sheet Drawer */}
          <div className="checkout-breakdown-sheet" role="dialog" aria-modal="true" aria-label="Bill invoice and items" style={{
            background: '#fff',
            borderTopLeftRadius: '16px',
            borderTopRightRadius: '16px',
            padding: '20px 16px 40px 16px',
            zIndex: 1000,
            boxShadow: '0 -8px 24px rgba(0,0,0,0.15)',
            maxHeight: '80%',
            overflowY: 'auto',
            animation: 'slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: 'var(--text-primary)' }}>
                Bill Invoice & Items
              </span>
              <button 
                type="button"
                aria-label="Close bill breakdown"
                onClick={() => setShowBillBreakdown(false)}
                style={{
                  background: 'var(--bg-page)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: 'var(--text-secondary)'
                }}
              >
                ✕
              </button>
            </div>

            {/* Items List */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.3 }}>
                Ordered Items ({items.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {items.map((item, idx) => (
                  <div key={item._id || item.productId || idx} style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5, color: 'var(--text-primary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>{item.qty}x {item.name}</span>
                      <span style={{ fontWeight: 700 }}>₹{item.lineTotal}</span>
                    </div>
                    {item.additionalMessage && (
                      <div style={{ fontSize: 11, color: 'var(--primary)', fontStyle: 'italic', paddingLeft: 8 }}>
                        📝 Seller message: "{item.additionalMessage}"
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Invoice Breakdown */}
            <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: 16 }}>
              <div style={{ fontWeight: 800, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 12, letterSpacing: 0.3 }}>
                Payment Breakdown
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Items Subtotal</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₹{subtotalVal}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                  <span>Delivery Charges</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {deliveryChargeVal === 0 ? (
                      <span style={{ color: 'var(--primary)' }}>FREE</span>
                    ) : `₹${deliveryChargeVal}`}
                  </span>
                </div>
                {sameDayPremiumVal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                    <span>Same-Day Delivery Premium</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>₹{sameDayPremiumVal}</span>
                  </div>
                )}
                {couponDiscountVal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)', fontWeight: 600 }}>
                    <span>Coupon Discount</span>
                    <span>-₹{couponDiscountVal}</span>
                  </div>
                )}

                {coinDiscountVal > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Bulkimart Coins</span><span>−₹{coinDiscountVal}</span></div>}

                {tipAmount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--primary)', fontWeight: 700 }}>
                    <span>Delivery Partner Tip</span>
                    <span>+₹{tipAmount}</span>
                  </div>
                )}
                <div style={{ borderTop: '1.5px solid var(--border-color)', paddingTop: 12, marginTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 900 }}>
                  <span style={{ color: 'var(--text-primary)' }}>Payable Amount</span>
                  <span style={{ color: 'var(--primary)' }}>₹{grandTotalVal}</span>
                </div>
              </div>
            </div>
          </div>
          <style>{`
            @keyframes slideUp {
              from { transform: translateY(100%); }
              to { transform: translateY(0); }
            }
            @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
        </ModalPortal>
      )}

    </div>
  );
};

export default CheckoutPage;

