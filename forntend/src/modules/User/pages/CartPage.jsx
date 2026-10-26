import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import { CartEmptyState } from '../components/CartUI';
import { BasketGroups, BasketSummary } from '../components/BasketGroups';
import { apiUrl } from '../../../utils/api';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
import BrandLogo from '../../../components/BrandLogo';
import CouponThresholdProgress from '../components/CouponThresholdProgress';
import usePromotionNavigation from '../hooks/usePromotionNavigation';
import '../components/CartCheckout.css';

export default function CartPage() {
  const { getDeliveryPoint, setActiveNav, refreshCart, addToWishlist,
    couponCode, appliedCoupon, availableCoupons, removeCoupon, couponNotice, serverCart, cartChannel, switchCartChannel } = useUser();
  const navigate = usePromotionNavigation();
  const basket = useUnifiedCart(getDeliveryPoint?.(), couponCode, 'basket');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const focusedWholesale = useRef(false);
  const data = basket.data;
  const groups = data?.groups || [];
  const items = groups.flatMap(group => group.items);
  const digital = items.filter(item => item.fulfillmentType === 'digital');
  const mixedDigital = digital.length > 0 && digital.length !== items.length;
  const singleRetail = groups.length === 1 && groups[0].salesChannel !== 'wholesale';
  useEffect(() => {
    if (singleRetail && groups[0].channel !== cartChannel) switchCartChannel(groups[0].channel);
  }, [singleRetail, groups[0]?.channel, cartChannel, switchCartChannel]);
  const shopMore = offer => {
    if (offer.shopMore?.type === 'product') navigate({ type: 'PRODUCT', id: offer.shopMore.id });
    else if (offer.shopMore?.type === 'category') navigate({ type: 'CATEGORY', id: offer.shopMore.id, slug: offer.shopMore.id });
    else setActiveNav('categories');
  };
  useEffect(() => {
    if (focusedWholesale.current || typeof document === 'undefined' || !data) return;
    if (window.location.pathname === '/wholesale/cart' || new URLSearchParams(window.location.search).get('channel') === 'wholesale') {
      const section = document.getElementById('basket-wholesale');
      if (section) { section.scrollIntoView({ block: 'start' }); focusedWholesale.current = true; }
    }
  }, [data]);
  const mutate = async (path, method, body) => {
    if (lock.current || basket.loading) return;
    lock.current = true; setBusy(true); setError('');
    const session = captureUserSession();
    try {
      const response = await fetch(apiUrl(path), { method, headers: { Authorization: `Bearer ${localStorage.getItem('userToken') || ''}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const result = await response.json();
      if (!isCurrentUserSession(session)) return;
      if (!response.ok) throw new Error(result.message || 'Could not update your cart');
      await basket.reload();
      window.dispatchEvent(new Event('cart:changed'));
      refreshCart?.();
    } catch (err) { if (isCurrentUserSession(session)) setError(err.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const pathFor = (item, group) => `/api/cart/${group.salesChannel === 'wholesale' ? 'wholesale/' : ''}${item.itemId}`;
  const remove = (item, group) => mutate(pathFor(item, group), 'DELETE');
  return <section className="cart-page-container customer-basket" aria-label="Customer cart" aria-busy={busy || basket.loading}>
    <header className="basket-heading">
      <div className="basket-heading-inner"><BrandLogo variant="icon" /><div><span className="basket-brand-name">Bulkimart</span><h1>Shopping Cart</h1></div>
        <button type="button" className="cart-secondary-btn basket-continue" aria-label="Continue shopping" onClick={() => setActiveNav('home')}><span className="basket-continue-full">Continue shopping</span><span className="basket-continue-short" aria-hidden="true">Shop</span> <span aria-hidden="true">→</span></button>
      </div>
      <p>Quick Commerce, E-Commerce and Wholesale in one basket.</p>
    </header>
    <div className="basket-body">
      {(error || basket.error) && <div role="alert" className="wholesale-cart-alert">{error || basket.error} <button type="button" className="cart-secondary-btn" onClick={basket.reload} disabled={busy || basket.loading}>Refresh prices</button></div>}
      {basket.loading && !data && <div className="basket-loading" role="status"><span className="basket-loading-mark" aria-hidden="true" />Refreshing your basket…</div>}
      {data?.warnings?.map(message => <div role="alert" className="wholesale-cart-alert" key={message}>{message}</div>)}
      {!basket.loading && data && !items.length && <CartEmptyState onBrowse={() => setActiveNav('home')} />}
      {items.length > 0 && <>
        <div className="basket-tools" aria-label="Basket channels">{[...new Set(groups.map(group => group.salesChannel === 'wholesale' ? 'wholesale' : group.channel))].map(channel => <a key={channel} href={`#basket-${channel}`}>{channel === 'wholesale' ? 'Wholesale' : channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}</a>)}<button type="button" className="cart-secondary-btn" disabled={busy || basket.loading} onClick={basket.reload}>Refresh prices</button></div>
        {mixedDigital && <div role="alert" className="wholesale-cart-alert">Digital and physical products require separate checkout. Remove one type before ordering.</div>}
        <div className="basket-layout"><div className="basket-items-column">{groups.map((group, index) => <div key={group.key} id={groups.findIndex(other => (other.salesChannel === 'wholesale' ? 'wholesale' : other.channel) === (group.salesChannel === 'wholesale' ? 'wholesale' : group.channel)) === index ? `basket-${group.salesChannel === 'wholesale' ? 'wholesale' : group.channel}` : undefined}><BasketGroups groups={[group]} showTotals={groups.length > 1} busy={busy || basket.loading}
          onQuantity={(item, section, qty) => mutate(pathFor(item, section), 'PUT', { qty })}
          onRemove={remove}
          onMessage={(item, message) => mutate(`/api/cart/items/${item.itemId}/message`, 'PATCH', { additionalMessage: message })}
          onWishlist={async (item, section) => { const result = await addToWishlist(item.productId); if (result.ok) await remove(item, section); else setError(result.message); }}
          onMode={async (section, mode) => { const result = await basket.setGroupMode(section, mode); if (!result.ok) setError(result.message); }}
        /></div>)}</div>
        <aside className="basket-summary-column"><BasketSummary data={data} />{singleRetail && groups[0].channel === cartChannel && <>
          <CouponThresholdProgress offers={availableCoupons} appliedCode={appliedCoupon?.code} onShopMore={shopMore} />
          {couponNotice && <p role="status" className="coupon-cart-notice">{couponNotice}</p>}
          {appliedCoupon && <div className="coupon-cart-applied"><strong>{appliedCoupon.code} applied</strong><span>{serverCart.pricing?.couponFreeShipping ? 'Free delivery' : `Saved ₹${Number(serverCart.pricing?.couponDiscount || 0).toLocaleString('en-IN')}`}</span><button type="button" onClick={removeCoupon}>Remove</button></div>}
        </>}<button type="button" className="pd-add-to-cart-btn" disabled={busy || basket.loading || data.valid === false || mixedDigital || !data.totals} onClick={() => setActiveNav('checkout')}>Proceed to Checkout</button><p className="basket-summary-note">Review your delivery address and payment at checkout.</p></aside></div>
      </>}
    </div>
  </section>;
}
