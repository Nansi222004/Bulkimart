import React, { useEffect, useState } from 'react';
import { authGet, authPost } from '../../../utils/adminApi';

/**
 * What riders are paid, per delivery mode.
 *
 * Quick and Same-Day are separate jobs and carry separate rate cards, so this
 * screen never presents a single "delivery rate" — an admin raising Same-Day pay
 * must not quietly raise Quick pay with it.
 *
 * Every figure shown is produced by the server's own riderPayout(), including
 * the live calculator. A formula written here would be a second opinion about
 * money, and the one time this codebase had two of those a rider was shown ₹97
 * and paid ₹37.
 */

const MODES = [
  { id: 'quick',    label: 'Quick Commerce', hint: 'Groceries, delivered in minutes', accent: '#0ea5e9' },
  { id: 'same_day', label: 'Same-Day',       hint: 'Shop All orders promised today',  accent: '#16a34a' },
];

const money = (n) => '₹' + Math.round(Number(n) || 0);

const Field = ({ label, value, onChange, prefix, suffix, placeholder }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 120 }}>
    <label style={{ fontSize: 10.5, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
      {label}
    </label>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      border: '1.5px solid #cbd5e1', borderRadius: 8, padding: '9px 10px', backgroundColor: '#fff',
    }}>
      {prefix && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#64748b' }}>{prefix}</span>}
      <input
        type="number"
        min="0"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ border: 'none', outline: 'none', fontSize: 13, fontWeight: 700, width: '100%', color: '#0f172a' }}
      />
      {suffix && <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', whiteSpace: 'nowrap' }}>{suffix}</span>}
    </div>
  </div>
);

const RateCard = ({ mode, current, onSaved, onToast }) => {
  const [perKm, setPerKm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!current) return;
    setPerKm(String(current.perKm ?? ''));
  }, [current]);

  const dirty = current && (
    String(current.perKm) !== String(perKm)
    || Number(current.base) !== 0
    || Number(current.minPayout) !== 0
    || current.maxPayout !== undefined
  );

  const save = async () => {
    setSaving(true);
    try {
      await authPost('/api/admin/delivery-rates', {
        mode: mode.id,
        base: 0,
        perKm: Number(perKm),
        minPayout: 0,
        maxPayout: undefined,
        note: undefined,
      });
      onToast(`${mode.label} rider pay updated.`);
      await onSaved();
    } catch (err) {
      onToast(err.message || 'Could not save the rate');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16,
      padding: 18, display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: mode.accent }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a' }}>{mode.label}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{mode.hint}</div>
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

      {/* Live figures, before anything is typed. */}
      <div style={{
        display: 'flex', gap: 18, padding: '10px 14px', borderRadius: 10, backgroundColor: '#f8fafc',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Currently paying</div>
          <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>
            {money(current?.perKm)}/km
          </div>
        </div>
        {current?.updatedAt && (
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Since</div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#334155', paddingTop: 2 }}>
              {new Date(current.effectiveFrom || current.updatedAt).toLocaleDateString()}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field label="Distance pay" value={perKm} onChange={setPerKm} prefix="₹" suffix="/ km" />
      </div>

      <button
        type="button"
        disabled={!dirty || saving || !perKm}
        onClick={save}
        style={{
          alignSelf: 'flex-start', padding: '10px 22px', borderRadius: 10, border: 'none',
          fontSize: 12.5, fontWeight: 800,
          cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
          backgroundColor: (!dirty || saving) ? '#e2e8f0' : mode.accent,
          color: (!dirty || saving) ? '#94a3b8' : '#ffffff',
        }}
      >
        {saving ? 'Saving…' : dirty ? `Update ${mode.label} pay` : 'No changes'}
      </button>

      <p style={{ fontSize: 10.5, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
        Applies to deliveries accepted from now on. A rider already on a trip keeps
        the rate they accepted.
      </p>
    </div>
  );
};



/**
 * What a CUSTOMER pays for delivery — a flat fee, always charged.
 *
 * Deliberately its own card, below and visually separated from Rider Pay
 * Rates above: same page for convenience, but never blended into one
 * "delivery rate" concept — a shopper's fee and a rider's pay have never
 * been the same number in this codebase. No free-delivery threshold —
 * every order pays this, waived only by an empty cart or a free-shipping
 * coupon (backend/services/pricing.service.js).
 */
const CustomerDeliveryChargeCard = ({ onToast }) => {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [flatFee, setFlatFee] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await authGet('/api/admin/delivery-charge');
      setCurrent(res.data?.current || null);
      setHistory(res.data?.history || []);
    } catch (err) {
      onToast(err.message || 'Could not load the delivery charge');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!current) return;
    setFlatFee(String(current.flatFee ?? ''));
  }, [current]);

  const dirty = current && String(current.flatFee) !== String(flatFee);

  const save = async () => {
    setSaving(true);
    try {
      await authPost('/api/admin/delivery-charge', { flatFee: Number(flatFee) });
      onToast('Customer delivery charge updated.');
      await load();
    } catch (err) {
      onToast(err.message || 'Could not save the delivery charge');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 30 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Customer Delivery Charge</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
          What a shopper pays at checkout — separate from what a rider earns above. Charged on every order.
        </p>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: '#64748b', padding: '30px 0' }}>Loading…</p>
      ) : (
        <div style={{
          backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 16,
          padding: 18, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18, maxWidth: 420,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8a3b25' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#0f172a' }}>Standard delivery</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>Applies to every Quick and Shop All order</div>
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

          <div style={{
            display: 'flex', gap: 18, padding: '10px 14px', borderRadius: 10, backgroundColor: '#f8fafc',
          }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>Currently charging</div>
              <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{money(current?.flatFee)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Field label="Delivery charge" value={flatFee} onChange={setFlatFee} prefix="₹" />
          </div>

          <button
            type="button"
            disabled={!dirty || saving || !flatFee}
            onClick={save}
            style={{
              alignSelf: 'flex-start', padding: '10px 22px', borderRadius: 10, border: 'none',
              fontSize: 12.5, fontWeight: 800,
              cursor: (!dirty || saving) ? 'not-allowed' : 'pointer',
              backgroundColor: (!dirty || saving) ? '#e2e8f0' : '#8a3b25',
              color: (!dirty || saving) ? '#94a3b8' : '#ffffff',
            }}
          >
            {saving ? 'Saving…' : dirty ? 'Update delivery charge' : 'No changes'}
          </button>

          <p style={{ fontSize: 10.5, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
            Applies to every cart priced from now on — the cart, checkout and order total all read this live.
            No free-delivery threshold — waived only by an empty cart or a free-shipping coupon.
          </p>
        </div>
      )}

      {history.length > 0 && (
        <div style={{
          marginTop: 18, backgroundColor: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: 16, overflow: 'hidden', maxWidth: 620,
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0f172a' }}>Change history</span>
          </div>
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  {['Charge', 'From', 'Changed by'].map((h) => (
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
                      {money(r.flatFee)}
                      {r.isActive && (
                        <span style={{
                          marginLeft: 8, fontSize: 9, fontWeight: 800, padding: '2px 6px',
                          borderRadius: 8, backgroundColor: '#dcfce7', color: '#166534',
                        }}>LIVE</span>
                      )}
                    </td>
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

export const DeliveryRatesTab = () => {
  const [current, setCurrent] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await authGet('/api/admin/delivery-rates');
      setCurrent(res.data?.current || []);
      setHistory(res.data?.history || []);
    } catch (err) {
      setToast(err.message || 'Could not load rates');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  return (
    <div style={{ padding: 24, fontFamily: "'Outfit', sans-serif" }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: '#0f172a' }}>Rider Pay Rates</h2>
        <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
          What a delivery partner earns per trip. Quick and Same-Day are configured separately.
        </p>
      </div>

      {toast && (
        <div style={{
          margin: '14px 0', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700,
          backgroundColor: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0',
        }}>
          {toast}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: '#64748b', padding: '30px 0' }}>Loading rates…</p>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 18, marginTop: 18,
        }}>
          {MODES.map((mode) => (
            <RateCard
              key={mode.id}
              mode={mode}
              current={current.find((c) => c.mode === mode.id)}
              onSaved={load}
              onToast={showToast}
            />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{
          marginTop: 26, backgroundColor: '#ffffff', border: '1px solid #e2e8f0',
          borderRadius: 16, overflow: 'hidden',
        }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: '#0f172a' }}>Rate history</span>
            <span style={{ fontSize: 11, color: '#64748b', marginLeft: 8 }}>
              Rates are never overwritten — each change is kept.
            </span>
          </div>
          <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc' }}>
                  {['Mode', 'Per km', 'From', 'Changed by'].map((h) => (
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
                      {r.mode === 'quick' ? 'Quick' : 'Same-Day'}
                      {r.isActive && (
                        <span style={{
                          marginLeft: 8, fontSize: 9, fontWeight: 800, padding: '2px 6px',
                          borderRadius: 8, backgroundColor: '#dcfce7', color: '#166534',
                        }}>LIVE</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 18px', fontSize: 12, color: '#334155' }}>{money(r.perKm)}/km</td>
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

      <CustomerDeliveryChargeCard onToast={showToast} />
    </div>
  );
};

export default DeliveryRatesTab;
