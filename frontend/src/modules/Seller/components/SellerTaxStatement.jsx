import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';
import { boundedFetch } from '../../../utils/portalRequests';
import { getPortalToken } from '../../../utils/portalSession';

const money = paise => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthName = month => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Monthly TCS/TDS Bulkimart withheld, for the seller's own GST and income-tax filing.
export default function SellerTaxStatement() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    const token = getPortalToken('seller');
    boundedFetch(apiUrl('/api/sellers/finances/tax-statement'), { signal: controller.signal, headers: { Authorization: `Bearer ${token}` } })
      .then(async response => { const body = await response.json(); if (!response.ok || body.success === false || !Array.isArray(body.data?.months)) throw new Error(body.message || 'Tax statement unavailable'); return body.data; })
      .then(result => { if (!controller.signal.aborted && token === getPortalToken('seller')) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [retry]);
  if (error) return <section style={{ padding: 16 }}><p role="alert">{error}</p><button type="button" onClick={() => setRetry(retry + 1)}>Retry</button></section>;
  if (!data) return <p role="status" style={{ padding: 16 }}>Loading tax statement…</p>;
  const months = data.months.filter(row => row.grossPaise || row.tcsPaise || row.tdsPaise);
  return <section style={{ padding: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, marginBottom: 20 }}>
    <h2 style={{ margin: '0 0 6px', fontSize: 17 }}>Tax withheld by Bulkimart</h2>
    <p style={{ color: '#64748b', fontSize: 13 }}>TCS (GST, {data.tcsRatePercent}% of your sales excluding GST) and TDS (income tax, {data.tdsRatePercent}% of your sales) are deposited with the government in your name. Claim them when you file your GST return and income-tax return.</p>
    {(!data.gstin || !data.pan) && <p role="alert" style={{ color: '#b45309', fontSize: 13 }}>{`Add your ${[!data.gstin && 'GSTIN', !data.pan && 'PAN'].filter(Boolean).join(' and ')} in your profile so the tax is credited to you.`}</p>}
    {!months.length ? <p style={{ color: '#64748b' }}>No sales recorded in the last 12 months.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', fontSize: 13, textAlign: 'left' }}>
      <thead><tr>{['Month', 'Item sales (incl. GST)', 'Taxable value', 'TCS', 'TDS'].map(title => <th key={title} style={{ padding: 8 }}>{title}</th>)}</tr></thead>
      <tbody>{months.map(row => <tr key={row.month}><td style={{ padding: 8 }}>{monthName(row.month)}</td><td style={{ padding: 8 }}>{money(row.grossPaise)}</td><td style={{ padding: 8 }}>{money(row.taxablePaise)}</td><td style={{ padding: 8 }}>{money(row.tcsPaise)}</td><td style={{ padding: 8 }}>{money(row.tdsPaise)}</td></tr>)}</tbody>
    </table></div>}
  </section>;
}
