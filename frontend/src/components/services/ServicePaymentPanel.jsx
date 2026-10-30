import React, { useEffect, useRef, useState } from 'react';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';

export const feeText = paise => `₹${(paise / 100).toFixed(2)}`;
const STATUS_TEXT = { unpaid: 'Not paid yet', pending: 'Payment processing', failed: 'Payment failed — try again', paid: 'Paid', refunded: 'Refunded', partial_refund: 'Partly refunded' };

// Opens Razorpay for an application's service fee. One idempotency key per fee version
// survives a reload, so a retried checkout reuses the same gateway order.
export async function payServiceFee({ application, request, authorization, checkout = openRazorpayCheckout }) {
  const bill = application.billing, storageKey = `service-payment:${application._id}:${bill.version}`;
  let key = null;
  try { key = sessionStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
  key = key || crypto.randomUUID();
  try { sessionStorage.setItem(storageKey, key); } catch { /* The same mounted page still reuses the key. */ }
  const order = await request(`/applications/${application._id}/payment`, { method: 'POST', headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ feeVersion: bill.version, amountPaise: bill.amountPaise, acceptTerms: true }) });
  const outcome = await checkout(order.data, { Authorization: authorization(), 'Content-Type': 'application/json' });
  if (outcome.verified) { try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }
  return outcome;
}

// The service fee on an application: applicants pay or check it here; admins see where it stands.
export default function ServicePaymentPanel({ application, admin, request, onUpdated, authorization, checkout = openRazorpayCheckout }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bill = application.billing;
  if (!bill) return null;
  const amount = feeText(bill.amountPaise);
  const payable = !admin && application.status === 'awaiting_payment' && !bill.reviewRequired && ['unpaid', 'pending', 'failed'].includes(bill.status);
  const status = bill.reviewRequired ? 'Needs finance review' : bill.refundedToWallet ? 'Refunded to Bulkimart wallet' : STATUS_TEXT[bill.status] || bill.status;
  async function run(pay) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      if (pay) {
        const outcome = await payServiceFee({ application, request, authorization, checkout });
        if (!alive.current) return;
        setMessage(outcome.verified ? 'Payment received. Your application has been submitted.' : outcome.message || 'Payment not completed. You can try again.');
      } else {
        const result = await request(`/applications/${application._id}/payment-status`, { method: 'POST', body: '{}' });
        if (!alive.current) return;
        setMessage(`Payment status: ${STATUS_TEXT[result.data.status] || result.data.status}`);
      }
      await onUpdated?.();
    } catch (e) { if (alive.current) setMessage(e.message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className={`service-fee${payable ? ' is-due' : ''}`} aria-label="Service fee">
    <div className="service-fee-row"><span>Service fee</span><strong>{amount}</strong><em className={`service-fee-status is-${bill.reviewRequired ? 'review' : bill.status}`}>{status}</em></div>
    {payable && <><p className="service-fee-terms">{bill.terms}</p><button type="button" className="service-fee-pay" disabled={busy} onClick={() => run(true)}>{busy ? 'Opening payment…' : `Pay ${amount}`}</button></>}
    {!admin && bill.paymentId && ['pending', 'failed'].includes(bill.status) && <button type="button" className="service-fee-check" disabled={busy} onClick={() => run(false)}>Check payment status</button>}
    {bill.reviewRequired && <p role="status">Our finance team is reviewing this payment. Work is paused until it is resolved.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
