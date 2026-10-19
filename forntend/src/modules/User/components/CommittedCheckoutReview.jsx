import React, { useEffect, useRef, useState } from 'react';
import { boundedFetch } from '../../../utils/portalRequests';
import { apiUrl } from '../../../utils/api';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
import { resolvedCommittedPayment } from '../../../utils/committedCheckout';

export default function CommittedCheckoutReview({ reference, onResolved, onOrders }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const active = useRef(null);
  const generation = useRef(0);
  const check = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    const revision = ++generation.current;
    const session = captureUserSession();
    setChecking(true); setError('');
    const current = () => !controller.signal.aborted && generation.current === revision && isCurrentUserSession(session);
    try {
      const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
      const response = await boundedFetch(apiUrl('/api/orders/checkout-status'), {
        method: 'POST', headers: { ...headers, 'Idempotency-Key': reference.key },
        body: JSON.stringify({ operation: reference.operation }), signal: controller.signal,
      });
      const body = await response.json();
      if (!current()) return;
      if (!response.ok) throw new Error(body.message || 'Checkout status is temporarily unavailable.');
      if (body.data?.state !== 'completed' || !body.data.orders?.length) {
        throw new Error('The committed checkout could not be confirmed. Review My Orders or retry the status check.');
      }
      const orders = body.data.orders;
      const status = await boundedFetch(apiUrl(`/api/payments/${encodeURIComponent(orders[0]._id)}/status`), { headers, signal: controller.signal });
      const payment = await status.json();
      if (!current()) return;
      if (!status.ok || !payment.data?.status || typeof payment.data.reconciliationRequired !== 'boolean') {
        throw new Error(payment.message || 'Payment status is temporarily unavailable.');
      }
      const paymentData = payment.data;
      setResult({ orders, payment: paymentData });
      // Auto-resolve when payment is already confirmed paid — this handles the case
      // where Razorpay succeeded but the page navigated away before we could clear
      // the committed-checkout safety key from localStorage.
      if (paymentData.status === 'paid' && paymentData.reconciliationRequired === false) {
        if (current()) onResolved(reference.key);
      }
    } catch (failure) {
      if (current()) setError(failure.message || 'Status is temporarily unavailable. Retry the status check.');
    } finally {
      if (current()) setChecking(false);
      if (active.current === controller) active.current = null;
    }
  };
  useEffect(() => {
    check();
    return () => { generation.current++; active.current?.abort(); active.current = null; };
  }, [reference.key, reference.customerId]);

  const payment = result?.payment;
  const resolved = resolvedCommittedPayment(payment);
  const message = !payment ? 'Checking your committed checkout…'
    : payment.reconciliationRequired ? 'Online payment initialization or verification is pending. The outcome requires review.'
      : payment.status === 'paid' ? 'Payment confirmed — your order is placed!'
        : payment.status === 'failed' ? 'The server has confirmed that payment failed. You can retry payment from My Orders.'
          : ['refunded', 'partial_refund'].includes(payment.status) ? 'Payment reviewed. See My Orders for refund details.'
            : 'Online payment is pending or processing. Check status before taking further action.';
  return <section className="checkout-page-container committed-checkout-review" aria-label="Committed checkout review" style={{ padding: '24px 16px' }}>
    <div className="profile-menu-card" style={{ padding: 20 }}>
      <h2>{result ? 'Orders created · Review payment status' : 'Review checkout status'}</h2>
      <p>{result ? 'Your orders have already been created.' : 'Checking whether this checkout has committed orders.'} Checking status will not place another order or start another payment.</p>
      <p role="status">{checking ? 'Checking order and payment status…' : error ? 'Recovery status temporarily unavailable.' : message}</p>
      {error && <p role="alert">{error}</p>}
      {result && <>
        <p>Server payment status: <strong>{payment.status}</strong>{payment.reconciliationRequired ? ' · reconciliation required' : ''}</p>
        <ul>{result.orders.map(order => <li key={order._id}>{order.orderNo || order._id}</li>)}</ul>
        <p>Payment amount: ₹{Number(payment.amount).toLocaleString('en-IN')}</p>
      </>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="cart-secondary-btn" disabled={checking} onClick={check}>{checking ? 'Checking…' : error ? 'Retry Status Check' : 'Check Status'}</button>
        <button type="button" className="cart-secondary-btn" onClick={onOrders}>View My Orders</button>
        {resolved && !checking && !error && <button type="button" className="cart-secondary-btn" onClick={() => onResolved(reference.key)}>Done · Continue shopping</button>}
      </div>
    </div>
  </section>;
}

