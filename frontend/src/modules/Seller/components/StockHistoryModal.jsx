import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

// Every stock change on one product: sales, cancellations/returns putting units back, manual adjustments and edits.
const REASON = {
  sale: 'Sold', restock: 'Returned to stock', seller_adjustment: 'Adjusted', product_edit: 'Edited on product form', product_created: 'Opening stock',
};

export function StockHistoryModal({ product, onClose }) {
  const [state, setState] = useState({ status: 'loading', rows: [], error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    fetch(apiUrl(`/api/products/${product.id}/stock-history?limit=100`), {
      headers: { Authorization: `Bearer ${localStorage.getItem('sellerToken') || ''}` }, signal: controller.signal,
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'Could not load the stock history');
        setState({ status: 'ready', rows: Array.isArray(body.data) ? body.data : [], error: '' });
      })
      .catch((e) => { if (e.name !== 'AbortError') setState({ status: 'error', rows: [], error: e.message }); });
    return () => controller.abort();
  }, [product.id, attempt]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-modal="true" aria-labelledby="stock-history-title" onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
          <div>
            <h3 id="stock-history-title" style={{ margin: 0, fontSize: 16 }}>Stock history</h3>
            <div style={{ fontSize: 12.5, color: '#64748b' }}>{product.name}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ border: 0, background: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 18px 14px' }}>
          {state.status === 'loading' ? <p style={{ fontSize: 13 }}>Loading…</p> : null}
          {state.status === 'error' ? (
            <p role="alert" style={{ fontSize: 13, color: '#dc2626' }}>
              {state.error} <button type="button" onClick={() => setAttempt((n) => n + 1)} style={{ marginLeft: 6 }}>Retry</button>
            </p>
          ) : null}
          {state.status === 'ready' && !state.rows.length ? <p style={{ fontSize: 13 }}>No stock changes recorded yet.</p> : null}
          {state.rows.map((m) => (
            <div key={m._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  {REASON[m.reason] || m.reason}{m.variantName && m.variantName !== 'Default' ? ` · ${m.variantName}` : ''}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {new Date(m.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {m.stockAfter !== undefined && m.stockAfter !== null ? ` · stock now ${m.stockAfter}` : ''}
                  {m.note ? ` · ${m.note}` : ''}
                </div>
              </div>
              <span style={{ fontWeight: 800, fontSize: 15, color: m.delta < 0 ? '#dc2626' : '#16a34a' }}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
