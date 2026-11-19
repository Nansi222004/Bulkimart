import React, { useEffect, useState } from 'react';
import { authGet, authPost } from '../../../utils/adminApi';
import { useAdmin } from '../context/AdminContext';

/**
 * Rider "Go To" (destination) mode. A rider heading somewhere (usually home) sets a
 * destination and then receives only orders whose pickup and drop are along their
 * route, in their direction. Applies to shop orders and parcels.
 */
const FIELDS = [
  ['dailyLimit', 'Uses per rider per day', 'How many times a rider can switch Go To on each day (India time). Rapido allows 2.', 1, 20, 1],
  ['corridorKm', 'Distance from the route (km)', 'How far the pickup and the drop may be from the rider’s road. Example: 2 means within 2 km either side.', 0.2, 20, 0.1],
  ['maxDetourKm', 'Maximum extra distance (km)', 'How much further the order may make the rider’s trip compared with going straight to the destination.', 0, 50, 0.5],
  ['maxPickupKm', 'Maximum distance to the pickup (km)', 'The pickup must be within this distance of the rider, so customers are not kept waiting.', 0.5, 100, 0.5],
  ['maxDurationMinutes', 'Switch off automatically after (minutes)', 'Go To also switches off when the rider reaches the destination (within 500 m).', 10, 720, 5],
];
const DEFAULTS = { isEnabled: true, corridorKm: 2, maxDetourKm: 4, maxPickupKm: 10, dailyLimit: 2, maxDurationMinutes: 120 };
const card = { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' };

export const GoToSettingsTab = () => {
  const { triggerToast } = useAdmin();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(DEFAULTS);
  const [form, setForm] = useState(DEFAULTS);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authGet('/api/admin/go-to-setting');
      const c = { ...DEFAULTS, ...((res.data || res).active || {}) };
      const values = { isEnabled: c.isEnabled !== false, ...Object.fromEntries(FIELDS.map(([k]) => [k, c[k]])) };
      setSaved(values); setForm(values);
    } catch (err) {
      triggerToast(err.message || 'Could not load Go To settings', { type: 'error' });
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = JSON.stringify(saved) !== JSON.stringify(form);
  const save = async () => {
    setSaving(true);
    try {
      await authPost('/api/admin/go-to-setting', { ...form, ...Object.fromEntries(FIELDS.map(([k]) => [k, Number(form[k])])) });
      triggerToast('Go To settings saved.');
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not save Go To settings', { type: 'error' });
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b', fontSize: 13.5, fontWeight: 600 }}>Loading Go To settings…</div>;

  return (
    <div style={{ padding: '20px 16px', maxWidth: 860, margin: '0 auto', fontFamily: "'Inter', sans-serif", color: '#0f172a' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div style={{ flex: '1 1 320px' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}><span>🧭</span><span>Rider Go To Mode</span></h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
            A rider heading somewhere, such as home, sets a destination in the rider app. While Go To is on they receive only shop orders and parcels whose pickup and drop are along their route, in their direction. Normal nearby orders going elsewhere are not offered to them.
          </p>
        </div>
        <button type="button" onClick={save} disabled={saving || !dirty}
          style={{ padding: '10px 22px', borderRadius: 10, border: 'none', background: dirty ? '#10b981' : '#e2e8f0', color: dirty ? '#ffffff' : '#94a3b8', fontWeight: 700, fontSize: 13, cursor: dirty ? 'pointer' : 'default' }}>
          {saving ? 'Saving…' : dirty ? 'Save Changes' : 'Saved ✓'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <label style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer' }}>
          <span>
            <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>Let riders use Go To</span>
            <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#64748b' }}>When off, the Go To button is hidden and any rider using it gets normal orders again.</span>
          </span>
          <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))} style={{ width: 22, height: 22, accentColor: '#10b981', flexShrink: 0 }} />
        </label>

        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
          {FIELDS.map(([k, label, help, min, max, step]) => (
            <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 700 }}>
              {label}
              <input type="number" min={min} max={max} step={step} value={form[k]} disabled={!form.isEnabled}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
                style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 14, fontWeight: 600, background: form.isEnabled ? '#fff' : '#f1f5f9' }} />
              <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b' }}>{help}</span>
            </label>
          ))}
        </div>

        <div style={{ ...card, background: '#f8fafc', fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
          <strong style={{ color: '#0f172a' }}>Example with these settings:</strong> a rider going home {Number(form.corridorKm) || 0} km either side of their road gets an order only when the shop (or parcel pickup) and the customer are both near that road, the customer is further along than the shop, the shop is within {Number(form.maxPickupKm) || 0} km of the rider, and the trip home gets no more than {Number(form.maxDetourKm) || 0} km longer. They can do this {Number(form.dailyLimit) || 0} time{Number(form.dailyLimit) === 1 ? '' : 's'} a day.
        </div>
      </div>
    </div>
  );
};

export default GoToSettingsTab;
