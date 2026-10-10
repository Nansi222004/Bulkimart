import React, { useEffect, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPatch } from '../../../utils/adminApi';

/**
 * Admin — Packaging Materials: the price catalog packaging Packages/Bulk
 * Orders are priced against. A price change here only ever affects future
 * purchases — every PackagingOrder line item snapshots name/type/
 * specification/price at purchase time (see backend PackagingOrder.js).
 */

const money = (n) => '₹' + Math.round(Number(n) || 0);
const emptyForm = { name: '', materialType: '', specification: '', unitPrice: '', description: '' };

export const PackagingMaterialsTab = () => {
  const { triggerToast } = useAdmin();
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet(`/packaging/materials${statusFilter !== 'all' ? `?status=${statusFilter}` : ''}`);
      setMaterials(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load materials');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setImageFile(null); setShowModal(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({ name: m.name, materialType: m.materialType, specification: m.specification || '', unitPrice: m.unitPrice, description: m.description || '' });
    setImageFile(null);
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) { triggerToast('Give the material a name.'); return; }
    if (!form.materialType.trim()) { triggerToast('Give the material a type (e.g. Jar, Bottle, Box).'); return; }
    const price = Number(form.unitPrice);
    if (!Number.isFinite(price) || price < 0) { triggerToast('Enter a valid, non-negative unit price.'); return; }

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', form.name);
      fd.append('materialType', form.materialType);
      fd.append('specification', form.specification);
      fd.append('unitPrice', price);
      fd.append('description', form.description);
      if (imageFile) fd.append('image', imageFile);

      if (editing) await adminPatch(`/packaging/materials/${editing._id}`, fd);
      else await adminPost('/packaging/materials', fd);
      triggerToast(editing ? 'Material updated.' : 'Material created.');
      setShowModal(false);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not save the material');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (m) => {
    try {
      await adminPatch(`/packaging/materials/${m._id}/status`, { isActive: !m.isActive });
      triggerToast(!m.isActive ? 'Material activated.' : 'Material deactivated.');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not update the material');
    }
  };

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Packaging Materials</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Jars, bottles, pouches, boxes — priced here. Editing a price only affects future purchases.
          </p>
        </div>
        <button className="sa-btn-primary" onClick={openCreate}>+ Add Material</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All Materials</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Material', 'Type', 'Specification', 'Unit Price', 'Status'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : materials.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>No packaging materials yet.</td></tr>
            ) : materials.map((m, i) => (
              <tr key={m._id} style={{ borderBottom: i === materials.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {m.image && <img src={m.image} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--sa-border)' }} />}
                  {m.name}
                </td>
                <td style={{ padding: '12px 16px' }}>{m.materialType}</td>
                <td style={{ padding: '12px 16px' }}>{m.specification || '—'}</td>
                <td style={{ padding: '12px 16px' }}>{money(m.unitPrice)}</td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${m.isActive ? 'approved' : 'rejected'}`}>{m.isActive ? 'Active' : 'Inactive'}</span></td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => openEdit(m)}>Edit</button>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10 }} onClick={() => toggleActive(m)}>
                    {m.isActive ? 'Deactivate' : 'Activate'}
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
              <h3 className="admin-modal-title">{editing ? 'Edit Material' : 'Add Material'}</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={fieldLabel}>Material Name</label>
                <input style={fieldInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Bulkimart Ghee Jar" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel}>Material Type</label>
                  <input style={fieldInput} value={form.materialType} onChange={(e) => setForm((f) => ({ ...f, materialType: e.target.value }))} placeholder="Jar" />
                </div>
                <div>
                  <label style={fieldLabel}>Specification</label>
                  <input style={fieldInput} value={form.specification} onChange={(e) => setForm((f) => ({ ...f, specification: e.target.value }))} placeholder="1 KG" />
                </div>
              </div>
              <div>
                <label style={fieldLabel}>Unit Price (₹)</label>
                <input type="number" min="0" style={fieldInput} value={form.unitPrice} onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))} placeholder="12" />
              </div>
              <div>
                <label style={fieldLabel}>Description</label>
                <textarea style={{ ...fieldInput, resize: 'vertical' }} rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <label style={fieldLabel}>Image</label>
                <input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
              </div>
              <button className="sa-btn-primary" style={{ justifyContent: 'center' }} disabled={saving} onClick={save}>
                {saving ? 'Saving…' : (editing ? 'Update Material' : 'Create Material')}
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

export default PackagingMaterialsTab;
