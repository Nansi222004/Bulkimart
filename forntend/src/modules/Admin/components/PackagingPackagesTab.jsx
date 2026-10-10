import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPatch } from '../../../utils/adminApi';

/**
 * Admin — Packaging Packages: the predefined bundle builder (e.g. "NHCONE
 * Ghee Starter Package" = 50 Jars + 40 Bottles + 9 Pouches). The subtotal
 * shown here is display-only — the backend recomputes it from CURRENT
 * material prices on every read (services/packaging.service.js::pricePackage)
 * and, separately, freezes a purchase-time snapshot on every PackagingOrder.
 */

const money = (n) => '₹' + Math.round(Number(n) || 0);
const STATUS_BADGE = { DRAFT: 'pending', PUBLISHED: 'approved', DISABLED: 'rejected' };

export const PackagingPackagesTab = () => {
  const { triggerToast } = useAdmin();
  const [packages, setPackages] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [items, setItems] = useState([]); // [{materialId, quantity}]
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [pkgRes, matRes] = await Promise.all([
        adminGet(`/packaging/packages${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`),
        adminGet('/packaging/materials?status=active'),
      ]);
      setPackages(pkgRes.data || []);
      setMaterials(matRes.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load packages');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openCreate = () => {
    setEditing(null); setName(''); setDescription(''); setImageFile(null); setItems([]);
    setShowModal(true);
  };
  const openEdit = (pkg) => {
    setEditing(pkg);
    setName(pkg.name);
    setDescription(pkg.description || '');
    setImageFile(null);
    setItems((pkg.items || []).map((i) => ({ materialId: String(i.materialId || i.material?._id), quantity: i.quantity })));
    setShowModal(true);
  };

  const addItemRow = () => setItems((prev) => [...prev, { materialId: '', quantity: 1 }]);
  const removeItemRow = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItemRow = (idx, patch) => setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));

  const liveSubtotal = items.reduce((sum, it) => {
    const m = materials.find((mm) => String(mm._id) === String(it.materialId));
    const qty = Number(it.quantity) || 0;
    return sum + (m ? m.unitPrice * qty : 0);
  }, 0);
  const liveTotalItems = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

  const save = async () => {
    if (!name.trim()) { triggerToast('Give the package a name.'); return; }
    if (items.length === 0) { triggerToast('Add at least one material.'); return; }
    for (const it of items) {
      if (!it.materialId) { triggerToast('Every row needs a material selected.'); return; }
      if (!Number.isInteger(Number(it.quantity)) || Number(it.quantity) <= 0) { triggerToast('Every quantity must be a whole number greater than zero.'); return; }
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('description', description);
      fd.append('items', JSON.stringify(items.map((it) => ({ materialId: it.materialId, quantity: Number(it.quantity) }))));
      if (imageFile) fd.append('image', imageFile);

      if (editing) await adminPatch(`/packaging/packages/${editing._id}`, fd);
      else await adminPost('/packaging/packages', fd);
      triggerToast(editing ? 'Package updated.' : 'Package created as draft.');
      setShowModal(false);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not save the package');
    } finally {
      setSaving(false);
    }
  };

  const publish = async (pkg) => {
    try {
      await adminPatch(`/packaging/packages/${pkg._id}/publish`);
      triggerToast('Package published — sellers can now purchase it.');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not publish the package');
    }
  };
  const disable = async (pkg) => {
    try {
      await adminPatch(`/packaging/packages/${pkg._id}/disable`);
      triggerToast('Package disabled — no new purchases; existing orders unaffected.');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not disable the package');
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Packaging Packages</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Predefined bundles sellers can buy. Publish to make one purchasable.
          </p>
        </div>
        <button className="sa-btn-primary" onClick={openCreate}>+ Create Package</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Packages</option>
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Package', 'Materials', 'Total Items', 'Subtotal', 'Status'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : packages.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No packages yet.</td></tr>
            ) : packages.map((p, i) => (
              <tr key={p._id} style={{ borderBottom: i === packages.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800 }}>{p.name}</td>
                <td style={{ padding: '12px 16px' }}>{(p.items || []).length} kind(s)</td>
                <td style={{ padding: '12px 16px' }}>{p.totalItems}</td>
                <td style={{ padding: '12px 16px' }}>{money(p.subtotal)}</td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${STATUS_BADGE[p.status]}`}>{p.status}</span></td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => openEdit(p)}>Edit</button>
                  {p.status !== 'PUBLISHED' ? (
                    <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => publish(p)}>Publish</button>
                  ) : (
                    <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => disable(p)}>Disable</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 560 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{editing ? 'Edit Package' : 'Create Package'}</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={fieldLabel}>Package Name</label>
                <input style={fieldInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bulkimart Ghee Starter Package" />
              </div>
              <div>
                <label style={fieldLabel}>Description</label>
                <textarea style={{ ...fieldInput, resize: 'vertical' }} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div>
                <label style={fieldLabel}>Image</label>
                <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
              </div>

              <div>
                <label style={fieldLabel}>Materials & Quantities</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((it, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <select className="sa-select" style={{ flex: 2 }} value={it.materialId} onChange={(e) => updateItemRow(idx, { materialId: e.target.value })}>
                        <option value="">Select material…</option>
                        {materials.map((m) => <option key={m._id} value={m._id}>{m.name} ({money(m.unitPrice)})</option>)}
                      </select>
                      <input type="number" min="1" style={{ ...fieldInput, flex: 1 }} value={it.quantity}
                        onChange={(e) => updateItemRow(idx, { quantity: e.target.value })} placeholder="Qty" />
                      <button className="sa-action-btn" style={{ width: 'auto', padding: '6px 10px' }} onClick={() => removeItemRow(idx)}>✕</button>
                    </div>
                  ))}
                </div>
                <button className="sa-action-btn" style={{ width: 'auto', padding: '6px 12px', marginTop: 8 }} onClick={addItemRow}>+ Add Material</button>
              </div>

              <div style={{ background: '#f8fafc', border: '1px solid var(--sa-border)', borderRadius: 10, padding: 12, display: 'flex', justifyContent: 'space-between', fontSize: 12.5, fontWeight: 800 }}>
                <span>Total Items: {liveTotalItems}</span>
                <span>Subtotal: {money(liveSubtotal)}</span>
              </div>
              <p style={{ margin: 0, fontSize: 10.5, color: 'var(--sa-text-muted)' }}>Live preview only — the server recalculates this from current prices on every save.</p>

              <button className="sa-btn-primary" style={{ justifyContent: 'center' }} disabled={saving} onClick={save}>
                {saving ? 'Saving…' : (editing ? 'Update Package' : 'Create Package (Draft)')}
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

export default PackagingPackagesTab;
