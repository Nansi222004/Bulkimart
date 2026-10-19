import React, { useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { useUnifiedCart } from '../hooks/useUnifiedCart';
import { CartEmptyState } from '../components/CartUI';
import { BasketGroups, BasketSummary } from '../components/BasketGroups';
import { apiUrl } from '../../../utils/api';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';

export default function CartPage() {
  const { getDeliveryPoint, setActiveNav, refreshCart, addToWishlist } = useUser();
  const basket = useUnifiedCart(getDeliveryPoint?.(), undefined, 'basket');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const focusedWholesale = useRef(false);
  const data = basket.data;
  const groups = data?.groups || [];
  const items = groups.flatMap(group => group.items);
  const digital = items.filter(item => item.fulfillmentType === 'digital');
  const mixedDigital = digital.length > 0 && digital.length !== items.length;
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
  return <section className="cart-page-container customer-basket" aria-label="Customer cart">
    <header className="basket-heading"><h1>Shopping Cart</h1><p>Quick Commerce, E-Commerce and Wholesale in one basket.</p></header>
    <div className="basket-body">
      <div className="basket-tools" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="cart-secondary-btn" onClick={basket.reload} disabled={busy || basket.loading} style={{ display: 'none' }} aria-hidden="true">Refresh prices</button>
        <button type="button" className="cart-secondary-btn" onClick={() => setActiveNav('home')}>Continue shopping</button>
      </div>
      {(error || basket.error) && <div role="alert" className="wholesale-cart-alert">{error || basket.error}</div>}
      {basket.loading && <p role="status">Refreshing your basket…</p>}
      {data?.warnings?.map(message => <div role="alert" className="wholesale-cart-alert" key={message}>{message}</div>)}
      {!basket.loading && data && !items.length && <CartEmptyState onBrowse={() => setActiveNav('home')} />}
      {items.length > 0 && <>
        <div className="basket-tools" aria-label="Basket channels">{[...new Set(groups.map(group => group.salesChannel === 'wholesale' ? 'wholesale' : group.channel))].map(channel => <a key={channel} href={`#basket-${channel}`}>{channel === 'wholesale' ? 'Wholesale' : channel === 'grocery' ? 'Quick Commerce' : 'E-Commerce'}</a>)}</div>
        {mixedDigital && <div role="alert" className="wholesale-cart-alert">Digital and physical products require separate checkout. Remove one type before ordering.</div>}
        <div className="basket-layout"><div>{groups.map((group, index) => <div key={group.key} id={groups.findIndex(other => (other.salesChannel === 'wholesale' ? 'wholesale' : other.channel) === (group.salesChannel === 'wholesale' ? 'wholesale' : group.channel)) === index ? `basket-${group.salesChannel === 'wholesale' ? 'wholesale' : group.channel}` : undefined}><BasketGroups groups={[group]} busy={busy || basket.loading}
          onQuantity={(item, section, qty) => mutate(pathFor(item, section), 'PUT', { qty })}
          onRemove={remove}
          onMessage={(item, message) => mutate(`/api/cart/items/${item.itemId}/message`, 'PATCH', { additionalMessage: message })}
          onWishlist={async (item, section) => { const result = await addToWishlist(item.productId); if (result.ok) await remove(item, section); else setError(result.message); }}
          onMode={async (section, mode) => { const result = await basket.setGroupMode(section, mode); if (!result.ok) setError(result.message); }}
        /></div>)}</div>
        <aside><BasketSummary data={data} /><button type="button" className="pd-add-to-cart-btn" disabled={busy || basket.loading || data.valid === false || mixedDigital || !data.totals} onClick={() => setActiveNav('checkout')}>Proceed to Checkout</button></aside></div>
      </>}
    </div>
  </section>;
}
