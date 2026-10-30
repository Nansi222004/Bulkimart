import React, { useState, useEffect } from 'react';
import { adminGet, adminPost } from '../../../utils/adminApi';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';

export const HelplineSettingsTab = () => {
  const ui = useFeedback();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeConfig, setActiveConfig] = useState({
    sosEmergencyNumber: '112',
    bulkimartHelplineNumber: '1800-111-2233',
    sellerHelplineNumber: '1800-111-2233',
    riderHelplineNumber: '1800-111-2233',
    description: '',
  });

  const [form, setForm] = useState({
    sosEmergencyNumber: '112',
    bulkimartHelplineNumber: '1800-111-2233',
    sellerHelplineNumber: '1800-111-2233',
    riderHelplineNumber: '1800-111-2233',
    description: '',
  });

  const [history, setHistory] = useState([]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const res = await adminGet('/helpline-setting');
      if (res?.data?.active) {
        const act = res.data.active;
        const currentData = {
          sosEmergencyNumber: act.sosEmergencyNumber || '112',
          bulkimartHelplineNumber: act.bulkimartHelplineNumber || '1800-111-2233',
          sellerHelplineNumber: act.sellerHelplineNumber || '1800-111-2233',
          riderHelplineNumber: act.riderHelplineNumber || '1800-111-2233',
          description: act.description || '',
        };
        setActiveConfig(currentData);
        setForm(currentData);
      }
      if (Array.isArray(res?.data?.history)) {
        setHistory(res.data.history);
      }
    } catch (err) {
      ui.notify(err.message || 'Could not load helpline settings', { type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!form.sosEmergencyNumber.trim()) {
      ui.notify('Rider SOS emergency number cannot be empty', { type: 'error' });
      return;
    }
    if (!form.sellerHelplineNumber.trim()) {
      ui.notify('Seller helpline number cannot be empty', { type: 'error' });
      return;
    }

    setSaving(true);
    try {
      const res = await adminPost('/helpline-setting', form);
      if (res?.data) {
        ui.notify('Helpline and SOS settings updated successfully!', { type: 'success' });
        loadSettings();
      }
    } catch (err) {
      ui.notify(err.message || 'Failed to update helpline settings', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaults = () => {
    setForm({
      sosEmergencyNumber: '112',
      bulkimartHelplineNumber: '1800-111-2233',
      sellerHelplineNumber: '1800-111-2233',
      riderHelplineNumber: '1800-111-2233',
      description: 'Restored standard India national emergency (112) and platform defaults',
    });
  };

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: 'var(--sa-text-primary)' }}>
            Platform Helpline & Emergency SOS Settings
          </h2>
          <p style={{ margin: '6px 0 0 0', fontSize: 13, color: 'var(--sa-text-secondary)' }}>
            Configure live emergency and customer helpline numbers. Changes immediately update across Delivery, Seller, and Customer applications without app restarts.
          </p>
        </div>
        <button
          type="button"
          onClick={loadSettings}
          disabled={loading}
          style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid var(--sa-border)',
            background: '#fff', color: 'var(--sa-text-primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer'
          }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
        {/* Main form */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Card 1: Rider SOS Emergency */}
          <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1.5px solid #fee2e2', padding: 20, boxShadow: '0 2px 8px rgba(239, 68, 68, 0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>🚨</span>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#991b1b' }}>
                Delivery Rider SOS Emergency Number
              </h3>
            </div>
            <p style={{ margin: '0 0 14px 0', fontSize: 12, color: '#64748b' }}>
              Dialed when a delivery partner taps the <strong>🚨 SOS Emergency Helpline</strong> button in their rider profile during an emergency. Default is India's national emergency number (112).
            </p>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>
                SOS PHONE / DIAL NUMBER
              </label>
              <input
                type="text"
                value={form.sosEmergencyNumber}
                onChange={(e) => setForm({ ...form, sosEmergencyNumber: e.target.value })}
                placeholder="e.g. 112 or +91 98765 43210"
                style={{
                  width: '100%', maxWidth: 360, padding: '10px 14px', borderRadius: 8,
                  border: '1px solid #fca5a5', fontSize: 14, fontWeight: 700, outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Card 2: Seller & Rider Helplines */}
          <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid var(--sa-border)', padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>🏬</span>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: 'var(--sa-text-primary)' }}>
                Seller & General Platform Helplines
              </h3>
            </div>
            <p style={{ margin: '0 0 16px 0', fontSize: 12, color: '#64748b' }}>
              Dialed when sellers or customers tap "Call Support" or helpline options.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>
                  SELLER SUPPORT HELPLINE
                </label>
                <input
                  type="text"
                  value={form.sellerHelplineNumber}
                  onChange={(e) => setForm({ ...form, sellerHelplineNumber: e.target.value })}
                  placeholder="e.g. 1800-111-2233"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--sa-border)', fontSize: 14, fontWeight: 700, outline: 'none'
                  }}
                />
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>
                  Toll-free or phone line in Seller app
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>
                  BULKIMART CUSTOMER HELPLINE
                </label>
                <input
                  type="text"
                  value={form.bulkimartHelplineNumber}
                  onChange={(e) => setForm({ ...form, bulkimartHelplineNumber: e.target.value })}
                  placeholder="e.g. 1800-111-2233"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--sa-border)', fontSize: 14, fontWeight: 700, outline: 'none'
                  }}
                />
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>
                  Platform customer support number
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>
                  RIDER NON-EMERGENCY HELPDESK
                </label>
                <input
                  type="text"
                  value={form.riderHelplineNumber}
                  onChange={(e) => setForm({ ...form, riderHelplineNumber: e.target.value })}
                  placeholder="e.g. 1800-111-2233"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--sa-border)', fontSize: 14, fontWeight: 700, outline: 'none'
                  }}
                />
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block', marginTop: 4 }}>
                  Dispatch helpdesk for operational queries
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>
                  CHANGE NOTE / REASON (OPTIONAL)
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. Updated festive support desk"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: '1px solid var(--sa-border)', fontSize: 13, outline: 'none'
                  }}
                />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="submit"
              disabled={saving}
              style={{
                padding: '12px 24px', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
                color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(14,165,233,0.25)'
              }}
            >
              {saving ? 'Saving changes…' : '💾 Save & Publish Helpline Settings'}
            </button>
            <button
              type="button"
              onClick={handleRestoreDefaults}
              style={{
                padding: '12px 18px', borderRadius: 8, border: '1px solid var(--sa-border)',
                background: '#fff', color: '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer'
              }}
            >
              ↺ Reset to Defaults (112 & 1800-111-2233)
            </button>
          </div>
        </form>

        {/* Live Preview Side Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid var(--sa-border)', padding: 18 }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 12, fontWeight: 800, color: 'var(--sa-text-primary)', textTransform: 'uppercase' }}>
              📱 Live App Preview
            </h4>

            {/* Rider SOS Button Preview */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                Rider App SOS Button:
              </div>
              <div style={{
                padding: '12px 14px', borderRadius: 10, backgroundColor: '#dc2626', color: '#fff',
                fontSize: 13, fontWeight: 800, textAlign: 'center', boxShadow: '0 2px 6px rgba(220,38,38,0.3)'
              }}>
                🚨 SOS Emergency Helpline ({form.sosEmergencyNumber || '112'})
              </div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4, textAlign: 'center' }}>
                Dials: tel:{form.sosEmergencyNumber.replace(/[^0-9+]/g, '') || '112'}
              </div>
            </div>

            {/* Seller Call Support Preview */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>
                Seller App Call Support:
              </div>
              <div style={{
                padding: '10px 14px', borderRadius: 10, backgroundColor: '#f8fafc',
                border: '1.5px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8
              }}>
                <span style={{ fontSize: 18 }}>📞</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#0f172a' }}>Call Support</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>{form.sellerHelplineNumber || '1800-111-2233'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Info */}
          <div style={{ backgroundColor: '#f0fdf4', borderRadius: 12, border: '1px solid #bbf7d0', padding: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#166534', marginBottom: 4 }}>
              ✓ Instant Live Sync
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: '#15803d', lineHeight: 1.4 }}>
              When saved, the new numbers are instantly active. Riders, vendors, and buyers will immediately connect to these updated helplines.
            </p>
          </div>
        </div>
      </div>

      {/* History table */}
      {history.length > 0 && (
        <div style={{ marginTop: 32, backgroundColor: '#fff', borderRadius: 14, border: '1px solid var(--sa-border)', padding: 20 }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 800, color: 'var(--sa-text-primary)' }}>
            Audit History & Changes
          </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid var(--sa-border)', color: 'var(--sa-text-muted)' }}>
                <th style={{ padding: '8px 12px' }}>Date</th>
                <th style={{ padding: '8px 12px' }}>Updated By</th>
                <th style={{ padding: '8px 12px' }}>Rider SOS</th>
                <th style={{ padding: '8px 12px' }}>Seller Helpline</th>
                <th style={{ padding: '8px 12px' }}>Customer Helpline</th>
                <th style={{ padding: '8px 12px' }}>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h._id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', color: '#64748b' }}>
                    {h.createdAt ? new Date(h.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                    {h.updatedBy?.name || h.updatedBy?.email || 'Admin'}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 800, color: '#dc2626' }}>
                    {h.sosEmergencyNumber}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                    {h.sellerHelplineNumber}
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>
                    {h.bulkimartHelplineNumber}
                  </td>
                  <td style={{ padding: '10px 12px', color: '#94a3b8' }}>
                    {h.description || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default HelplineSettingsTab;
