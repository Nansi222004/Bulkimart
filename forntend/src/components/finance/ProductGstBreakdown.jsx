import React from 'react';

export function validProductTax(tax) {
  return tax?.version === 'product-gst-v1' && ['sellingPricePaise', 'grossPaise', 'taxableValuePaise', 'gstPaise', 'addedGstPaise', 'includedGstPaise'].every(key => Number.isSafeInteger(tax[key]) && tax[key] >= 0)
    && tax.taxableValuePaise + tax.gstPaise === tax.grossPaise
    && tax.sellingPricePaise + tax.addedGstPaise === tax.grossPaise
    && Array.isArray(tax.rates) && tax.rates.every(row => Number.isFinite(row.gstRate) && ['inclusive', 'exclusive'].includes(row.gstPriceType)
      && Number.isSafeInteger(row.gstPaise) && Number.isSafeInteger(row.taxableValuePaise))
    && tax.rates.reduce((n, row) => n + row.gstPaise, 0) === tax.gstPaise;
}

// This component only renders server amounts. It never computes product tax.
// whenMissing: what to say when the record has no snapshot at all (orders placed before product GST was
// saved). Data that is present but does not reconcile is always reported as unavailable, never as zero.
export default function ProductGstBreakdown({ tax, subtotalIncludesAddedGst = true, pending = false, whenMissing }) {
  if (tax == null && whenMissing && !pending) return <p className="product-gst-unavailable">{whenMissing}</p>;
  if (!validProductTax(tax)) return <p role="status" className="product-gst-unavailable">{pending ? 'Loading product GST breakdown…' : 'Product GST breakdown unavailable.'}</p>;
  const money = value => `₹${(value / 100).toFixed(2)}`;
  const row = (label, amount, key) => <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, margin: '6px 0', fontSize: 13 }}><span>{label}</span><span style={{ whiteSpace: 'nowrap' }}>{money(amount)}</span></div>;
  return <div className="product-gst-breakdown" aria-label="Product GST breakdown">
    {row('Taxable product value (before platform discounts)', tax.taxableValuePaise, 'base')}
    {tax.rates.map(rate => row(`${rate.gstPriceType === 'inclusive' ? 'Included GST' : 'GST added'} (${rate.gstRate}%)${rate.gstPriceType === 'exclusive' && subtotalIncludesAddedGst ? ' · included in subtotal' : ''}`, rate.gstPaise, `${rate.gstRate}:${rate.gstPriceType}`))}
    {tax.discountPaise > 0 && <small>Coupons and coins are funded by Bulkimart; they reduce what you pay.</small>}
  </div>;
}
