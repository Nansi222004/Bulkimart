import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminGetBlob, qs } from '../../../utils/adminApi';
import { KIND_LABELS, formatMinutes } from '../utils/liveDispatch';

const PAGE_SIZE = 20;
const formatDate = (value) => (value
  ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

/**
 * Completed Deliveries — finished rider trips from GET /api/admin/delivery-history.
 * Search, status and paging run on the server over the whole history; the CSV
 * comes from /delivery-history/export with the same filters.
 */
export const DeliveryHistoryTab = () => {
  const { triggerToast } = useAdmin();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const request = useRef(0);

  const filters = { search: search.trim() || undefined, status: status === 'all' ? undefined : status };

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    try {
      const { data, meta: m } = await adminGet(`/delivery-history${qs({ search: search.trim() || undefined, status: status === 'all' ? undefined : status, page, limit: PAGE_SIZE })}`);
      if (current !== request.current) return;
      setRows(data || []);
      setMeta({ total: m?.total || 0, pages: m?.pages || Math.ceil((m?.total || 0) / PAGE_SIZE) });
      setError('');
    } catch (err) {
      if (current !== request.current) return;
      setError(err.message || 'Could not load delivery history');
      setRows([]);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  // A new search or status starts again from the first page.
  useEffect(() => { setPage(1); }, [search, status]);

  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await adminGetBlob(`/delivery-history/export${qs(filters)}`);
      if (!blob.size) throw new Error('The export was empty. Please retry.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename.endsWith('.csv') ? filename : 'bulkimart-delivery-history.csv';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      triggerToast(`Downloaded ${link.download}`);
    } catch (err) {
      triggerToast(err.message || 'Export failed', { type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(filters.search || filters.status);

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a' }}>Completed Deliveries</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: '#64748b' }}>Finished rider trips — delivered or failed — with trip duration and OTP verification. Times in IST.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="admin-btn-sm details" onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || loading || meta.total === 0}
            style={{ padding: '8px 16px', borderRadius: 8, backgroundColor: '#10b981', color: '#ffffff', border: 'none', fontWeight: 800, fontSize: 12, cursor: exporting || meta.total === 0 ? 'not-allowed' : 'pointer', opacity: exporting || meta.total === 0 ? 0.6 : 1 }}
          >
            {exporting ? 'Exporting…' : `Export CSV${meta.total ? ` (${meta.total})` : ''}`}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid #e2e8f0' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, minWidth: 220, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5" aria-hidden="true"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="search" className="sa-search-input" aria-label="Search delivery history" placeholder="Search by order number, customer or rider name / phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="sa-select" aria-label="Delivery outcome" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All outcomes</option>
          <option value="delivered">Delivered</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      {error && (
        <div role="alert" style={{ padding: '10px 14px', borderRadius: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>
          {error} <button type="button" onClick={load} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#b91c1c', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
        </div>
      )}

      <div tabIndex={0} role="region" aria-label="Delivery history table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12.5, minWidth: 820 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 800 }}>
              {['Order Ref', 'Delivery Partner', 'Customer Name', 'Finished', 'Trip Duration', 'Verification', 'Status'].map((h) => <th key={h} style={{ padding: '12px 16px' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>Loading delivery history…</td></tr>
            ) : error ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#b91c1c' }}>Delivery history could not be loaded.</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '30px 0', color: '#94a3b8' }}>{filtered ? 'No finished trips match these filters.' : 'No completed deliveries yet.'}</td></tr>
            ) : rows.map((log, index) => (
              <tr key={`${log.id}-${index}`} style={{ borderBottom: '1px solid #f1f5f9', opacity: loading ? 0.6 : 1 }}>
                <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontWeight: 800 }}>
                  {log.id}
                  {log.kind && log.kind !== 'order' && <div style={{ fontFamily: 'inherit', fontSize: 10, color: '#6366f1', fontWeight: 700 }}>{KIND_LABELS[log.kind]}</div>}
                </td>
                <td style={{ padding: '12px 16px', fontWeight: 800, color: '#0f172a' }}>{log.partner}</td>
                <td style={{ padding: '12px 16px', color: '#6366f1', fontWeight: 700 }}>{log.customer}</td>
                <td style={{ padding: '12px 16px', color: '#64748b' }}>{formatDate(log.deliveredAt)}</td>
                <td style={{ padding: '12px 16px', fontWeight: 700 }}>{formatMinutes(log.durationMin)}</td>
                <td style={{ padding: '12px 16px', fontSize: 11 }}>{log.status === 'delivered' ? (log.otpVerified ? 'OTP Verified' : 'OTP Not Verified') : '—'}</td>
                <td style={{ padding: '12px 16px' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 800, backgroundColor: log.status === 'delivered' ? '#ebfdf2' : '#fef2f2', color: log.status === 'delivered' ? '#047857' : '#b91c1c' }}>
                    {log.status === 'delivered' ? 'Delivered' : 'Failed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta.pages > 1 && (
        <nav aria-label="Delivery history pages" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 12, color: '#475569' }}>
          <span>Page {page} of {meta.pages} · {meta.total} trips</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="admin-btn-sm details" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button type="button" className="admin-btn-sm details" disabled={page >= meta.pages || loading} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </nav>
      )}
    </div>
  );
};

export default DeliveryHistoryTab;
