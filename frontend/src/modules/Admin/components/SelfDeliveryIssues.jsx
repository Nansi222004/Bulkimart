import React, { useCallback, useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost } from '../../../utils/adminApi';

/**
 * Self Delivery orders the seller handed to their own courier that need a decision: a failed delivery attempt,
 * or a customer's "not received" report on a delivery the seller marked done. Every action needs a note.
 * Cancel & refund is possible only before any seller earnings were posted for the order.
 */
const ACTIONS = [
  ['confirm_delivered', 'Confirm delivered (close the customer report)'],
  ['mark_out_for_delivery', 'Mark out for delivery (courier retrying)'],
  ['mark_delivered', 'Mark delivered (courier confirmed)'],
  ['mark_delivery_failed', 'Record a failed attempt'],
  ['cancel_refund', 'Cancel and refund (parcel never arrived)'],
];

export default function SelfDeliveryIssues() {
  const { triggerToast } = useAdmin();
  const [rows, setRows] = useState([]);
  const [active, setActive] = useState(null);
  const [form, setForm] = useState({ action: 'confirm_delivered', reason: '', restock: false });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setRows((await adminGet('/shipment-exceptions/external')).data?.rows || []); }
    catch (err) { triggerToast(err.message || 'Could not load Self Delivery issues', { type: 'error' }); }
  }, [triggerToast]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (form.reason.trim().length < 5) { triggerToast('Add a note of at least 5 characters', { type: 'error' }); return; }
    setSaving(true);
    try {
      const res = await adminPost(`/shipment-exceptions/${active._id}/external`, { action: form.action, reason: form.reason.trim(), restock: form.action === 'cancel_refund' && form.restock });
      triggerToast(res.message || 'Saved'); setActive(null); load();
    } catch (err) { triggerToast(err.message || 'Could not save the decision', { type: 'error' }); }
    finally { setSaving(false); }
  };

  return (
    <section style={{ marginTop: 24 }} aria-label="Self Delivery issues">
      <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>Self Delivery issues (seller's own courier)</h3>
      <p style={{ margin: '0 0 10px', fontSize: 12.5, color: '#64748b' }}>Failed delivery attempts and customer “not received” reports. Seller earnings for a reported order stay unposted until you decide.</p>
      {!rows.length ? <p style={{ fontSize: 12.5 }}>Nothing needs review.</p> : (
        <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
          <thead><tr style={{ textAlign: 'left' }}><th>Order</th><th>Status</th><th>Courier · tracking</th><th>Issue</th><th /></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row._id} style={{ borderTop: '1px solid #e2e8f0' }}>
              <td>{row.orderNo}</td>
              <td>{row.status}</td>
              <td>{row.externalShipment?.courierName} · {row.externalShipment?.awb}</td>
              <td>{row.externalShipment?.dispute?.status === 'open' ? `Customer: not received — ${row.externalShipment.dispute.reason}` : `Failed attempt — ${row.externalShipment?.failure?.reason || ''}`}</td>
              <td><button type="button" className="sa-btn" onClick={() => { setActive(row); setForm({ action: row.externalShipment?.dispute?.status === 'open' ? 'confirm_delivered' : 'mark_out_for_delivery', reason: '', restock: false }); }}>Decide</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {active && (
        <div className="sa-card" style={{ padding: 12, marginTop: 12 }}>
          <strong>Order {active.orderNo}</strong>
          <label style={{ display: 'block', marginTop: 8 }}>Decision
            <select className="sa-input" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
              {ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {form.action === 'cancel_refund' && <label style={{ display: 'block', marginTop: 8 }}><input type="checkbox" checked={form.restock} onChange={(e) => setForm({ ...form, restock: e.target.checked })} /> The parcel is back with the seller — restore stock</label>}
          <label style={{ display: 'block', marginTop: 8 }}>Note (required)
            <textarea className="sa-input" rows={2} maxLength={300} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </label>
          <button type="button" className="sa-btn" disabled={saving} onClick={submit}>{saving ? 'Saving…' : 'Save decision'}</button>
          <button type="button" className="sa-btn" disabled={saving} onClick={() => setActive(null)} style={{ marginLeft: 8 }}>Close</button>
        </div>
      )}
    </section>
  );
}
