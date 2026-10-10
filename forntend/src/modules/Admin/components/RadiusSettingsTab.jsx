import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';

/**
 * Admin — Radius Settings. The three global ceilings (Same-Day / seller
 * service / delivery partner pickup) that bound what a seller or rider is
 * allowed to set for themselves — not the per-seller/per-rider values
 * themselves, which are edited from SellersTab / DeliveryTab.
 *
 * Saving here only changes future validation (and, for Same-Day, the live
 * `Math.min` eligibility clamp) — it never touches an already-stored
 * seller or rider radius.
 */

const FIELDS = [
  { key: 'sameDayMaxRadiusKm', label: 'Same-Day Maximum Radius', hint: 'How far a seller may promise Same-Day delivery.' },
  { key: 'sellerServiceMaxRadiusKm', label: 'Seller Service Maximum Radius', hint: 'How far a seller’s products stay visible/orderable from.' },
  { key: 'deliveryPartnerMaxRadiusKm', label: 'Delivery Partner Maximum Radius', hint: 'How far a rider may set their own pickup radius to.' },
];

const Field = ({ label, hint, value, onChange }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 220 }}>
    <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
      {label}
    </label>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '9px 10px', backgroundColor: '#fff',
    }}>
      <input
        type="number"
        min="0.1"
        max="100"
        step="0.1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ border: 'none', outline: 'none', fontSize: 13, fontWeight: 700, width: '100%', color: '#0f172a' }}
      />
      <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', whiteSpace: 'nowrap' }}>km</span>
    </div>
    <span style={{ fontSize: 10.5, color: '#94a3b8' }}>{hint}</span>
  </div>
);

export const RadiusSettingsTab = () => {
  const { fetchRadiusSettings, setRadiusSettings, triggerToast } = useAdmin();
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({ sameDayMaxRadiusKm: '', sellerServiceMaxRadiusKm: '', deliveryPartnerMaxRadiusKm: '' });
  const [note, setNote] = useState('');

  const load = async () => {
    setLoading(true);
    const data = await fetchRadiusSettings();
    if (data) {
      setCurrent(data.current || null);
      setHistory(data.history || []);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!current) return;
    setValues({
      sameDayMaxRadiusKm: String(current.sameDayMaxRadiusKm ?? ''),
      sellerServiceMaxRadiusKm: String(current.sellerServiceMaxRadiusKm ?? ''),
      deliveryPartnerMaxRadiusKm: String(current.deliveryPartnerMaxRadiusKm ?? ''),
    });
  }, [current]);

  const dirty = current && FIELDS.some((f) => String(current[f.key] ?? '') !== values[f.key]);
  const allFilled = FIELDS.every((f) => values[f.key] !== '' && Number(values[f.key]) > 0);

  const save = async () => {
    setSaving(true);
    const ok = await setRadiusSettings({
      sameDayMaxRadiusKm: Number(values.sameDayMaxRadiusKm),
      sellerServiceMaxRadiusKm: Number(values.sellerServiceMaxRadiusKm),
      deliveryPartnerMaxRadiusKm: Number(values.deliveryPartnerMaxRadiusKm),
      note: note || undefined,
    });
    setSaving(false);
    if (ok) {
      setNote('');
      await load();
    }
  };

  return (
    <div style={{ padding: 24, fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Radius Settings</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
          Platform-wide ceilings for Same-Day, seller service, and delivery partner pickup radii.
          Individual seller/rider radii are edited from Sellers and Delivery Partners.
        </p>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: '#64748b', padding: '30px 0' }}>Loading&hellip;</p>
      ) : (
        <div style={{
          backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: 18, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18, maxWidth: 720,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#0ea5e9' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a' }}>Global Radius Ceilings</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Applies to new radius validations from now on.</div>
            </div>
            {current?.source === 'default' && (
              <span style={{
                fontSize: 9.5, fontWeight: 800, padding: '3px 8px', borderRadius: 10,
                backgroundColor: '#fef3c7', color: '#92400e',
              }}>
                NOT CONFIGURED — USING DEFAULT
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {FIELDS.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={values[f.key]}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
              Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why this change?"
              style={{
                border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '9px 10px',
                fontSize: 12.5, outline: 'none',
              }}
            />
          </div>

          <button
            type="button"
            disabled={!dirty || !allFilled || saving}
            onClick={save}
            style={{
              alignSelf: 'flex-start', padding: '10px 22px', borderRadius: 10, border: 'none',
              fontSize: 12.5, fontWeight: 800,
              cursor: (!dirty || !allFilled || saving) ? 'not-allowed' : 'pointer',
              backgroundColor: (!dirty || !allFilled || saving) ? '#e2e8f0' : '#0ea5e9',
              color: (!dirty || !allFilled || saving) ? '#94a3b8' : '#ffffff',
            }}
          >
            {saving ? 'Saving…' : dirty ? 'Update radius settings' : 'No changes'}
          </button>

          <p style={{ fontSize: 10.5, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
            Lowering a ceiling never changes an already-stored seller or rider radius — it only
            bounds what can be set from now on. Same-Day eligibility re-checks the ceiling live on
            every request, no restart required.
          </p>
        </div>
      )}

      {history.length > 0 && (
        <div style={{
          marginTop: 18, backgroundColor: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: 16, overflow: 'hidden', maxWidth: 900,
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0f172a' }}>Change history</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  {['Same-Day', 'Seller', 'Delivery Partner', 'From', 'Changed by'].map((h) => (
                    <th key={h} style={{
                      padding: '11px 18px', textAlign: 'left', fontSize: 10, fontWeight: 800,
                      color: '#475569', textTransform: 'uppercase', letterSpacing: '0.5px',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r._id} style={{ borderTop: '1px solid #f1f5f9', opacity: r.isActive ? 1 : 0.55 }}>
                    <td style={{ padding: '11px 18px', fontSize: 12, fontWeight: 800, color: '#0f172a' }}>
                      {r.sameDayMaxRadiusKm}km
                      {r.isActive && (
                        <span style={{
                          marginLeft: 8, fontSize: 9, fontWeight: 800, padding: '2px 6px',
                          borderRadius: 8, backgroundColor: '#dcfce7', color: '#166534',
                        }}>LIVE</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 18px', fontSize: 12, color: '#334155' }}>{r.sellerServiceMaxRadiusKm}km</td>
                    <td style={{ padding: '11px 18px', fontSize: 12, color: '#334155' }}>{r.deliveryPartnerMaxRadiusKm}km</td>
                    <td style={{ padding: '11px 18px', fontSize: 11.5, color: '#64748b' }}>
                      {new Date(r.effectiveFrom || r.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: '11px 18px', fontSize: 11.5, color: '#64748b' }}>
                      {r.updatedBy?.name || r.updatedBy?.email || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default RadiusSettingsTab;
