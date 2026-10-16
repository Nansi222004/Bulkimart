import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '../context/UserContext';
import { apiUrl } from '../../../utils/api';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';

const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export default function WholesaleCartPage() {
  const { currentUser, savedAddresses = [], selectedAddressId, setSelectedAddressId, setActiveNav, placeUnifiedOrder, initiateOnlinePayment, checkCheckoutStatus } = useUser();
  const [cart, setCart] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [method, setMethod] = useState('cod'), [result, setResult] = useState(null), [recovery, setRecovery] = useState(() => {
    try { return Boolean(sessionStorage.getItem(`bulkimart:checkout:wholesale:${currentUser?._id || currentUser?.id || 'customer'}`)); } catch { return false; }
  });
  const lock = useRef(false), generation = useRef(0);
  const address = savedAddresses.find(item => String(item._id) === String(selectedAddressId)) || savedAddresses.find(item => item.isDefault) || savedAddresses[0];
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (address?.lat != null && address?.lng != null) { params.set('lat', address.lat); params.set('lng', address.lng); }
      if (address?._id) params.set('addressId', address._id);
      const response = await fetch(apiUrl(`/api/cart/wholesale?${params}`), { headers: { Authorization: `Bearer ${localStorage.getItem('userToken') || ''}` } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Could not load Wholesale cart');
      if (request === generation.current) setCart(body.data);
    } catch (err) { if (request === generation.current) { setCart(null); setError(err.message); } }
    finally { if (request === generation.current) setLoading(false); }
  }, [address?._id, address?.lat, address?.lng, currentUser]);
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);
  const mutate = async (itemId, qty) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(apiUrl(`/api/cart/wholesale/${itemId}`), { method: qty === null ? 'DELETE' : 'PUT', headers: { Authorization: `Bearer ${localStorage.getItem('userToken') || ''}`, 'Content-Type': 'application/json' }, ...(qty === null ? {} : { body: JSON.stringify({ qty }) }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.message || 'Could not update Wholesale cart');
      await load();
    } catch (err) { setError(err.message); }
    finally { lock.current = false; setBusy(false); }
  };
  const place = async () => {
    if (lock.current || loading || !cart?.valid || !cart.items?.length || !address || recovery) return;
    lock.current = true; setBusy(true); setError('');
    const session = captureUserSession();
    try {
      const response = await placeUnifiedOrder(method, 0, { purchaseMode: 'wholesale', quoteHash: cart.quoteHash });
      if (!isCurrentUserSession(session)) return;
      if (!response.ok) {
        if (['CHECKOUT_OUTCOME_UNCERTAIN', 'CHECKOUT_IN_PROGRESS', 'CHECKOUT_DATA_CONFLICT'].includes(response.code)) setRecovery(true);
        throw new Error(response.message);
      }
      setResult(response);
      if (method === 'online') {
        const payment = await initiateOnlinePayment(response.orders[0]._id);
        if (!payment.ok) setError(payment.message || 'Payment is pending. Retry from your order details.');
      }
    } catch (err) { setError(err.message || 'Checkout failed'); }
    finally { lock.current = false; setBusy(false); }
  };
  const recover = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const response = await checkCheckoutStatus('wholesale');
      setError(response.message || 'Status checked');
      if (response.ok && response.data?.state === 'not_found') setRecovery(false);
      if (response.ok && response.data?.state === 'completed') setResult({ orders: response.data.orders });
    } finally { lock.current = false; setBusy(false); }
  };
  return <section className="wholesale-page" aria-label="Wholesale cart">
    <h1>Wholesale cart</h1><p>Wholesale and retail purchases are checked out separately.</p>
    {error && <p role="alert">{error}</p>}
    {result ? <><h2>Wholesale order placed</h2>{result.orders.map(order => <p key={order._id}>{order.orderNo}</p>)}<button onClick={() => setActiveNav('orders')}>View orders and payment status</button></>
      : <>
        <button onClick={load} disabled={busy || loading}>Refresh prices</button>
        {loading ? <p role="status">Loading Wholesale cart…</p> : <>
          {cart?.warnings?.map(message => <p role="alert" key={message}>{message}</p>)}
          {!cart?.items?.length && <p>Your Wholesale cart is empty.</p>}
          {cart?.items?.map(item => <article key={item.itemId} style={{ borderBottom: '1px solid #ddd', padding: '16px 0' }}>
            <strong>{item.name}</strong><p>{item.variantName} · {item.qty} units · {money(item.lineTotal)}</p>
            {item.wholesaleSnapshot && <><p>MOQ {item.wholesaleSnapshot.minimumQuantity}, increment {item.wholesaleSnapshot.quantityIncrement} · {money(item.price)} per unit</p>
              <label>Quantity <input aria-label={`Quantity for ${item.name}`} type="number" min={item.wholesaleSnapshot.minimumQuantity} step={item.wholesaleSnapshot.quantityIncrement} max={Math.min(item.stock, 100000)} defaultValue={item.qty} key={item.qty} disabled={busy || recovery} onBlur={event => { const qty = Number(event.target.value); event.target.value = item.qty; if (qty !== item.qty) mutate(item.itemId, qty); }} /></label></>}
            <button disabled={busy || recovery} onClick={() => mutate(item.itemId, null)}>Remove</button>
          </article>)}
          <label>Delivery address <select value={address?._id || ''} disabled={busy || recovery} onChange={event => setSelectedAddressId(event.target.value)}><option value="">Choose address</option>{savedAddresses.map(item => <option value={item._id} key={item._id}>{item.line1}, {item.city}, {item.pincode}</option>)}</select></label>
          {!address && <button onClick={() => setActiveNav('account')}>Add a delivery address in Account</button>}
          {cart?.totals && <div><p>Items: {money(cart.totals.subtotal)}</p><p>Delivery: {money(cart.totals.deliveryCharge)}</p><strong>Total: {money(cart.totals.totalAmount)}</strong><p>Current retail tax, delivery, cancellation and refund rules apply. Coupons and Coins are unavailable in grouped checkout.</p></div>}
          <label>Payment <select value={method} disabled={busy || recovery} onChange={event => setMethod(event.target.value)}><option value="cod">Cash on delivery</option><option value="online">Online payment</option><option value="wallet">Wallet</option></select></label>
          {recovery ? <button disabled={busy} onClick={recover}>Check checkout status</button> : <button disabled={busy || loading || !cart?.valid || !cart.items?.length || !address} onClick={place}>{busy ? 'Processing…' : 'Place Wholesale order'}</button>}
        </>}
      </>}
    <button onClick={() => { window.history.pushState(null, '', '/wholesale'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Browse Wholesale offers</button>
  </section>;
}
