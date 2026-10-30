import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { getPortalToken } from '../../../utils/portalSession';
import { openRazorpayCheckout } from '../../../utils/razorpayCheckout';

export default function ShiprocketFeePayment({ orderId, provider, onRefresh }) {
  const [record, setRecord] = useState(null), [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false), [message, setMessage] = useState('');
  const headers = () => {
    const token = getPortalToken('seller');
    if (!token) throw new Error('Sign in to your seller account again.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  };
  const request = async (method = 'GET', payload) => {
    const response = await boundedFetch(apiUrl(`/api/sellers/orders/${orderId}/shiprocket-fee`), { method, headers: headers(), ...(payload ? { body: JSON.stringify(payload) } : {}) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || 'Could not load the seller fee');
    return body.data;
  };
  const refresh = async () => {
    setBusy(true);
    try { setRecord(await request()); } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { refresh(); }, [orderId]);
  const snapshot = record?.snapshot || provider.feeCollection?.snapshot;
  const estimate = provider.quote?.optionB;
  const feeState = record?.payment?.status || provider.feeCollection?.status;
  const total = snapshot?.vendorDeliveryFeeObligation ?? estimate?.vendorDeliveryFeeObligation;
  const price = value => value == null ? 'Unavailable' : `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const pay = async () => {
    setBusy(true); setMessage('');
    try {
      const data = await request('POST', { confirm: true, reviewedTotal: total, feeVersion: snapshot?.serviceFee?.version || provider.quote?.feeRule?.version });
      if (data.status !== 'paid') {
        const result = await openRazorpayCheckout(data.checkout, headers());
        setMessage(result.ok ? 'Seller payment verified. Refresh delivery options to continue.' : result.message || 'Payment pending. Check status before retrying.');
      }
      setRecord(await request()); await onRefresh?.();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return <section className="seller-shiprocket-fee" aria-label="Seller freight and service fee">
    <h4>Seller payment breakdown</h4>
    <p>The Bulkimart service fee is separate from courier freight. Your customer is not charged a new fee.</p>
    <dl>{[
      ['Estimated Shiprocket freight', snapshot?.eligibleCourierFreight ?? estimate?.eligibleCourierFreight],
      ['Customer delivery-charge contribution', snapshot?.customerFreightContribution ?? estimate?.customerFreightContribution],
      ['Your remaining freight', snapshot?.vendorFreightShare ?? estimate?.vendorFreightShare],
      ['Bulkimart service fee (before tax)', snapshot?.serviceFee?.netAmount ?? estimate?.serviceFeeNet],
      ['Applicable service-fee tax', snapshot?.serviceFee?.taxAmount ?? estimate?.applicableTax],
      ['Total payable by you', total],
    ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{price(value)}</dd></div>)}</dl>
    <p>Payment: <strong>{feeState === 'not_started' || !feeState ? 'Not started' : feeState}</strong>{snapshot && ` · Rule ${snapshot.serviceFee.version}`}</p>
    {!provider.activation?.enabled || !provider.activation?.ready ? <p role="status">Live charging is disabled pending business approval. No payment will be collected.</p> : feeState !== 'paid' && <>
      <label className="seller-fee-confirm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={busy} /> I have reviewed the freight, service fee, tax and total payable.</label>
      <button type="button" className="primary-onboarding-btn" disabled={busy || !reviewed || total == null || !provider.available} onClick={pay}>{busy ? 'Checking payment…' : 'Confirm & pay seller fee'}</button>
    </>}
    <button type="button" className="order-action-btn-sm" disabled={busy} onClick={async()=>{await refresh();await onRefresh?.();}}>Check payment status</button>
    {message && <p role="status">{message}</p>}
    {feeState === 'paid' && <p>Payment verified. Shipment creation still requires an unchanged courier quote and eligible order.</p>}
  </section>;
}
