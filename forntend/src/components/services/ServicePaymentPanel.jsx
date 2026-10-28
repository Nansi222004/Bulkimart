import React, { useEffect, useRef, useState } from 'react';
import { getPortalToken } from '../../utils/portalSession';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';

export default function ServicePaymentPanel({ application, admin, request, onUpdated, checkout = openRazorpayCheckout }) {
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bill = application.billing;
  if (!bill) return application.snapshot?.pricing?.mode === 'fixed'
    ? <p role="status">Payment can be made here after an admin reviews the application and requests the service fee.</p> : null;
  const base = `/applications/${application._id}`, amount = `₹${(bill.amountPaise / 100).toFixed(2)}`;
  const payable = !admin && application.status === 'awaiting_payment' && !bill.reviewRequired && ['unpaid', 'pending', 'failed'].includes(bill.status);
  const storageKey = `service-payment:${application._id}:${bill.version}`;
  async function run(pay) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    const token = getPortalToken('seller');
    try {
      if (pay) {
        const key = sessionStorage.getItem(storageKey) || crypto.randomUUID(); sessionStorage.setItem(storageKey, key);
        const b = await request(`${base}/payment`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ feeVersion: bill.version, amountPaise: bill.amountPaise, acceptTerms: accepted }) });
        if (!alive.current || token !== getPortalToken('seller')) return;
        const outcome = await checkout(b.data, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
        if (!alive.current || token !== getPortalToken('seller')) return;
        setMessage(outcome.verified ? 'Payment verified. Your application is ready for admin processing.' : outcome.message || 'Payment pending verification. Check payment status before retrying.');
        if (outcome.verified) sessionStorage.removeItem(storageKey);
      } else {
        const b = await request(`${base}/payment-status`, { method: 'POST', body: '{}' });
        if (!alive.current || token !== getPortalToken('seller')) return;
        if (['paid', 'failed'].includes(b.data.status)) sessionStorage.removeItem(storageKey);
        setMessage(`Payment status: ${b.data.status}`);
      }
      await onUpdated?.();
    } catch (e) { if (alive.current && token === getPortalToken('seller')) setMessage(e.message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="sm-card" aria-label="Service payment"><h4>Service payment · {amount}</h4><p>Payment status: {bill.status}</p><p>{bill.terms}</p>
    {bill.reviewRequired && <p role="status">This payment requires admin reconciliation or refund review. Further payment and paid work are blocked.</p>}
    {payable && <><label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />I accept the displayed fee and payment terms.</label><button type="button" disabled={!accepted || busy} onClick={() => run(true)}>Pay {amount} to Bulkimart</button></>}
    {!admin && bill.paymentId && <button type="button" disabled={busy} onClick={() => run(false)}>Check payment status</button>}
    {message && <p role="status">{message}</p>}
  </section>;
}
