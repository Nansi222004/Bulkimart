import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPatch } from '../../../utils/adminApi';

/**
 * Admin — Promotion Packages: the price catalog Seller Promotions is sold
 * against (Section 12/13). A price change here only ever affects future
 * purchases — a promotion already bought keeps its own snapshot
 * (packageNameSnapshot/durationDaysSnapshot/amountSnapshot on
 * SellerPromotion), preserving the price paid at purchase time.
 */

const money = (n) => '₹' + Math.round(Number(n) || 0);
const MODULE_LABEL = { QUICK: 'Quick', ECOMMERCE: 'E-Commerce' };

const emptyForm = { name: '', module: 'QUICK', durationDays: '', price: '', maxProducts: '', placement: 'HOME_HERO', isActive: true };

export const PromotionPackagesTab = () => {
  const { triggerToast } = useAdmin();
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet(`/promotion-packages${moduleFilter !== 'all' ? `?module=${moduleFilter}` : ''}`);
      setPackages(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load packages');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [moduleFilter]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setShowModal(true); };
  const openEdit = (pkg) => {
    setEditing(pkg);
    setForm({
      name: pkg.name, module: pkg.module, durationDays: pkg.durationDays, price: pkg.price,
      maxProducts: pkg.maxProducts, placement: pkg.placement, isActive: pkg.isActive,
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { triggerToast('Give the package a name.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name, module: form.module, durationDays: Number(form.durationDays), price: Number(form.price),
        maxProducts: Number(form.maxProducts), placement: form.placement, isActive: form.isActive,
      };
      // module is fixed once a package exists — the update payload below
      // simply won't be read for it (see backend updatePromotionPackage).
      if (editing) await adminPatch(`/promotion-packages/${editing._id}`, payload);
      else await adminPost('/promotion-packages', payload);
      triggerToast(editing ? 'Package updated.' : 'Package created.');
      setShowModal(false);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not save the package');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (pkg) => {
    try {
      await adminPatch(`/promotion-packages/${pkg._id}`, { isActive: !pkg.isActive });
      triggerToast(!pkg.isActive ? 'Package enabled.' : 'Package disabled.');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not update the package');
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Promotion Packages</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            The price list sellers choose from when buying a promotion. Editing only affects future purchases.
          </p>
        </div>
        <button className="sa-btn-primary" onClick={openCreate}>+ Create Package</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <select className="sa-select" value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)}>
          <option value="all">All Modules</option>
          <option value="QUICK">Quick</option>
          <option value="ECOMMERCE">E-Commerce</option>
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Name', 'Module', 'Duration', 'Price', 'Max Products', 'Placement', 'Status'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : packages.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No packages yet.</td></tr>
            ) : packages.map((p, i) => (
              <tr key={p._id} style={{ borderBottom: i === packages.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800 }}>{p.name}</td>
                <td style={{ padding: '12px 16px' }}>{MODULE_LABEL[p.module] || p.module}</td>
                <td style={{ padding: '12px 16px' }}>{p.durationDays} days</td>
                <td style={{ padding: '12px 16px' }}>{money(p.price)}</td>
                <td style={{ padding: '12px 16px' }}>{p.maxProducts}</td>
                <td style={{ padding: '12px 16px' }}>{p.placement}</td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${p.isActive ? 'approved' : 'rejected'}`}>{p.isActive ? 'Active' : 'Disabled'}</span></td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => openEdit(p)}>Edit</button>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => toggleActive(p)}>
                    {p.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 480 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{editing ? 'Edit Package' : 'Create Package'}</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={fieldLabel}>Package Name</label>
                <input style={fieldInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Quick Weekly" />
              </div>
              <div>
                <label style={fieldLabel}>Module</label>
                <select className="sa-select" style={{ width: '100%' }} value={form.module} disabled={!!editing}
                  onChange={(e) => setForm((f) => ({ ...f, module: e.target.value }))}>
                  <option value="QUICK">Quick Commerce</option>
                  <option value="ECOMMERCE">E-Commerce / Shop All</option>
                </select>
                {editing && <span style={{ fontSize: 10, color: 'var(--sa-text-muted)' }}>Module can't change once a package exists — disable it and create a new one instead.</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel}>Duration (days)</label>
                  <input type="number" min="1" style={fieldInput} value={form.durationDays} onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))} placeholder="15" />
                </div>
                <div>
                  <label style={fieldLabel}>Price (₹)</label>
                  <input type="number" min="0" style={fieldInput} value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} placeholder="499" />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel}>Max Products</label>
                  <input type="number" min="1" style={fieldInput} value={form.maxProducts} onChange={(e) => setForm((f) => ({ ...f, maxProducts: e.target.value }))} placeholder="5" />
                </div>
                <div>
                  <label style={fieldLabel}>Placement</label>
                  <select className="sa-select" style={{ width: '100%' }} value={form.placement} onChange={(e) => setForm((f) => ({ ...f, placement: e.target.value }))}>
                    <option value="HOME_HERO">Home Hero Carousel</option>
                  </select>
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                Active
              </label>
              <button className="sa-btn-primary" style={{ justifyContent: 'center' }} disabled={saving} onClick={save}>
                {saving ? 'Saving…' : (editing ? 'Update Package' : 'Create Package')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const fieldLabel = { display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 };
const fieldInput = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--sa-border)', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

export default PromotionPackagesTab;
