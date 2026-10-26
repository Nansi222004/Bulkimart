import React, { useEffect, useRef, useState } from 'react';
import { boundedFetch } from '../../../utils/portalRequests';
import { apiUrl } from '../../../utils/api';
import { captureUserSession, isCurrentUserSession } from '../../../utils/userSession';
import { resolvedCommittedPayment } from '../../../utils/committedCheckout';

export default function CommittedCheckoutReview({ reference, orderId, onResolved, onOrders, onPay, onContinueCheckout }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);
  const active = useRef(null);
  const generation = useRef(0);
  const lifecycle = useRef(0);
  const payingRef = useRef(false);
  const [paying, setPaying] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState('');
  const check = async () => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    const revision = ++generation.current;
    const session = captureUserSession();
    setChecking(true); setError('');
    const current = () => !controller.signal.aborted && generation.current === revision && isCurrentUserSession(session);
    try {
      const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
      let orders = [{ _id: orderId }];
      if (reference) {
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
        orders = body.data.orders;
      }
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
      if (reference && (paymentData.status === 'paid' || paymentData.orderStatus === 'cancelled') && paymentData.reconciliationRequired === false) {
        if (current()) onResolved(reference.key);
      }
      return { orders, payment: paymentData };
    } catch (failure) {
      if (current()) setError(failure.message || 'Status is temporarily unavailable. Retry the status check.');
    } finally {
      if (current()) setChecking(false);
      if (active.current === controller) active.current = null;
    }
  };
  useEffect(() => {
    setResult(null); setPaymentMessage('');
    check();
    return () => { lifecycle.current++; generation.current++; active.current?.abort(); active.current = null; };
  }, [reference?.key, reference?.customerId, orderId]);

  const canPay = payment => payment?.method === 'online'
    && ['pending', 'failed'].includes(payment.status) && payment.reconciliationRequired === false
    && payment.orderStatus === 'placed';
  const resumePayment = async () => {
    if (payingRef.current || active.current || !onPay) return;
    payingRef.current = true; setPaying(true); setPaymentMessage('');
    const session = captureUserSession();
    const revision = lifecycle.current;
    const current = () => isCurrentUserSession(session) && lifecycle.current === revision;
    try {
      // Recheck immediately before payment. Never submit the basket again.
      const latest = await check();
      if (!current() || !latest || !canPay(latest.payment)) return;
      const outcome = await onPay(latest.orders[0]._id);
      if (!current()) return;
      if (outcome.ok && outcome.redirectUrl) { window.location.href = outcome.redirectUrl; return; }
      setPaymentMessage(outcome.ok && outcome.verified ? 'Payment confirmed.'
        : outcome.cancelled ? 'Payment cancelled. Your order is saved; you can resume payment here.'
          : outcome.message || 'Payment is not confirmed. Check status before retrying.');
      await check();
    } catch (failure) {
      if (current()) setPaymentMessage(failure.message || 'Could not resume payment. Check status before retrying.');
    } finally {
      payingRef.current = false;
      if (current()) setPaying(false);
    }
  };

  const payment = result?.payment;
  const resolved = resolvedCommittedPayment(payment);
  const message = !payment ? 'Checking your order payment…'
    : payment.reconciliationRequired ? 'Online payment initialization or verification is pending. The outcome requires review.'
      : payment.orderStatus === 'cancelled' ? 'This order was cancelled. You can check out your current basket.'
      : payment.status === 'paid' ? 'Payment confirmed — your order is placed!'
        : payment.status === 'failed' ? 'The server has confirmed that payment failed. You can retry payment from My Orders.'
          : ['refunded', 'partial_refund'].includes(payment.status) ? 'Payment reviewed. See My Orders for refund details.'
            : 'Online payment is pending or processing. Check status before taking further action.';
  return <section className="checkout-page-container committed-checkout-review" aria-label="Committed checkout review" style={{ padding: '24px 16px' }}>
    <div className="profile-menu-card" style={{ padding: 20 }}>
      <h2>{reference ? result ? 'Orders created · Review payment status' : 'Review checkout status' : 'Order payment'}</h2>
      <p>{reference ? result ? 'Your orders have already been created.' : 'Checking whether this checkout has committed orders.' : 'Review or resume payment for this existing order.'} Checking status will not place another order or start another payment.</p>
      <p role="status">{checking ? 'Checking order and payment status…' : error ? 'Recovery status temporarily unavailable.' : message}</p>
      {error && <p role="alert">{error}</p>}
      {paymentMessage && <p role="status">{paymentMessage}</p>}
      {result && <>
        <p>Server payment status: <strong>{payment.status}</strong>{payment.reconciliationRequired ? ' · reconciliation required' : ''}</p>
        <ul>{result.orders.map(order => <li key={order._id}>{order.orderNo || payment.orderNo || order._id}</li>)}</ul>
        <p>Payment amount: ₹{Number(payment.amount).toLocaleString('en-IN')}</p>
      </>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button type="button" className="cart-secondary-btn" disabled={checking || paying} onClick={check}>{checking ? 'Checking…' : error ? 'Retry Status Check' : 'Check Status'}</button>
        {onPay && canPay(payment) && <button type="button" className="cart-secondary-btn" disabled={checking || paying || Boolean(error)} onClick={resumePayment}>{paying ? 'Opening payment…' : 'Resume Razorpay Payment'}</button>}
        {onOrders && <button type="button" className="cart-secondary-btn" disabled={paying} onClick={onOrders}>View My Orders</button>}
        {result && onContinueCheckout && !checking && !error && <button type="button" className="cart-secondary-btn" disabled={paying} onClick={onContinueCheckout}>Checkout new basket</button>}
        {reference && resolved && !checking && !paying && !error && <button type="button" className="cart-secondary-btn" onClick={() => onResolved(reference.key)}>Done · Continue shopping</button>}
      </div>
    </div>
  </section>;
}

