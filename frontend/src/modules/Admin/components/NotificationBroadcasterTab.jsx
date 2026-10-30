import ModalPortal from '../../../components/ModalPortal';
import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPatch, adminDelete, qs } from '../../../utils/adminApi';
import { apiUrl } from '../../../utils/api';

/**
 * Admin — Push Notifications Broadcaster. A real, backend-owned campaign
 * list (GET/POST/PATCH/DELETE /api/admin/broadcasts) — the previous version
 * of this tab (SectionModuleTab's generic `notifications` config) was a
 * pure UI mockup with `data: []` hardcoded and a stub "Add New Entry"
 * button; this replaces it entirely for this one moduleId.
 *
 * Sending REUSES the existing central notification.service.js (via
 * services/broadcast.service.js's audience resolution + notifyUser/
 * notifySeller/notifyRider) — this file only manages the
 * campaign record and the compose form.
 */

const AUDIENCES = [
  { value: 'ALL_CUSTOMERS', label: 'All Customers' },
  { value: 'ALL_SELLERS', label: 'All Sellers' },
  { value: 'ALL_DELIVERY_PARTNERS', label: 'All Delivery Partners' },
];

const CHANNELS = [
  { value: 'PUSH', label: 'Push', real: true },
  { value: 'SOCKET', label: 'In-app', real: true },
  { value: 'EMAIL', label: 'Email', real: false },
  { value: 'SMS', label: 'SMS', real: false },
];

const STATUS_BADGE = {
  DRAFT: { bg: '#f1f5f9', fg: '#475569' },
  SCHEDULED: { bg: '#dbeafe', fg: '#1e40af' },
  PROCESSING: { bg: '#fef3c7', fg: '#92400e' },
  SENT: { bg: '#dcfce7', fg: '#166534' },
  PARTIALLY_SENT: { bg: '#fef3c7', fg: '#92400e' },
  FAILED: { bg: '#fee2e2', fg: '#991b1b' },
  CANCELLED: { bg: '#f1f5f9', fg: '#64748b' },
};

const emptyForm = { title: '', message: '', targetAudience: 'ALL_CUSTOMERS', channels: ['PUSH', 'SOCKET'], deepLink: '', scheduledAt: '', mediaFile: null, mediaPreview: '' };

export const NotificationBroadcasterTab = () => {
  const { triggerToast } = useAdmin();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet(`/broadcasts${qs({ status: statusFilter, search })}`);
      setRows(res.data || []);
      setTotal(res.meta?.total ?? (res.data || []).length);
    } catch (err) {
      triggerToast(err.message || 'Could not load broadcasts', {type:'error'});
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter, search]);

  const openCreate = () => { setForm(emptyForm); setShowModal(true); };

  const pickMedia = (file) => {
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) { triggerToast('Only JPG, PNG, WEBP or SVG images are supported.'); return; }
    if (file.size > 5 * 1024 * 1024) { triggerToast('Image must be under 5 MB.'); return; }
    if (form.mediaPreview) URL.revokeObjectURL(form.mediaPreview);
    setForm((f) => ({ ...f, mediaFile: file, mediaPreview: URL.createObjectURL(file) }));
  };

  const toggleChannel = (value) => {
    setForm((f) => ({ ...f, channels: f.channels.includes(value) ? f.channels.filter((c) => c !== value) : [...f.channels, value] }));
  };

  const submit = async () => {
    if (!form.title.trim()) { triggerToast('Enter an alert title.'); return; }
    if (!form.message.trim()) { triggerToast('Enter a message.'); return; }
    if (form.channels.length === 0) { triggerToast('Pick at least one channel.'); return; }
    if (saving) return; // guards a double-click double-submit

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('title', form.title.trim());
      fd.append('message', form.message.trim());
      fd.append('targetAudience', form.targetAudience);
      fd.append('channels', JSON.stringify(form.channels));
      if (form.deepLink) fd.append('deepLink', form.deepLink.trim());
      if (form.scheduledAt) fd.append('scheduledAt', new Date(form.scheduledAt).toISOString());
      if (form.mediaFile) fd.append('media', form.mediaFile);

      const { message } = await adminPost('/broadcasts', fd);
      triggerToast(message || 'Broadcast created');
      setShowModal(false);
      if (form.mediaPreview) URL.revokeObjectURL(form.mediaPreview);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not create the broadcast', {type:'error'});
    } finally {
      setSaving(false);
    }
  };

  const cancelBroadcast = async (id) => {
    try {
      const { message } = await adminPatch(`/broadcasts/${id}/cancel`, {});
      triggerToast(message || 'Cancelled');
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not cancel', {type:'error'});
    }
  };

  const deleteDraft = async (id) => {
    try {
      const { message } = await adminDelete(`/broadcasts/${id}`);
      triggerToast(message || 'Deleted');
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not delete', {type:'error'});
    }
  };

  const exportCsv = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const res = await fetch(apiUrl(`/api/admin/broadcasts/export${qs({ status: statusFilter, search })}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'broadcasts.csv';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      triggerToast(err.message || 'Could not export CSV', {type:'error'});
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Push Notifications Broadcaster</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
            Broadcast push and in-app alerts to customers, sellers, or delivery partners. Email/SMS are shown for future use — no provider is configured today, so those channels are recorded as Not Configured, never faked as sent.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 10, padding: '10px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
            Export CSV
          </button>
          <button onClick={openCreate} style={{ border: 'none', background: '#0ea5e9', color: '#fff', borderRadius: 10, padding: '10px 16px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
            + Add New Entry
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '18px 0', flexWrap: 'wrap' }}>
        <input
          type="text" placeholder="Filter push notifications broadcaster..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 220, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 12.5 }}>
          <option value="">All Statuses</option>
          {Object.keys(STATUS_BADGE).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', fontSize: 11.5, fontWeight: 800, color: '#64748b' }}>{total} Total Records</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['Notif ID', 'Alert Title', 'Target Audience', 'Channel Type', 'Sent Time', 'Open Rate', 'Status'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', textAlign: 'right' }} />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}>No matching records found.</td></tr>
            ) : rows.map((b) => {
              const badge = STATUS_BADGE[b.status] || STATUS_BADGE.DRAFT;
              return (
                <tr key={b._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 11 }}>{String(b._id).slice(-8)}</td>
                  <td style={{ padding: '12px 16px', fontWeight: 700 }}>
                    {b.media?.url && <img src={b.media.url} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', marginRight: 6, verticalAlign: 'middle' }} />}
                    {b.title}
                  </td>
                  <td style={{ padding: '12px 16px' }}>{AUDIENCES.find((a) => a.value === b.targetAudience)?.label || b.targetAudience}</td>
                  <td style={{ padding: '12px 16px' }}>{(b.channels || []).join(', ')}</td>
                  <td style={{ padding: '12px 16px' }}>{b.sentAt ? new Date(b.sentAt).toLocaleString('en-IN') : (b.scheduledAt ? `Scheduled: ${new Date(b.scheduledAt).toLocaleString('en-IN')}` : '—')}</td>
                  <td style={{ padding: '12px 16px' }}>{b.deliveredCount > 0 ? `${b.openRate}%` : '—'}</td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 999, background: badge.bg, color: badge.fg }}>{b.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {['DRAFT', 'SCHEDULED'].includes(b.status) && (
                      <button onClick={() => cancelBroadcast(b._id)} style={{ border: '1px solid #e2e8f0', background: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer', marginRight: 6 }}>Cancel</button>
                    )}
                    {b.status === 'DRAFT' && (
                      <button onClick={() => deleteDraft(b._id)} style={{ border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', borderRadius: 8, padding: '4px 10px', fontSize: 10, fontWeight: 800, cursor: 'pointer' }}>Delete</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <ModalPortal style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowModal(false)}>
          <div style={{ background: '#fff', borderRadius: 16, width: '92%', maxWidth: 520, maxHeight: '88vh', overflowY: 'auto', padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 900 }}>New Broadcast</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Alert Title *</label>
                <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, marginTop: 4, boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Message *</label>
                <textarea rows={3} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, marginTop: 4, boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Target Audience *</label>
                <select value={form.targetAudience} onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, marginTop: 4 }}>
                  {AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Channels *</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {CHANNELS.map((c) => (
                    <button key={c.value} type="button" onClick={() => toggleChannel(c.value)}
                      style={{
                        border: `1px solid ${form.channels.includes(c.value) ? '#0ea5e9' : '#e2e8f0'}`,
                        background: form.channels.includes(c.value) ? '#e0f2fe' : '#fff',
                        color: form.channels.includes(c.value) ? '#0369a1' : '#64748b',
                        borderRadius: 8, padding: '6px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
                      }}>
                      {c.label}{!c.real && ' (not configured)'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Media (image, optional)</label>
                <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  onChange={(e) => pickMedia(e.target.files?.[0])} style={{ marginTop: 4, fontSize: 12 }} />
                {form.mediaPreview && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <img src={form.mediaPreview} alt="preview" style={{ width: 60, height: 60, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                    <button type="button" onClick={() => { URL.revokeObjectURL(form.mediaPreview); setForm((f) => ({ ...f, mediaFile: null, mediaPreview: '' })); }}
                      style={{ border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                )}
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Deep Link (optional)</label>
                <input type="text" placeholder="/orders" value={form.deepLink} onChange={(e) => setForm((f) => ({ ...f, deepLink: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, marginTop: 4, boxSizing: 'border-box' }} />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#475569' }}>Schedule for later (optional)</label>
                <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 10px', fontSize: 12.5, marginTop: 4, boxSizing: 'border-box' }} />
                <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Leave blank to send immediately.</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ border: '1px solid #e2e8f0', background: '#fff', color: '#475569', borderRadius: 10, padding: '9px 18px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>Close</button>
              <button onClick={submit} disabled={saving} style={{ border: 'none', background: saving ? '#e2e8f0' : '#0ea5e9', color: saving ? '#94a3b8' : '#fff', borderRadius: 10, padding: '9px 18px', fontSize: 12.5, fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Sending…' : (form.scheduledAt ? 'Schedule' : 'Send Now')}
              </button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

export default NotificationBroadcasterTab;
