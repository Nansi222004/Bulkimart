import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../utils/api';
import { advertisingMoney, GST_CHOICES, packageCharge } from './advertisingApi';

const STOREFRONTS = { ECOMMERCE: ['Shop All', 'ecommerce'], QUICK: ['Quick Commerce', 'grocery'] };

// The admin package form: only the decisions an admin makes. Everything else is filled in by packagePayload.
export default function AdvertisingPackageForm({ value, busy, onCancel, onSave }) {
  const [form, setForm] = useState(value), [categories, setCategories] = useState(null);
  const set = patch => setForm(f => ({ ...f, ...patch }));
  const type = STOREFRONTS[form.module][1];
  useEffect(() => {
    let alive = true; setCategories(null);
    fetch(apiUrl(`/api/categories?type=${type}`)).then(r => r.json()).then(body => {
      if (!alive) return;
      const rows = (Array.isArray(body) ? body : body.data || []).filter(c => c.isActive !== false);
      const byId = new Map(rows.map(c => [String(c._id), c]));
      setCategories(rows.map(c => ({ id: String(c._id), name: byId.get(String(c.parent))?.name ? `${byId.get(String(c.parent)).name} › ${c.name}` : c.name }))
        .sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => alive && setCategories([]));
    return () => { alive = false; };
  }, [type]);
  const charge = packageCharge(Math.round(Number(form.price) * 100), form.gst, form.gstRate);
  const pickCategory = (id, on) => set({ categories: on ? [...form.categories, id] : form.categories.filter(c => c !== id) });
  const missingCategories = !form.allCategories && !form.categories.length;

  return <div className="ad-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ad-package-title" onClick={onCancel}>
    <div className="ad-modal-dialog" onClick={e => e.stopPropagation()}>
      <div className="ad-modal-header">
        <div className="ad-modal-header-text">
          <span className="ad-modal-badge">Advertising package</span>
          <h3 id="ad-package-title">{form.id ? 'Edit package' : 'Create package'}</h3>
          <p className="ad-modal-subtitle">Sellers buy this to show their products as “Sponsored” at the top of a category page.</p>
        </div>
        <button type="button" className="ad-modal-close-btn" onClick={onCancel} aria-label="Close dialog">✕</button>
      </div>
      <form className="ad-modal-form" onSubmit={e => { e.preventDefault(); if (!missingCategories) onSave(form); }}>
        <div className="ad-modal-body">
          <div className="ad-form-section">
            <div className="ad-form-section-header"><span className="ad-section-icon">📦</span><h4>Package</h4></div>
            <label className="ad-field"><span className="ad-field-title">Package name</span>
              <input required maxLength={120} placeholder="e.g. 7-Day Category Spotlight" value={form.name} onChange={e => set({ name: e.target.value })} /></label>
            <label className="ad-field"><span className="ad-field-title">Short description (optional)</span>
              <input maxLength={300} placeholder="e.g. Your products at the top of the category page" value={form.description} onChange={e => set({ description: e.target.value })} /></label>
            <div className="ad-field"><span className="ad-field-title">Storefront</span>
              <div className="ad-segmented" role="group" aria-label="Storefront">
                {Object.entries(STOREFRONTS).map(([key, [label]]) => <button type="button" key={key} aria-pressed={form.module === key}
                  disabled={!!form.id} onClick={() => set({ module: key, categories: [] })}>{label}</button>)}
              </div>
              {form.id && <small className="ad-help">The storefront of a saved package cannot change. Create a new package for the other storefront.</small>}
            </div>
            <div className="ad-field"><span className="ad-field-title">Which categories can sellers advertise in?</span>
              <div className="ad-segmented" role="group" aria-label="Categories">
                <button type="button" aria-pressed={form.allCategories} onClick={() => set({ allCategories: true })}>All categories</button>
                <button type="button" aria-pressed={!form.allCategories} onClick={() => set({ allCategories: false })}>Choose categories</button>
              </div>
              {!form.allCategories && (categories === null ? <p className="ad-help" role="status">Loading categories…</p>
                : !categories.length ? <p className="ad-help">No active {STOREFRONTS[form.module][0]} categories found.</p>
                : <div className="ad-category-picks">{categories.map(c => <label key={c.id} className={form.categories.includes(c.id) ? 'selected' : ''}>
                    <input type="checkbox" checked={form.categories.includes(c.id)} onChange={e => pickCategory(c.id, e.target.checked)} />{c.name}</label>)}</div>)}
              {missingCategories && <p className="ad-help ad-help-warn" role="alert">Choose at least one category, or select All categories.</p>}
            </div>
          </div>

          <div className="ad-form-section">
            <div className="ad-form-section-header"><span className="ad-section-icon">💰</span><h4>Price and duration</h4></div>
            <div className="ad-form-grid-3">
              <label className="ad-field"><span className="ad-field-title">Price (₹)</span>
                <input required type="number" min="1" step="0.01" placeholder="e.g. 999" value={form.price} onChange={e => set({ price: e.target.value })} /></label>
              <label className="ad-field"><span className="ad-field-title">Runs for (days)</span>
                <input required type="number" min="1" max="365" step="1" value={form.durationDays} onChange={e => set({ durationDays: e.target.value })} /></label>
              <label className="ad-field"><span className="ad-field-title">Products per ad (1–20)</span>
                <input required type="number" min="1" max="20" step="1" value={form.maxProducts} onChange={e => set({ maxProducts: e.target.value })} /></label>
            </div>
            <div className="ad-form-grid">
              <label className="ad-field"><span className="ad-field-title">GST</span>
                <select value={form.gst} onChange={e => set({ gst: e.target.value })}>{Object.entries(GST_CHOICES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              {form.gst !== 'NONE' && <label className="ad-field"><span className="ad-field-title">GST rate (%)</span>
                <input required type="number" min="0" max="100" step="0.01" value={form.gstRate} onChange={e => set({ gstRate: e.target.value })} /></label>}
            </div>
            {charge && <p className="ad-package-summary" role="status">Seller pays <strong>{advertisingMoney(charge.totalPaise)}</strong>
              {charge.taxPaise ? ` (${advertisingMoney(charge.basePaise)} + ${advertisingMoney(charge.taxPaise)} GST)` : ''} to show up to {form.maxProducts || '…'} products for {form.durationDays || '…'} days.</p>}
          </div>

          <div className="ad-toggle-cards">
            <label className="ad-toggle-card">
              <input type="checkbox" checked={form.isActive} disabled={form.archived} onChange={e => set({ isActive: e.target.checked })} />
              <span className="ad-toggle-text"><strong>Show to sellers</strong><small>Sellers can choose this package when they create a campaign.</small></span>
            </label>
            {form.id && <label className="ad-toggle-card">
              <input type="checkbox" checked={form.archived} onChange={e => set({ archived: e.target.checked, isActive: e.target.checked ? false : form.isActive })} />
              <span className="ad-toggle-text"><strong>Retire this package</strong><small>No new campaigns can use it. Campaigns already bought keep their terms.</small></span>
            </label>}
          </div>
        </div>
        <div className="ad-modal-footer">
          <p className="ad-modal-disclaimer">Refunds, cancellation terms and sales tracking use Bulkimart’s standard rules. Sellers pay after you approve their campaign.</p>
          <div className="ad-modal-buttons">
            <button type="button" disabled={busy} onClick={onCancel}>Cancel</button>
            <button className="ad-primary" disabled={busy || missingCategories}>{form.id ? 'Save changes' : 'Save package'}</button>
          </div>
        </div>
      </form>
    </div>
  </div>;
}
