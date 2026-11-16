import React, { useCallback, useEffect, useState } from 'react';
import ModalPortal from '../../../components/ModalPortal';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost } from '../../../utils/adminApi';

/**
 * Shiprocket shipment problems (RTO, lost, damaged, destroyed, cancelled, undelivered) waiting for an admin
 * decision. Nothing here happens automatically: the admin chooses refund, stock, seller settlement and the
 * customer message, and the server runs each decision once.
 */
const TYPE_LABEL = {
  UNDELIVERED: 'Delivery attempt failed', RTO_INITIATED: 'Returning to seller (RTO)', RTO_DELIVERED: 'Returned to seller (RTO delivered)',
  LOST: 'Lost by courier', DAMAGED: 'Damaged in transit', DESTROYED: 'Destroyed / disposed', CANCELLED: 'Shipment cancelled at Shiprocket',
};
// Same rules the server enforces (courierTracking.service.js): cancel only when the journey is over,
// restock only when the parcel is physically back with the seller.
const FINAL = ['RTO_DELIVERED', 'LOST', 'DAMAGED', 'DESTROYED', 'CANCELLED'];
const RESTOCKABLE = ['RTO_DELIVERED', 'CANCELLED'];
const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const ShipmentExceptionsTab = () => {
  const { triggerToast } = useAdmin();
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ decision: 'CLOSE_WITHOUT_REFUND', restock: false, sellerSettlement: 'NO_EARNING', customerMessage: '', note: '' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGet(`/shipment-exceptions?status=${status}`);
      setRows(res.data?.rows || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load shipment exceptions', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [status, triggerToast]);
  useEffect(() => { load(); }, [load]);

  const open = async (row) => {
    setActive(row);
    const final = FINAL.includes(row.shiprocket?.exception?.type);
    setForm({ decision: final ? 'CANCEL_AND_REFUND' : 'CLOSE_WITHOUT_REFUND', restock: false, sellerSettlement: 'NO_EARNING', customerMessage: '', note: '' });
    try { setEvents((await adminGet(`/shipment-exceptions/${row._id}/events`)).data || []); } catch { setEvents([]); }
  };

  const submit = async () => {
    if (form.note.trim().length < 5) { triggerToast('Add a note of at least 5 characters explaining the decision', { type: 'error' }); return; }
    setSaving(true);
    try {
      const res = await adminPost(`/shipment-exceptions/${active._id}/resolve`, { ...form, restock: form.decision === 'CANCEL_AND_REFUND' && form.restock });
      triggerToast(res.message || 'Decision saved');
      setActive(null);
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not save the decision', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const ex = active?.shiprocket?.exception;
  const canCancel = FINAL.includes(ex?.type);
  const canRestock = RESTOCKABLE.includes(ex?.type);
  const field = { display: 'block', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', color: 'var(--sa-muted, #64748b)', margin: '10px 0 4px' };

  return (
    <div className="sa-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Shipment Exceptions</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>Shiprocket parcels that were returned, lost, damaged or could not be delivered. Nothing is refunded or restocked until you decide.</p>
        </div>
        <select aria-label="Filter" value={status} onChange={(e) => setStatus(e.target.value)} className="sa-input" style={{ width: 'auto' }}>
          <option value="open">Needs review</option>
          <option value="resolved">Resolved</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading ? <p>Loading…</p> : !rows.length ? <p style={{ color: '#64748b' }}>No shipment exceptions{status === 'open' ? ' need review' : ''}.</p> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="sa-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr><th>Order</th><th>Problem</th><th>Courier / AWB</th><th>Customer</th><th>Amount</th><th>Flagged</th><th /></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id}>
                  <td><b>{row.orderNo}</b>{row.exchange ? <div style={{ fontSize: 11, color: '#075985' }}>Exchange replacement</div> : null}<div style={{ fontSize: 11, color: '#64748b' }}>{row.status}</div></td>
                  <td>{TYPE_LABEL[row.shiprocket?.exception?.type] || row.shiprocket?.exception?.type}<div style={{ fontSize: 11, color: '#64748b' }}>{row.shiprocket?.exception?.providerStatus}</div></td>
                  <td>{row.shiprocket?.courier || '—'}<div style={{ fontSize: 11 }}>{row.shiprocket?.awb}</div></td>
                  <td>{row.userId?.name || '—'}</td>
                  <td>₹{row.pricing?.totalAmount ?? 0} · {String(row.paymentMethod || '').toUpperCase()}</td>
                  <td>{when(row.shiprocket?.exception?.detectedAt)}</td>
                  <td><button type="button" className="sa-action-btn" onClick={() => open(row)}>{row.shiprocket?.exception?.status === 'resolved' ? 'View' : 'Review'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && (
        <ModalPortal>
          <div className="admin-modal-overlay" role="dialog" aria-modal="true" aria-label={`Shipment exception ${active.orderNo}`}>
            <div className="admin-modal" style={{ maxWidth: 560 }}>
              <div className="admin-modal-header">
                <h3 className="admin-modal-title">{active.orderNo} · {TYPE_LABEL[ex?.type] || ex?.type}</h3>
                <button type="button" className="admin-modal-close" onClick={() => setActive(null)} aria-label="Close">✕</button>
              </div>
              <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ margin: 0 }}><b>Items:</b> {(active.items || []).map((i) => `${i.name} × ${i.qty}`).join(', ')}</p>
                <p style={{ margin: 0 }}><b>Amount:</b> ₹{active.pricing?.totalAmount ?? 0} ({String(active.paymentMethod || '').toUpperCase()}){active.exchange ? ' — free exchange replacement; cancelling turns the exchange into a refund of the original item' : ''}</p>
                <p style={{ margin: 0 }}><b>Courier says:</b> {ex?.providerStatus} · {when(ex?.updatedAt)}</p>

                {ex?.status === 'resolved' ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 10 }}>
                    <b>Resolved:</b> {ex.resolution?.decision?.replace(/_/g, ' ').toLowerCase()}{ex.resolution?.restock ? ', stock restored' : ''} — {ex.resolution?.note} ({when(ex.resolution?.at)})
                  </div>
                ) : (
                  <>
                    <span style={field}>Decision</span>
                    <label><input type="radio" name="decision" checked={form.decision === 'CANCEL_AND_REFUND'} disabled={!canCancel} onChange={() => setForm((f) => ({ ...f, decision: 'CANCEL_AND_REFUND' }))} /> Cancel the order and refund the customer (usual refund rules)</label>
                    {!canCancel && <span style={{ fontSize: 11.5, color: '#92400e' }}>The parcel is still with the courier. Cancel and refund once it is returned, lost or confirmed undeliverable.</span>}
                    <label><input type="radio" name="decision" checked={form.decision === 'CLOSE_WITHOUT_REFUND'} onChange={() => setForm((f) => ({ ...f, decision: 'CLOSE_WITHOUT_REFUND', restock: false }))} /> Close without a refund (e.g. re-attempt arranged; a later problem opens a new review)</label>

                    {form.decision === 'CANCEL_AND_REFUND' && (
                      <label style={{ marginTop: 6 }}>
                        <input type="checkbox" checked={form.restock} disabled={!canRestock} onChange={(e) => setForm((f) => ({ ...f, restock: e.target.checked }))} /> Put the items back in stock (the parcel is back with the seller and saleable)
                        {!canRestock && <span style={{ display: 'block', fontSize: 11.5, color: '#64748b' }}>Not available: the goods are not back with the seller.</span>}
                      </label>
                    )}

                    <span style={field}>Seller settlement</span>
                    <select className="sa-input" value={form.sellerSettlement} onChange={(e) => setForm((f) => ({ ...f, sellerSettlement: e.target.value }))}>
                      <option value="NO_EARNING">No seller earning (order was not delivered)</option>
                      <option value="FINANCE_REVIEW">Send to finance review (e.g. courier claim or seller compensation)</option>
                    </select>

                    <span style={field}>Message to the customer (optional)</span>
                    <textarea className="sa-input" rows={2} maxLength={500} value={form.customerMessage} onChange={(e) => setForm((f) => ({ ...f, customerMessage: e.target.value }))} placeholder="Sent as a notification. Leave empty to send the standard cancellation notice." />

                    <span style={field}>Internal note (required)</span>
                    <textarea className="sa-input" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Why this decision" />

                    <button type="button" className="sa-btn-primary" style={{ marginTop: 10 }} disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save decision'}</button>
                  </>
                )}

                <span style={field}>Courier events</span>
                <div style={{ maxHeight: 180, overflowY: 'auto', fontSize: 11.5 }}>
                  {events.length ? events.map((e) => (
                    <div key={e._id} style={{ borderBottom: '1px solid #f1f5f9', padding: '3px 0' }}>
                      {when(e.createdAt)} · {e.kind === 'admin_action' ? `Admin: ${e.outcome}` : `${e.status || e.statusId || ''} — ${e.outcome}`}{e.detail ? ` (${e.detail})` : ''}
                    </div>
                  )) : <span style={{ color: '#64748b' }}>No events recorded.</span>}
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default ShipmentExceptionsTab;
