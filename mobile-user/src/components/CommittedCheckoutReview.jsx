// Port of CommittedCheckoutReview.jsx — review/resume the payment of an order that already exists.
// Checking status never places another order or starts another payment.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { boundedFetch } from '../api/client';
import { captureUserSession, isCurrentUserSession } from '../lib/session';
import { resolvedCommittedPayment } from '../lib/committedCheckout';
import { Text } from './ui';
import { SecondaryButton } from './cart/CartUI';

export default function CommittedCheckoutReview({ reference, orderId, onResolved, onOrders, onPay, onContinueCheckout, embedded = false }) {
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
    if (active.current) return undefined;
    const controller = new AbortController(); active.current = controller;
    const revision = ++generation.current;
    const snapshot = captureUserSession();
    setChecking(true); setError('');
    const current = () => !controller.signal.aborted && generation.current === revision && isCurrentUserSession(snapshot);
    try {
      const headers = { Authorization: `Bearer ${snapshot.token}`, 'Content-Type': 'application/json' };
      let orders = [{ _id: orderId }];
      if (reference) {
        const response = await boundedFetch('/api/orders/checkout-status', { method: 'POST', headers: { ...headers, 'Idempotency-Key': reference.key }, body: JSON.stringify({ operation: reference.operation }), signal: controller.signal });
        const body = await response.json();
        if (!current()) return undefined;
        if (!response.ok) throw new Error(body.message || 'Checkout status is temporarily unavailable.');
        if (body.data?.state !== 'completed' || !body.data.orders?.length) throw new Error('The committed checkout could not be confirmed. Review My Orders or retry the status check.');
        orders = body.data.orders;
      }
      const status = await boundedFetch(`/api/payments/${encodeURIComponent(orders[0]._id)}/status`, { headers, signal: controller.signal });
      const payment = await status.json();
      if (!current()) return undefined;
      if (!status.ok || !payment.data?.status || typeof payment.data.reconciliationRequired !== 'boolean') throw new Error(payment.message || 'Payment status is temporarily unavailable.');
      const paymentData = payment.data;
      setResult({ orders, payment: paymentData });
      if (reference && (paymentData.status === 'paid' || paymentData.orderStatus === 'cancelled') && paymentData.reconciliationRequired === false) { if (current()) onResolved(reference.key); }
      return { orders, payment: paymentData };
    } catch (failure) {
      if (current()) setError(failure.message || 'Status is temporarily unavailable. Retry the status check.');
      return undefined;
    } finally {
      if (current()) setChecking(false);
      if (active.current === controller) active.current = null;
    }
  };
  useEffect(() => {
    setResult(null); setPaymentMessage('');
    check();
    return () => { lifecycle.current++; generation.current++; active.current?.abort(); active.current = null; };
  }, [reference?.key, reference?.customerId, orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const canPay = payment => payment?.method === 'online' && ['pending', 'failed'].includes(payment.status) && payment.reconciliationRequired === false && payment.orderStatus === 'placed';
  const resumePayment = async () => {
    if (payingRef.current || active.current || !onPay) return;
    payingRef.current = true; setPaying(true); setPaymentMessage('');
    const snapshot = captureUserSession();
    const revision = lifecycle.current;
    const current = () => isCurrentUserSession(snapshot) && lifecycle.current === revision;
    try {
      const latest = await check();
      if (!current() || !latest || !canPay(latest.payment)) return;
      const outcome = await onPay(latest.orders[0]._id);
      if (!current()) return;
      setPaymentMessage(outcome.ok && outcome.verified ? 'Payment confirmed.' : outcome.cancelled ? 'Payment cancelled. Your order is saved; you can resume payment here.' : outcome.message || 'Payment is not confirmed. Check status before retrying.');
      await check();
    } catch (failure) {
      if (current()) setPaymentMessage(failure.message || 'Could not resume payment. Check status before retrying.');
    } finally { payingRef.current = false; if (current()) setPaying(false); }
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
  const card = <View style={styles.card} accessibilityLabel="Committed checkout review">
    <Text style={styles.h2}>{reference ? (result ? 'Orders created · Review payment status' : 'Review checkout status') : 'Order payment'}</Text>
    <Text style={styles.p}>{reference ? (result ? 'Your orders have already been created.' : 'Checking whether this checkout has committed orders.') : 'Review or resume payment for this existing order.'} Checking status will not place another order or start another payment.</Text>
    <Text style={styles.p} accessibilityLiveRegion="polite">{checking ? 'Checking order and payment status…' : error ? 'Recovery status temporarily unavailable.' : message}</Text>
    {error ? <Text style={[styles.p, { color: '#b91c1c' }]} accessibilityRole="alert">{error}</Text> : null}
    {paymentMessage ? <Text style={styles.p}>{paymentMessage}</Text> : null}
    {result && <>
      <Text style={styles.p}>Server payment status: <Text style={{ fontWeight: '700' }}>{payment.status}</Text>{payment.reconciliationRequired ? ' · reconciliation required' : ''}</Text>
      {result.orders.map(order => <Text key={order._id} style={styles.p}>{'• '}{order.orderNo || payment.orderNo || order._id}</Text>)}
      <Text style={styles.p}>Payment amount: ₹{Number(payment.amount).toLocaleString('en-IN')}</Text>
    </>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
      <SecondaryButton title={checking ? 'Checking…' : error ? 'Retry Status Check' : 'Check Status'} disabled={checking || paying} onPress={check} />
      {onPay && canPay(payment) && <SecondaryButton title={paying ? 'Opening payment…' : 'Resume Razorpay Payment'} disabled={checking || paying || Boolean(error)} onPress={resumePayment} />}
      {onOrders && <SecondaryButton title="View My Orders" disabled={paying} onPress={onOrders} />}
      {result && onContinueCheckout && !checking && !error && <SecondaryButton title="Checkout new basket" disabled={paying} onPress={onContinueCheckout} />}
      {reference && resolved && !checking && !paying && !error && <SecondaryButton title="Done · Continue shopping" onPress={() => onResolved(reference.key)} />}
    </View>
  </View>;
  if (embedded) return card;
  return <ScrollView contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 16 }}>{card}</ScrollView>;
}

const styles = StyleSheet.create({
  card: { padding: 20, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, backgroundColor: '#fff' },
  h2: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  p: { fontSize: 14, lineHeight: 21, marginVertical: 4, color: '#172b4d' },
});
