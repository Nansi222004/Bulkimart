import React, { useEffect, useRef, useState } from 'react';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';

export const feeText = paise => `₹${(paise / 100).toFixed(2)}`;
const STATUS_TEXT = { unpaid: 'Not paid yet', pending: 'Payment processing', failed: 'Payment failed — try again', paid: 'Paid', refunded: 'Refunded', partial_refund: 'Partly refunded' };

/**
 * A service's checkout figures from its admin settings: base price plus the service's
 * own GST rate, rounded half-up to the paisa. Mirrors serviceFeeQuote on the server;
 * the server's figure is the one actually charged.
 */
export function serviceFeeQuote(pricing) {
  if (pricing?.mode !== 'fixed' || !(Number(pricing.amount) > 0)) return null;
  const basePaise = Math.round(Number(pricing.amount) * 100);
  const taxRate = Number(pricing.taxRate) || 0;
  const taxPaise = Math.floor((basePaise * Math.round(taxRate * 100) + 5000) / 10000);
  return { basePaise, taxRate, taxPaise, totalPaise: basePaise + taxPaise };
}

/** Base, GST and total lines. `fee` has basePaise, taxRate, taxPaise and totalPaise (or amountPaise). */
export function FeeBreakdown({ fee }) {
  if (!fee) return null;
  const total = fee.totalPaise ?? fee.amountPaise;
  const base = fee.basePaise ?? total;
  return <dl className="service-fee-breakdown">
    <dt>Service fee</dt><dd>{feeText(base)}</dd>
    {fee.taxRate > 0 && <><dt>GST ({fee.taxRate}%)</dt><dd>{feeText(fee.taxPaise || 0)}</dd></>}
    <dt><strong>Total payable</strong></dt><dd><strong>{feeText(total)}</strong></dd>
  </dl>;
}

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

const dateTime = value => new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// The service fee on an application: applicants pay, check or cancel it here; admins see where it stands.
export default function ServicePaymentPanel({ application, admin, request, onUpdated, authorization, checkout = openRazorpayCheckout }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [agreed, setAgreed] = useState(false);
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const bill = application.billing;
  if (!bill) return null;
  const amount = feeText(bill.amountPaise);
  const payable = !admin && application.status === 'awaiting_payment' && !bill.reviewRequired && ['unpaid', 'pending', 'failed'].includes(bill.status);
  const status = bill.reviewRequired ? 'Needs finance review' : bill.refundedToWallet ? 'Refunded to Bulkimart wallet' : STATUS_TEXT[bill.status] || bill.status;
  const cancel = !admin && application.selfCancel;
  async function run(work) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage('');
    try { await work(); await onUpdated?.(); }
    catch (e) { if (alive.current) setMessage(e.message); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const pay = () => run(async () => {
    const outcome = await payServiceFee({ application, request, authorization, checkout });
    if (alive.current) setMessage(outcome.verified ? 'Payment received. Your application has been submitted.' : outcome.message || 'Payment not completed. You can try again.');
  });
  const check = () => run(async () => {
    const result = await request(`/applications/${application._id}/payment-status`, { method: 'POST', body: '{}' });
    if (alive.current) setMessage(`Payment status: ${STATUS_TEXT[result.data.status] || result.data.status}`);
  });
  const cancelRequest = () => {
    const refundNote = cancel.refund ? ` ${amount} will be refunded to your Bulkimart wallet.` : '';
    if (!window.confirm(`Cancel this request?${refundNote}`)) return;
    run(async () => {
      await request(`/applications/${application._id}/cancellation`, { method: 'POST', body: JSON.stringify({ version: application.version, message: 'Cancelled by customer' }) });
      if (alive.current) setMessage(cancel.refund ? 'Request cancelled. The fee has been refunded to your Bulkimart wallet.' : 'Request cancelled.');
    });
  };
  return <section className={`service-fee${payable ? ' is-due' : ''}`} aria-label="Service fee">
    <div className="service-fee-row"><span>Service fee</span><strong>{amount}</strong><em className={`service-fee-status is-${bill.reviewRequired ? 'review' : bill.status}`}>{status}</em></div>
    {(bill.taxPaise > 0 || payable) && <FeeBreakdown fee={bill} />}
    {payable && <>
      {bill.terms && <p className="service-fee-terms">{bill.terms}</p>}
      <label className="sm-agree"><input type="checkbox" checked={agreed} disabled={busy} onChange={e => setAgreed(e.target.checked)} />I have read and agree to the payment, cancellation and disclaimer terms above.</label>
      <button type="button" className="service-fee-pay" disabled={busy || !agreed} onClick={pay}>{busy ? 'Opening payment…' : `Pay ${amount}`}</button>
    </>}
    {!admin && bill.paymentId && ['pending', 'failed'].includes(bill.status) && <button type="button" className="service-fee-check" disabled={busy} onClick={check}>Check payment status</button>}
    {cancel?.allowed && <div className="service-fee-cancel">
      {cancel.until && <p>You can cancel until {dateTime(cancel.until)}{cancel.refund ? ' for a full refund to your Bulkimart wallet' : ''}, as long as work has not started.</p>}
      <button type="button" disabled={busy} onClick={cancelRequest}>Cancel request</button>
    </div>}
    {!admin && bill.status === 'paid' && cancel && !cancel.allowed && cancel.reason && application.status !== 'cancelled' && <p className="service-fee-note">{cancel.reason}</p>}
    {bill.reviewRequired && <p role="status">Our finance team is reviewing this payment. Work is paused until it is resolved.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
