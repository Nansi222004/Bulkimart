import React, { useState } from 'react';

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
  if (![eligible, fee, tax, deduction].every(Number.isFinite) || deduction > eligible) return { blocked: true };
  return { eligible, commission: rule.taxTreatment === 'inclusive' ? fee - tax : fee, tax, net: eligible - deduction };
}

export default function CommissionSimulation({ rule }) {
  const [subtotal, setSubtotal] = useState(''), [discount, setDiscount] = useState('');
  const result = simulateCommission(rule, subtotal, discount);
  return <details className="finance-panel"><summary>Commission simulation — one order item</summary>
    <p>Sample INR amounts only. Enter an already allocated discount for this item. This browser estimate creates no order or ledger entry; the backend calculates authoritative amounts.</p>
    <div className="finance-grid"><label>Sample item subtotal (INR)<input type="number" min="0" step="0.01" value={subtotal} onChange={e => setSubtotal(e.target.value)} /></label>
      <label>Sample allocated discount (INR)<input type="number" min="0" step="0.01" value={discount} onChange={e => setDiscount(e.target.value)} /></label></div>
    {!result ? <p>Enter sample amounts and an explicit commission/tax rule to preview.</p> : result.blocked ? <p role="alert">Blocked: deductions exceed eligible merchandise.</p> : <dl>{Object.entries(result).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>₹{(value / 100).toFixed(2)}</dd></div>)}</dl>}
  </details>;
}
