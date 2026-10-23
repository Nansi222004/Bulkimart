import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { getPortalToken } from '../../../utils/portalSession';

const money = value => typeof value === 'number' && Number.isFinite(value) ? `₹${(value / 100).toFixed(2)}` : '—';
export default function OrderFinancialBreakdown({ orderId }) {
  const [record, setRecord] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setRecord(null); setError('');
    const token = getPortalToken('seller');
    boundedFetch(apiUrl(`/api/sellers/orders/${orderId}/financial-breakdown`), { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async response => {
        const result = await response.json();
        if (!response.ok || result.success === false) throw new Error(result.message || 'Could not load order finances');
        const data = result.data;
        if (!data || !Array.isArray(data.entries) || (data.merchandise &&
          (!Array.isArray(data.merchandise.lines) || !data.merchandise.components || data.merchandise.lines.some(line =>
            !line || !line.allocatedDiscounts || !Number.isSafeInteger(line.grossPaise) || !Number.isSafeInteger(line.eligiblePaise) ||
            (line.rule && !(data.merchandise.state === 'held_discount_policy' && line.blocker === 'Discount funding policy is not approved') && ['commissionPaise', 'taxPaise', 'netPaise'].some(key => !Number.isSafeInteger(line[key]))))))) {
          throw new Error('Order financial data is incomplete. Please retry.');
        }
        return data;
      })
      .then(result => { if (!controller.signal.aborted && token === getPortalToken('seller')) setRecord(result); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [orderId, retry]);
  return <section className="seller-order-section" aria-label="Order financial breakdown"><h3>Your earnings from this order</h3>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry</button></p> : !record ? <p role="status">Loading financial records…</p> : <>
      {record.merchandise ? <><p>Status: {{ held: 'Earned — on hold until the return window ends', eligible: 'Available to withdraw', reversed: 'Refunded to customer' }[record.financialPosting] || 'Not added yet — waiting for payment confirmation'}</p>
        {record.merchandise.lines.map(line => {
          const discount = Object.values(line.allocatedDiscounts).reduce((sum, value) => sum + (Number.isSafeInteger(value) ? value : 0), 0);
          const funded = record.merchandise.discountFunding === 'platform';
          return <div key={line.itemId} style={{ padding: 12, borderBottom: '1px solid #cde9ed', overflowWrap: 'anywhere' }}>
          <p>Item {line.itemId} · Item price {money(line.grossPaise)}</p>
          {discount > 0 && <p>Coupon / coins on this item {money(discount)}{funded ? ' — paid by Bulkimart, not deducted from you' : ''} · Customer paid {money(line.eligiblePaise)}</p>}
          {line.blocker && <p role="status">Held: {line.blocker}. No seller deduction is assumed.</p>}{line.rule ? <><p>Commission {money(line.commissionPaise)} · GST on commission {money(line.taxPaise)}{line.tcsPaise ? ` · TCS ${money(line.tcsPaise)}` : ''}{line.tdsPaise ? ` · TDS ${money(line.tdsPaise)}` : ''}</p><p><strong>You get {money(line.netPaise)}</strong></p><p>Rule {line.rule.version} · {line.rule.method === 'fixed' ? `₹${line.rule.value} per item` : `${line.rule.value}%`} · GST {line.rule.taxTreatment} {line.rule.taxRate}%</p></> : <p>Held: no commission rule was approved at checkout.</p>}
        </div>; })}
        <p>Customer delivery charge on the order: {money(record.merchandise.components.deliveryPaise)}. Shiprocket courier charges and fees are shown separately below.</p>
      </> : <p>This historical order has no versioned commission snapshot. Its earnings are not recalculated or deducted.</p>}
      {record.snapshot && <p>Courier freight {money(record.snapshot.quotedCourierFreight * 100)} · Seller freight share {money(record.snapshot.vendorFreightShare * 100)} · Shiprocket service fee {money(record.snapshot.serviceFee?.amount * 100)} · Fee tax {money(record.snapshot.serviceFee?.taxAmount * 100)}</p>}
      {record.entries?.length > 0 && <details><summary>Ledger and transaction references</summary>{record.entries.map(entry => <p key={entry._id}>{entry.description} · {entry.account || 'seller_payable'} · {entry.bucket} · {entry.direction} ₹{entry.amount.toFixed(2)} · {entry.reference || entry.entryNo}</p>)}</details>}
    </>}
  </section>;
}
