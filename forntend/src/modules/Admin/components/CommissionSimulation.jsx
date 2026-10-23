import React, { useState } from 'react';
import { hint } from './financeText';

// Mirrors calculateMarketplaceLine on the server: commission and its GST are
// charged on what the customer paid; Bulkimart funds the discount, so the
// seller is paid on the full price. TCS/TDS (Payouts & tax) are not included.
export function simulateCommission(rule, subtotal, discount) {
  const gross = Math.round(Number(subtotal) * 100), reduction = Math.round(Number(discount) * 100);
  if (subtotal === '' || discount === '' || rule.value === '' || rule.taxRate === '' || !rule.taxTreatment || !Number.isFinite(gross + reduction) || gross < 0 || reduction < 0 || reduction > gross) return null;
  const eligible = gross - reduction;
  let fee = rule.method === 'fixed' ? Math.round(Number(rule.value) * 100) : Math.round(eligible * Number(rule.value) / 100);
  if (rule.minimum !== '') fee = Math.max(fee, Math.round(Number(rule.minimum) * 100));
  if (rule.maximum !== '') fee = Math.min(fee, Math.round(Number(rule.maximum) * 100));
  if (eligible === 0) fee = 0;
  const rate = Number(rule.taxRate);
  const tax = rule.taxTreatment === 'exclusive' ? Math.round(fee * rate / 100) : rule.taxTreatment === 'inclusive' ? fee - Math.round(fee / (1 + rate / 100)) : 0;
  const deduction = fee + (rule.taxTreatment === 'exclusive' ? tax : 0);
  if (![eligible, fee, tax, deduction].every(Number.isFinite) || deduction > gross) return { blocked: true };
  return { eligible, discountPaidByBulkimart: reduction, commission: rule.taxTreatment === 'inclusive' ? fee - tax : fee, tax, net: gross - deduction };
}

const names = { eligible: 'Customer paid', discountPaidByBulkimart: 'Discount paid by Bulkimart', commission: 'Commission', tax: 'GST on commission', net: 'Seller gets (before TCS/TDS)' };

export default function CommissionSimulation({ rule }) {
  const [subtotal, setSubtotal] = useState(''), [discount, setDiscount] = useState('');
  const result = simulateCommission(rule, subtotal, discount);
  return <details className="finance-panel"><summary>Try it — what one item would earn</summary>
    <p className="finance-muted">A quick preview using the rule above. Nothing is saved.</p>
    <div className="finance-grid"><label>Item price (₹)<input type="number" min="0" step="0.01" value={subtotal} onChange={e => setSubtotal(e.target.value)} />{hint('Full price of the item line.', '100')}</label>
      <label>Coupon / coins on this item (₹)<input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} />{hint('Bulkimart pays this discount, so the seller is not charged for it.', '10')}</label></div>
    {!result ? <p>Fill in the rule above and both amounts to see the result.</p> : result.blocked ? <p role="alert">Commission and GST would be more than the item price.</p> : <dl>{Object.entries(result).map(([key, value]) => <div key={key}><dt>{names[key]}</dt><dd>₹{(value / 100).toFixed(2)}</dd></div>)}</dl>}
  </details>;
}
