import React, { useState, useEffect } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Per-item checkbox pack confirmation, ported from the rider app's own
 * pickup checklist (ActiveDeliveryPage.jsx) — same shape: an index-keyed
 * `checkedItems` object, a "confirm" action gated on every item checked.
 * Nothing in the Delivery module changes; this is a new copy for the
 * Seller side, since no equivalent existed there.
 *
 * `viewPath` is the only vendor-specific part: a Seller reads the plan
 * through `seller-view`, an SHG store through `shg-view`. The pack action
 * itself is one shared endpoint for both, so the SHG panel mounts this
 * exact component rather than a near-identical copy.
 */
export const SubscriptionPackChecklist = ({ subscriptionId, deliveryEntryId, onPacked, onClose, viewPath = 'seller-view' }) => {
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkedItems, setCheckedItems] = useState({});
  const [packing, setPacking] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('userToken');
        const res = await fetch(apiUrl(`/api/subscriptions/${subscriptionId}/${viewPath}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || 'Could not load this subscription');
        setSub(body.data);
      } catch (err) {
        setError(err.message || 'Could not load this subscription');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [subscriptionId, viewPath]);

  const items = sub?.customItems || [];
  const allChecked = items.length > 0 && items.every((_, idx) => checkedItems[idx]);

  const handlePack = async () => {
    setPacking(true);
    try {
      const token = localStorage.getItem('userToken');
      const res = await fetch(apiUrl(`/api/subscriptions/${subscriptionId}/deliveries/${deliveryEntryId}/pack`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not mark this delivery packed');
      onPacked(deliveryEntryId);
    } catch (err) {
      alert(err.message || 'Error marking this delivery packed');
    } finally {
      setPacking(false);
    }
  };

  return (
    <div className="seller-modal-overlay" style={{ zIndex: 9999 }}>
      <div className="seller-modal-sheet" style={{ maxHeight: '90%', maxWidth: 480 }}>
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">📦 Prepare Subscription Delivery</h3>
          <button onClick={onClose} className="modal-close-btn">✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {loading && <p style={{ color: 'var(--text-muted)' }}>Loading…</p>}
          {!loading && error && <p style={{ color: 'var(--error, #dc2626)' }}>{error}</p>}

          {!loading && !error && sub && (
            <>
              <div style={{ marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block' }}>Deliver to</span>
                <strong style={{ fontSize: 14 }}>{sub.shippingAddress?.name}</strong>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block' }}>
                  {sub.shippingAddress?.line1}, {sub.shippingAddress?.city}
                </span>
              </div>

              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
                Verify items ({items.length})
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {items.map((item, idx) => (
                  <label key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                    <input
                      type="checkbox"
                      checked={!!checkedItems[idx]}
                      onChange={() => setCheckedItems((prev) => ({ ...prev, [idx]: !prev[idx] }))}
                    />
                    <span style={{ fontSize: 14 }}>
                      <strong>{item.qty}x</strong> {item.productId?.name || 'Item'}
                    </span>
                  </label>
                ))}
              </div>

              <button
                onClick={handlePack}
                disabled={!allChecked || packing}
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 16, border: 'none',
                  background: !allChecked || packing ? '#94a3b8' : 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff', fontWeight: 800, fontSize: 14,
                  cursor: !allChecked || packing ? 'not-allowed' : 'pointer',
                }}
              >
                {packing ? 'Marking packed…' : allChecked ? 'Mark Packed' : 'Check every item first'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SubscriptionPackChecklist;
