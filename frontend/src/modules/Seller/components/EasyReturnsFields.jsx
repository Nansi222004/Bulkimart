import React from 'react';

// Easy Returns, shown inside "Allow Returns" (backend: services/easyReturns.service.js).
// The seller only sets the extra charge. The return window is the one chosen under Allow Returns
// (resolved by the server), and the policy text has a standard default.
// No Easy Returns = the variant's normal price; Easy Returns = normal price + extra charge.

export const defaultEasyReturnsPolicy = (days) => `Return for any reason within ${days} day${days === 1 ? '' : 's'} of delivery. Without Easy Returns, only a wrong, damaged or defective item can be returned.`;

export const easyReturnsFormDefaults = { easyReturnsEnabled: false, easyReturnsExtraCharge: '', easyReturnsPolicyText: '', easyReturnsConditions: '' };

export const easyReturnsFormFromProduct = (product) => {
  const cfg = product?.easyReturns;
  if (!cfg?.enabled) return { ...easyReturnsFormDefaults };
  return {
    easyReturnsEnabled: true,
    easyReturnsExtraCharge: cfg.extraCharge ?? '',
    // A default sentence is left empty so it follows future window changes.
    easyReturnsPolicyText: cfg.policyText && cfg.policyText !== defaultEasyReturnsPolicy(cfg.windowDays) ? cfg.policyText : '',
    easyReturnsConditions: (cfg.conditions || []).join('\n'),
  };
};

/** The JSON the backend expects in the `easyReturns` form field. Off whenever returns are off. */
export const easyReturnsPayload = (form) => JSON.stringify(form.easyReturnsEnabled && form.returnable ? {
  enabled: true,
  extraCharge: Number(form.easyReturnsExtraCharge),
  policyText: String(form.easyReturnsPolicyText || '').trim(),
  conditions: String(form.easyReturnsConditions || '').split('\n').map((c) => c.trim()).filter(Boolean),
} : { enabled: false });

/** Same rules as the server; returns a list of messages. */
export const validateEasyReturns = (form) => {
  if (!form.easyReturnsEnabled || !form.returnable) return [];
  const errors = [];
  const charge = Number(form.easyReturnsExtraCharge);
  if (form.easyReturnsExtraCharge === '' || !Number.isFinite(charge) || charge < 0) errors.push('Enter the Easy Returns extra charge (0 or more)');
  else if (Math.round(charge * 100) !== charge * 100) errors.push('Easy Returns extra charge can have at most 2 decimal places');
  if (String(form.easyReturnsConditions || '').split('\n').map((c) => c.trim()).filter(Boolean).length > 10) errors.push('Add at most 10 return conditions');
  return errors;
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function EasyReturnsFields({ form, setForm, basePrice, windowDays }) {
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const charge = Number(form.easyReturnsExtraCharge) || 0;
  const base = Number(basePrice);
  const hasBase = Number.isFinite(base) && base > 0;
  const days = Number(windowDays) > 0 ? Number(windowDays) : null;
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border-color)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
        <input type="checkbox" checked={Boolean(form.easyReturnsEnabled)} onChange={(e) => set('easyReturnsEnabled', e.target.checked)} />
        <span style={{ fontSize: 12.5, fontWeight: 800 }}>🔁 Also offer Easy Returns (paid option)</span>
      </label>
      <p style={{ margin: '4px 0 0 26px', fontSize: 11, color: 'var(--text-secondary)' }}>
        Customers who pay a little extra can return for any reason. Others pay the normal price and can return only a wrong, damaged or defective item.
      </p>
      {form.easyReturnsEnabled && (
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <label className="onboarding-label">Easy Returns extra charge (₹ per unit)
            <input className="onboarding-input" type="number" min="0" step="0.01" placeholder="e.g. 40" autoFocus
              value={form.easyReturnsExtraCharge} onChange={(e) => set('easyReturnsExtraCharge', e.target.value)} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }} aria-live="polite">
            <div style={{ border: '1.5px solid #08B9E8', background: '#ecfeff', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#0369a1' }}>With Easy Returns</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{hasBase ? money(base + charge) : `Price + ${money(charge)}`}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Any reason · {days ? `${days} days` : 'return window above'}</div>
            </div>
            <div style={{ border: '1.5px solid #f97316', background: '#fff7ed', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#c2410c' }}>Without Easy Returns</div>
              <div style={{ fontSize: 16, fontWeight: 800 }}>{hasBase ? money(base) : 'Normal price'}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-secondary)' }}>Wrong, damaged or defective only</div>
            </div>
          </div>
          {!hasBase && <p style={{ fontSize: 11, margin: 0, color: 'var(--text-secondary)' }}>Prices appear once you set the selling price in Item Variants.</p>}
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#0369a1' }}>Customize policy text (optional)</summary>
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              <label className="onboarding-label">Policy shown to customers
                <textarea className="onboarding-input" rows={3} maxLength={1000} placeholder={defaultEasyReturnsPolicy(days || 7)}
                  value={form.easyReturnsPolicyText} onChange={(e) => set('easyReturnsPolicyText', e.target.value)} />
              </label>
              <label className="onboarding-label">Return conditions (one per line)
                <textarea className="onboarding-input" rows={2} placeholder={'Unused, with original tags\nIn original packaging'}
                  value={form.easyReturnsConditions} onChange={(e) => set('easyReturnsConditions', e.target.value)} />
              </label>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
