import React, { useEffect, useState } from 'react';
import { adminGet } from '../../../utils/adminApi';

export default function HistoricalFinancePanel() {
  const [page, setPage] = useState(1), [report, setReport] = useState(null), [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setReport(null);
    adminGet(`/finance/historical-exceptions?page=${page}`).then(response => {
      if (!Array.isArray(response.data?.rows) || response.data.mode !== 'dry-run') throw new Error('Historical evidence response is invalid');
      if (active) setReport(response.data);
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page]);
  return <section className="finance-panel"><h2>Historical order exceptions</h2>
    <p>Read-only evidence review. Zero posted funds do not establish zero entitlement. Current commission rules cannot establish the original agreement. Unknown payable remains unresolved. No credit or release runs from this screen.</p>
    {loading ? <p role="status">Loading historical evidence…</p> : error ? <p role="alert">{error}</p> : report && <>
      <p>Page {page}; up to {report.limit} of {report.totalOrders} historical orders. One row per seller and order item.</p>
      {report.rows.map(row => <details key={row.idempotencyKey}><summary>{row.orderNo} · {row.classification} · Payable: unresolved</summary>
        <p>Seller {row.sellerId} · Item {row.itemId} · INR · Policy: unverified</p>
        <p>{row.reasons.join(' · ')}</p><p>Evidence hash: {row.evidenceHash}</p>
        <p>Payment: {row.evidence.payment?.method || 'missing'} / {row.evidence.payment?.status || 'missing'}. Legacy capture metadata: {row.evidence.payment?.legacyCapturePresent ? 'present; requires review' : 'absent'}. COD receipt: {row.evidence.cash?.status || 'not established'}.</p>
      </details>)}
      {!report.rows.length && <p>No historical exceptions within this page.</p>}
    </>}
    <button disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
    <button disabled={loading || !report || page * report.limit >= report.totalOrders} onClick={() => setPage(page + 1)}>Next</button>
  </section>;
}
