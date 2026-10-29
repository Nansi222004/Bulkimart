import ProductGstBreakdown from '../../../components/finance/ProductGstBreakdown';
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
      <ProductGstBreakdown tax={record.productTax} whenMissing="Product GST was not recorded for this older order." />
      {record.merchandise ? <><p>Status: {{ held: 'Earned — on hold until the return window ends', eligible: 'Available to withdraw', reversed: 'Refunded to customer' }[record.financialPosting] || 'Not added yet — added once the order is delivered and payment is confirmed'}</p>
        {record.merchandise.lines.map(line => {
          const discount = Object.values(line.allocatedDiscounts).reduce((sum, value) => sum + (Number.isSafeInteger(value) ? value : 0), 0);
          const funded = record.merchandise.discountFunding === 'platform';
          const rate = line.rule && (line.rule.method === 'fixed' ? `₹${line.rule.value} per item` : `${line.rule.value}%`);
          return <div key={line.itemId} style={{ padding: 12, borderBottom: '1px solid #cde9ed', overflowWrap: 'anywhere' }}>
          <p><strong>{line.itemName || 'Product'}</strong>{line.qty ? ` × ${line.qty}` : ''}</p>
          <p>Item price: {money(line.grossPaise)}</p>
          {discount > 0 && <p>Customer discount (coupon / coins): {money(discount)}{funded ? ' — paid by Bulkimart, not cut from your earnings' : ''}. Customer paid {money(line.eligiblePaise)} for this item.</p>}
          {line.blocker && <p role="status">On hold: {line.blocker}. Nothing has been deducted from you.</p>}{line.rule ? <>
            <p>Bulkimart commission ({rate}): −{money(line.commissionPaise)}</p>
            {line.taxPaise > 0 && <p>GST on commission: −{money(line.taxPaise)}</p>}
            {line.tcsPaise > 0 && <p>TCS withheld (claim in your GST return): −{money(line.tcsPaise)}</p>}
            {line.tdsPaise > 0 && <p>TDS withheld (claim in your income-tax return): −{money(line.tdsPaise)}</p>}
            <p><strong>You get {money(line.netPaise)}</strong></p></> : <p>On hold: commission for this item is still being confirmed. Nothing has been deducted from you.</p>}
        </div>; })}
        {(() => {
          // The customer's full payment, so the item amounts above are not
          // mistaken for the order total shown elsewhere.
          const { merchandisePaise = record.merchandise.lines.reduce((sum, line) => sum + line.eligiblePaise, 0), deliveryPaise = 0, sellerIncentivePaise = 0, tipPaise = 0, donationPaise = 0 } = record.merchandise.components;
          const customerDeliveryPaise = deliveryPaise + sellerIncentivePaise;
          const totalPaise = Number.isSafeInteger(record.merchandise.expectedPaise) ? record.merchandise.expectedPaise : merchandisePaise + customerDeliveryPaise + tipPaise + donationPaise;
          return <p><strong>Customer paid for the whole order: {money(totalPaise)}</strong> = items {money(merchandisePaise)} + delivery {money(customerDeliveryPaise)}{tipPaise ? ` + rider tip ${money(tipPaise)}` : ''}{donationPaise ? ` + donation ${money(donationPaise)}` : ''}. Your item earnings above are worked out on the items only.{record.snapshot ? ' Courier charges are shown below.' : ''}</p>;
        })()}
      </> : <p>This is an older order, so a per-item earnings breakdown is not available. Nothing has been recalculated or deducted.</p>}
      {record.snapshot && <p>Courier charge {money(record.snapshot.quotedCourierFreight * 100)} · Your share of courier charge {money(record.snapshot.vendorFreightShare * 100)} · Shipping service fee {money(record.snapshot.serviceFee?.amount * 100)} · Tax on fee {money(record.snapshot.serviceFee?.taxAmount * 100)}</p>}
      {record.entries?.length > 0 && <details><summary>Transaction history</summary>{record.entries.map(entry => <p key={entry._id}>{entry.description} · {entry.direction === 'credit' ? '+' : '−'}₹{entry.amount.toFixed(2)} · {{ held: 'on hold', eligible: 'available', reserved: 'requested for payout', settled: 'paid out' }[entry.bucket] || entry.bucket} · Ref {entry.reference || entry.entryNo}</p>)}</details>}
    </>}
  </section>;
}
