import React, { useEffect, useState, useCallback } from 'react';
import { useDelivery } from '../context/DeliveryContext';

// Backend sends the raw enum; only this screen decides how a rider reads it.
const TYPE_META = {
  DELIVERED: { label: 'Delivered', icon: '✅' },
  DECLINED_BY_RIDER: { label: 'Declined', icon: '🚫' },
  OFFER_EXPIRED: { label: 'Offer Expired', icon: '⏱️' },
  CANCELLED_BY_RIDER: { label: 'Cancelled by Rider', icon: '❌' },
  FAILED: { label: 'Failed', icon: '⚠️' },
};

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'DECLINED_BY_RIDER', label: 'Declined' },
  { key: 'OFFER_EXPIRED', label: 'Expired' },
  { key: 'CANCELLED_BY_RIDER', label: 'Cancelled' },
  { key: 'FAILED', label: 'Failed' },
];

const formatDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} • ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export const RiderHistoryPage = () => {
  const { fetchRiderHistory, triggerToast } = useDelivery();

  const [filter, setFilter] = useState('ALL');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (type) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRiderHistory({ type });
      setItems(res.data || []);
    } catch (err) {
      setError(err.message || 'Could not load history');
      triggerToast(err.message || 'Could not load history', {type:'error'});
    } finally {
      setLoading(false);
    }
  }, [fetchRiderHistory]);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  return (
    <div className="delivery-earnings-wrapper">

      {/* Status filter — same pill row pattern as the Earnings period toggle */}
      <div className="delivery-earnings-filter-pill-row">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`delivery-filter-pill-btn ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="delivery-card delivery-transaction-log-card">
        {loading && (
          <div className="delivery-loading-text" style={{ padding: 20, textAlign: 'center' }}>
            Loading…
          </div>
        )}

        {!loading && error && (
          <p className="delivery-payout-footer-label" style={{ color: 'var(--error)' }}>
            {error}
          </p>
        )}

        {!loading && !error && items.length === 0 && (
          <p className="delivery-payout-footer-label">
            No trips here yet.
          </p>
        )}

        {!loading && !error && items.length > 0 && (
          <div className="delivery-transaction-list">
            {items.map((item) => {
              const meta = TYPE_META[item.type] || { label: item.type, icon: '•' };
              return (
                <div key={item.id} className="delivery-txn-row">
                  <div className="txn-left">
                    <span className="txn-icon">{meta.icon}</span>
                    <div className="txn-meta">
                      <span className="txn-title">{meta.label}</span>
                      <span className="txn-time">{formatDateTime(item.timestamp)} • {item.kind === 'return_pickup' ? 'Return pickup' : 'Order'} {item.orderNo}</span>
                    </div>
                  </div>
                  <div className="txn-right">
                    {typeof item.amount === 'number' && (
                      <span className="txn-amount">₹{item.amount}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RiderHistoryPage;
