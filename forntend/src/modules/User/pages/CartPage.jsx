import React, { useState, useEffect } from 'react';
import { useUser } from '../context/UserContext';
import { UnifiedCartGroups } from '../components/UnifiedCartGroups';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import { apiUrl } from '../../../utils/api';

const CartPage = () => {
  const {
    getCartItems,
    setCartItemQty,
    deleteCartItem,
    getCartWarnings,
    cartLoading,
    getCartSubtotal,
    getDeliveryCharge,
    getCouponDiscount,
    getCartTotal,
    addToCart,
    removeFromCart,
    appliedCoupon,
    applyCoupon,
    availableCoupons,
    fetchAvailableCoupons,
    couponCode,
    removeCoupon,
    setActiveNav,
    serverCart,
    cartChannel,
    deliveryMode,
    setDeliveryMode,
    getDeliveryPoint,
    addToWishlist,
  } = useUser();

  const [couponInput, setCouponInput] = useState('');
  const [couponMessage, setCouponMessage] = useState(null);
  const [couponMessageType, setCouponMessageType] = useState('success'); // 'success' | 'error'

  /**
   * The item pending a remove decision — set by the trash icon, resolved
   * by one of the two buttons in the confirm sheet below. Plain "Remove"
   * never touches the wishlist; "Move to Wishlist" always adds first (not
   * a toggle — an already-wishlisted item must not be un-wishlisted by
   * this) and only removes the cart line once that succeeds, so a failed
   * wishlist add can never lose the item from both places at once.
   */
  const [removeCandidate, setRemoveCandidate] = useState(null);
  const [movingToWishlist, setMovingToWishlist] = useState(false);

  // Additional seller message modal state
  const [activeMessageItem, setActiveMessageItem] = useState(null);
  const [messageText, setMessageText] = useState('');
  const [savingMessage, setSavingMessage] = useState(false);
  const [savingError, setSavingError] = useState('');

  const openMessageModal = (item) => {
    setActiveMessageItem(item);
    setMessageText(item.additionalMessage || '');
    setSavingError('');
  };

  const handleSaveMessage = async () => {
    if (!activeMessageItem) return;
    setSavingMessage(true);
    setSavingError('');
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch(apiUrl('/api/cart/items/' + activeMessageItem._id + '/message'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ additionalMessage: messageText }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setActiveMessageItem(null);
        await unified.reload();
      } else {
        setSavingError(data.message || 'Unable to save message. Please try again.');
      }
    } catch (err) {
      setSavingError(err.message || 'Unable to save message. Please try again.');
    } finally {
      setSavingMessage(false);
    }
  };

  const removeMessage = async (itemId) => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/cart/items/' + itemId + '/message'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ additionalMessage: '' }),
      });
      if (res.ok) {
        await unified.reload();
      }
    } catch (err) {
      console.error('Error removing item message:', err);
    }
  };

  const confirmPlainRemove = () => {
    removeLine(removeCandidate._id);
    setRemoveCandidate(null);
  };

  const confirmMoveToWishlist = async () => {
    setMovingToWishlist(true);
    const r = await addToWishlist(removeCandidate.productId);
    setMovingToWishlist(false);
    if (!r.ok) {
      alert(r.message || 'Could not save this to your wishlist — it is still in your cart.');
      return;
    }
    await removeLine(removeCandidate._id);
    setRemoveCandidate(null);
  };

  /**
   * One basket, whatever it is made of.
   *
   * `getCartItems()` returns the ACTIVE CHANNEL's cart, which is why a basket
   * holding a Quick item and a Shop All item only ever listed one of them. The
   * unified read already knows about every channel, so the list comes from
   * there; the per-channel cart stays exactly as it is underneath, and is still
   * what a single-storefront basket falls back to while the unified read loads.
   */
  const unified = useUnifiedCart(getDeliveryPoint ? getDeliveryPoint() : null);
  const channelItems = getCartItems();
  const cartItems = unified.data ? unified.basketItems : channelItems;

  // Money is the server's, per group and in total — never worked out here.
  const unifiedTotals = unified.data?.totals || null;
  const subtotal = unifiedTotals ? unifiedTotals.subtotal : getCartSubtotal();
  const deliveryCharge = unifiedTotals ? unifiedTotals.deliveryCharge : getDeliveryCharge();
  const couponDiscount = getCouponDiscount();
  const total = unifiedTotals ? unifiedTotals.totalAmount : getCartTotal();
  // Delivery is only decided (and added) on the Fulfillment Checkout page,
  // so what's shown as payable here excludes it — nothing is charged upfront.
  const payableBeforeDelivery = Math.max(0, Math.round((total - deliveryCharge) * 100) / 100);

  /**
   * A cart edit changes a group's price and can even dissolve the group, so the
   * unified read has to happen again — but once per action, not once per item.
   */
  const afterEdit = async (promise) => { const r = await promise; await unified.reload(); return r; };
  const bumpQty = (itemId, qty) => afterEdit(setCartItemQty(itemId, qty));
  const dropOne = (itemId, qty) => afterEdit(removeFromCart(itemId, qty));
  const removeLine = (itemId) => afterEdit(deleteCartItem(itemId));

  const changeItemDeliveryMode = async (itemId, mode) => {
    const token = localStorage.getItem('userToken');
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/cart/' + itemId), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ deliveryMode: mode })
      });
      if (res.ok) {
        setDeliveryMode(mode);
        await unified.reload();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(errData.message || 'Failed to update delivery option');
      }
    } catch (err) {
      console.error("Error setting item delivery mode:", err);
    }
  };

  const deliveryOptions = serverCart?.deliveryOptions || null;
  const ecomGroup = unified.data?.groups?.find(g => g.channel === 'ecommerce');
  const sameDay = ecomGroup ? ecomGroup.sameDayOption : (deliveryOptions?.sameDay || null);
  const isEcom = cartChannel === 'ecommerce';
  const sameDayOffered = Boolean(isEcom && sameDay?.available);


  const needsChoice = cartItems.some(item => {
    if (item.channel !== 'ecommerce') return false;
    const group = unified.data?.groups?.find(g => g.key === item.groupKey);
    const sameDayAvailable = group?.sameDayOption?.available === true;
    return sameDayAvailable && !item.deliveryMode;
  });

  const standardFee = serverCart?.pricing?.standardFee || 0;
  const sameDayFee = serverCart?.pricing?.sameDayFee || 0;
  const sameDayIncentive = serverCart?.pricing?.sameDayIncentive || 0;

  const sameDayPremiumVal = unifiedTotals 
    ? (unifiedTotals.sameDayPremium || 0) 
    : (deliveryMode === 'same_day' ? (sameDayFee + sameDayIncentive) : 0);

  const standardDeliveryChargeVal = unifiedTotals
    ? Math.max(0, (unifiedTotals.deliveryCharge || 0) - (unifiedTotals.sameDayPremium || 0))
    : (deliveryMode === 'same_day' ? standardFee : deliveryCharge);

  const [applying, setApplying] = useState(false);
  const [showOffers, setShowOffers] = useState(false);

  const handleApplyCoupon = async (e) => {
    e.preventDefault();
    if (!couponInput.trim() || applying) return;

    setApplying(true);
    // The server checks the code against the live cart and returns the real
    // saving — this never calculates a discount itself.
    const res = await applyCoupon(couponInput.trim());
    setApplying(false);

    setCouponMessage(res.message);
    setCouponMessageType(res.success ? 'success' : 'error');
    if (res.success) setCouponInput('');
  };

  // Offers are fetched with the cart in context, so each one can say whether it
  // is usable right now and why not if it is not.
  useEffect(() => {
    fetchAvailableCoupons();
  }, [fetchAvailableCoupons]);

  return (
    <div className="cart-page-container" style={{ fontFamily: "'Outfit', sans-serif", paddingBottom: 40 }}>
      {/* Header bar */}
      <div className="profile-header-gradient" style={{ padding: '16px 16px 24px', background: 'var(--header-bg)' }}>
        <div className="profile-header-top" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            className="back-arrow-white"
            onClick={() => setActiveNav('home')}
            aria-label="Go to Home"
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>
          <h2 className="profile-title" style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 800 }}>Shopping Cart</h2>
          <div style={{ width: 24 }}></div>
        </div>
      </div>

      {cartItems.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
          <div style={{ fontSize: 54, opacity: 0.5 }}>🛒</div>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Your Cart is Empty</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', maxWidth: 280, lineHeight: 1.5 }}>
            Explore local products, fresh groceries, organic items, and traditional handicrafts.
          </p>
          <button
            className="pd-add-to-cart-btn"
            onClick={() => setActiveNav('home')}
            style={{ width: 'auto', padding: '12px 28px', marginTop: 12 }}
          >
            Start Shopping
          </button>
        </div>
      ) : (
        <div style={{ padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 16 }}>


          {/* Cart Items List */}
          <div className="profile-menu-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', fontWeight: 800, fontSize: 13, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.3 }}>
              Items in Cart ({cartItems.length})
            </div>

            {getCartWarnings().length > 0 && (
              <div style={{
                margin: '0 0 12px', padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 1.6,
                background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.4)'
              }}>
                {getCartWarnings().map((w) => <div key={w}>• {w}</div>)}
              </div>
            )}

            {cartItems.map(item => (
              <div key={item._id} style={{ display: 'flex', gap: 12, padding: 16, borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
                <img
                  src={item.image}
                  alt={item.name}
                  style={{ width: 52, height: 52, borderRadius: 8, border: '1px solid var(--border-color)', objectFit: 'cover' }}
                />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <h4 style={{ margin: '0 0 4px 0', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.name}
                  </h4>
                  {item.variantName && <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>{item.variantName}</span>}
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block' }}>
                    {item.category ? item.category + ' • ' : ''}₹{item.price}/{item.unit || 'pcs'}
                  </span>
                  {/* Which basket this came from, and how it is getting here.
                      Quick has one way of arriving, so it says only that. */}
                  {item.channel && (() => {
                    const group = unified.data?.groups?.find(g => g.key === item.groupKey);
                    const sameDayAvailable = group?.sameDayOption?.available === true;

                    if (item.channel === 'ecommerce' && sameDayAvailable) {
                      return (
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                            Delivery Option:
                          </span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => changeItemDeliveryMode(item._id, 'scheduled')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                border: `1.5px solid ${item.deliveryMode === 'scheduled' ? 'var(--primary)' : 'var(--border-color)'}`,
                                background: item.deliveryMode === 'scheduled' ? 'var(--primary-light)' : 'transparent',
                                color: item.deliveryMode === 'scheduled' ? 'var(--primary)' : 'var(--text-secondary)',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              📦 Scheduled
                            </button>
                            <button
                              type="button"
                              onClick={() => changeItemDeliveryMode(item._id, 'same_day')}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '8px',
                                fontSize: '11px',
                                fontWeight: 700,
                                cursor: 'pointer',
                                border: `1.5px solid ${item.deliveryMode === 'same_day' ? 'var(--primary)' : 'var(--border-color)'}`,
                                background: item.deliveryMode === 'same_day' ? 'var(--primary-light)' : 'transparent',
                                color: item.deliveryMode === 'same_day' ? 'var(--primary)' : 'var(--text-secondary)',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              ⚡ Same-day
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'block', marginTop: 2 }}>
                        {item.channel === 'grocery'
                          ? '⚡ Quick Commerce'
                          : `${item.sellerName || 'Shop All'} · ${
                              item.deliveryMode === 'same_day' ? '⚡ Same-Day'
                              : item.modeChosen ? '📦 Scheduled' : 'Choose delivery'}`}
                      </span>
                    );
                  })()}

                  {/* Additional message for seller */}
                  {item.additionalMessage ? (
                    <div style={{
                      marginTop: 8, padding: '6px 10px', borderRadius: 8,
                      background: 'rgba(37, 99, 235, 0.04)', border: '1px dashed rgba(37, 99, 235, 0.3)',
                      fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          📝 Message added
                        </span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => openMessageModal(item)}
                            style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => removeMessage(item._id)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', wordBreak: 'break-word' }}>
                        "{item.additionalMessage}"
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openMessageModal(item)}
                      style={{
                        marginTop: 6,
                        background: 'none',
                        border: 'none',
                        color: 'var(--primary)',
                        fontSize: 11,
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      + Add message for seller
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
                    ₹{item.lineTotal}
                  </span>

                  {/* Quantity controls */}
                  {item.fulfillmentType === 'digital' ? (
                    <span style={{ padding: '4px 9px', borderRadius: 999, background: '#e0f2fe', color: '#0369a1', fontSize: 9, fontWeight: 900 }}>DIGITAL</span>
                  ) : <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--primary-light)', borderRadius: 20, padding: '2px 8px', border: '1px solid var(--border-color)' }}>
                    <button
                      onClick={() => dropOne(item._id, item.qty)}
                      style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 800, fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                      aria-label="Decrease quantity"
                    >
                      -
                    </button>
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', minWidth: 14, textAlign: 'center' }}>
                      {item.qty}
                    </span>
                    <button
                      onClick={() => bumpQty(item._id, item.qty + 1)}
                      style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 800, fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>}
                </div>

                {/* Remove button — opens the Remove/Move-to-Wishlist choice below */}
                <button
                  onClick={() => setRemoveCandidate(item)}
                  style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer', padding: 4 }}
                  aria-label="Remove item"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            ))}
          </div>


          {/* Checkout CTA Bar */}
          <div style={{
            position: 'sticky',
            bottom: 0,
            margin: '0 -16px -16px -16px',
            background: '#fff',
            borderTop: '1.5px solid var(--border-color)',
            boxShadow: '0 -4px 10px rgba(0,0,0,0.06)',
            padding: '12px 16px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            zIndex: 100
          }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Payable Total</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--primary)' }}>₹{payableBeforeDelivery}</div>
            </div>

            {needsChoice ? (
              <button
                className="pd-add-to-cart-btn"
                disabled={true}
                style={{
                  width: 'auto',
                  padding: '12px 36px',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  opacity: 0.5,
                  cursor: 'not-allowed',
                  backgroundColor: '#94a3b8'
                }}
              >
                <span>Choose delivery</span>
              </button>
            ) : (
              <button
                className="pd-add-to-cart-btn"
                onClick={() => setActiveNav('checkout')}
                style={{ width: 'auto', padding: '12px 36px', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}
              >
                <span>Proceed to Checkout</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </button>
            )}
          </div>

        </div>
      )}

      {/* Remove / Move-to-Wishlist choice */}
      {removeCandidate && (
        <div
          onClick={() => !movingToWishlist && setRemoveCandidate(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: '20px 20px 0 0', padding: 22, boxSizing: 'border-box' }}
          >
            <p style={{ margin: '0 0 4px', fontSize: 14.5, fontWeight: 800, color: '#0f172a' }}>Remove from Cart?</p>
            <p style={{ margin: '0 0 18px', fontSize: 12.5, color: '#64748b' }}>{removeCandidate.name}</p>

            <button
              onClick={confirmMoveToWishlist}
              disabled={movingToWishlist}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', marginBottom: 10,
                background: movingToWishlist ? '#94a3b8' : 'var(--primary)', color: '#fff',
                fontSize: 13, fontWeight: 900, cursor: movingToWishlist ? 'not-allowed' : 'pointer',
              }}
            >
              {movingToWishlist ? 'Moving…' : '♡ Move to Wishlist'}
            </button>

            <button
              onClick={confirmPlainRemove}
              disabled={movingToWishlist}
              style={{
                width: '100%', padding: '13px 0', borderRadius: 12, border: '1.5px solid #fecaca', marginBottom: 10,
                background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 900,
                cursor: movingToWishlist ? 'not-allowed' : 'pointer',
              }}
            >
              Remove
            </button>

            <button
              onClick={() => setRemoveCandidate(null)}
              disabled={movingToWishlist}
              style={{ width: '100%', padding: '10px 0', border: 'none', background: 'none', color: '#64748b', fontSize: 12.5, fontWeight: 700, cursor: movingToWishlist ? 'not-allowed' : 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Additional Seller Message Modal / Bottom Sheet */}
      {activeMessageItem && (
        <div
          onClick={() => !savingMessage && setActiveMessageItem(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 440, background: '#ffffff', borderRadius: 16,
              padding: 20, boxSizing: 'border-box', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
            }}
          >
            <h3 style={{ margin: '0 0 4px 0', fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
              Additional Message
            </h3>
            <p style={{ margin: '0 0 14px 0', fontSize: 12, color: '#64748b' }}>
              Add an optional message or instruction for the seller regarding <strong>{activeMessageItem.name}</strong>.
            </p>

            <textarea
              rows={4}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value.slice(0, 500))}
              placeholder="Please pack this product separately..."
              style={{
                width: '100%', padding: 12, borderRadius: 10, border: '1px solid #cbd5e1',
                fontSize: 13, color: '#0f172a', resize: 'none', outline: 'none',
                boxSizing: 'border-box', fontFamily: 'inherit'
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: messageText.length >= 500 ? '#ef4444' : '#94a3b8' }}>
                {messageText.length} / 500
              </span>
            </div>

            {savingError && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                {savingError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => setActiveMessageItem(null)}
                disabled={savingMessage}
                style={{
                  padding: '9px 18px', borderRadius: 8, border: '1px solid #cbd5e1',
                  background: '#ffffff', color: '#475569', fontSize: 13, fontWeight: 700, cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMessage}
                disabled={savingMessage}
                style={{
                  padding: '9px 22px', borderRadius: 8, border: 'none',
                  background: 'var(--primary, #2563eb)', color: '#ffffff', fontSize: 13, fontWeight: 700,
                  cursor: savingMessage ? 'not-allowed' : 'pointer', opacity: savingMessage ? 0.7 : 1
                }}
              >
                {savingMessage ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CartPage;
