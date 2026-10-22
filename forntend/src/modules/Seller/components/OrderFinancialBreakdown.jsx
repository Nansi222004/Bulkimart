import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { getPortalToken } from '../../../utils/portalSession';

const money = value => `₹${(Number(value || 0) / 100).toFixed(2)}`;
export default function OrderFinancialBreakdown({ orderId }) {
  const [record, setRecord] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setRecord(null); setError('');
    const token = getPortalToken('seller');
    boundedFetch(apiUrl(`/api/sellers/orders/${orderId}/financial-breakdown`), { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Could not load order finances'); return result.data; })
      .then(result => { if (!controller.signal.aborted && token === getPortalToken('seller')) setRecord(result); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [orderId, retry]);
  return <section className="seller-order-section" aria-label="Order financial breakdown"><h3>Merchandise earnings & settlement</h3>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(retry + 1)}>Retry</button></p> : !record ? <p role="status">Loading financial records…</p> : <>
      {record.merchandise ? <><p>Settlement: {record.financialPosting || 'Not allocated'} · {record.merchandise.currency}</p>
        {record.merchandise.lines.map(line => <div key={line.itemId} style={{ padding: 12, borderBottom: '1px solid #cde9ed', overflowWrap: 'anywhere' }}>
          <p>Item {line.itemId} · Subtotal {money(line.grossPaise)}</p><p>Discount {money(line.allocatedDiscounts.discount)} · Coupon {money(line.allocatedDiscounts.couponDiscount)} · Coins {money(line.allocatedDiscounts.coinDiscount)} · Legacy discount {money(line.allocatedDiscounts.cdsDiscount)}</p>
          {line.rule ? <><p>Commission {money(line.commissionPaise)} · Tax {money(line.taxPaise)} · Net merchandise earnings {money(line.netPaise)}</p><p>Rule {line.rule.version} · {line.rule.method} {line.rule.value} · {line.rule.taxTreatment} tax {line.rule.taxRate}%</p></> : <p>Held: no commission rule was approved at checkout.</p>}
        </div>)}
        <p>Customer delivery charge: {money(record.merchandise.components.deliveryPaise)}. Courier and seller service fees are recorded separately.</p>
      </> : <p>This historical order has no versioned commission snapshot. Its earnings are not recalculated or deducted.</p>}
      {record.snapshot && <p>Courier freight {money(record.snapshot.quotedCourierFreight * 100)} · Seller freight share {money(record.snapshot.vendorFreightShare * 100)} · Shiprocket service fee {money(record.snapshot.serviceFee?.amount * 100)} · Fee tax {money(record.snapshot.serviceFee?.taxAmount * 100)}</p>}
      {record.entries?.length > 0 && <details><summary>Ledger and transaction references</summary>{record.entries.map(entry => <p key={entry._id}>{entry.description} · {entry.account || 'seller_payable'} · {entry.bucket} · {entry.direction} ₹{entry.amount.toFixed(2)} · {entry.reference || entry.entryNo}</p>)}</details>}
    </>}
  </section>;
}
