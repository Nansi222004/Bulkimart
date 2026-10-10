import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { adminGet, adminPost, adminPatch, adminDelete } from '../../../utils/adminApi';
import { apiUrl } from '../../../utils/api';

/**
 * Admin Campaigns / Deals.
 *
 * A Campaign is DISCOUNT/DEAL only — it never touches Product.price and
 * never carries seller payment/advertising fields (that's a separate,
 * future Seller Promotion domain). Publishing generates one PENDING
 * CampaignParticipation row per currently-eligible product; a seller
 * decides for themselves which of their own products actually join.
 */

const STOREFRONT_LABEL = { grocery: 'Quick Commerce', ecommerce: 'Shop All', shg: 'SHG', general: 'All' };

const emptyForm = {
  name: '', description: '', imageFile: null, imageUrl: '', autoCreateBanner: true,
  targetType: 'CATEGORY', targetCategoryId: '', targetProductIds: [],
  discountValue: '', startDate: '', endDate: '', isEnabled: true,
};

const toDatetimeLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const LIFECYCLE_CLASS = { DRAFT: 'pending', DISABLED: 'rejected', SCHEDULED: 'processing', EXPIRED: 'rejected', ACTIVE: 'approved' };

export const CampaignsTab = () => {
  const { triggerToast } = useAdmin();

  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [categoryOptions, setCategoryOptions] = useState([]);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminGet('/campaigns');
      setCampaigns(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load campaigns');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/categories?type=grocery&parent=null'));
        const groceryRows = await res.json().catch(() => []);
        const res2 = await fetch(apiUrl('/api/categories?type=ecommerce&parent=null'));
        const ecomRows = await res2.json().catch(() => []);
        setCategoryOptions([...(groceryRows || []), ...(ecomRows || [])]);
      } catch {
        setCategoryOptions([]);
      }
    })();
  }, [showModal]);

  const searchProducts = async () => {
    try {
      const res = await adminGet(`/products?search=${encodeURIComponent(productQuery)}&status=approved&limit=8`);
      setProductResults(res.data || []);
    } catch {
      setProductResults([]);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (q && !(c.name || '').toLowerCase().includes(q)) return false;
      if (statusFilter !== 'All' && c.lifecycle !== statusFilter) return false;
      return true;
    });
  }, [campaigns, search, statusFilter]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setProductResults([]); setProductQuery(''); setShowModal(true); };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name || '', description: c.description || '',
      imageFile: null, imageUrl: c.bannerImage || '', autoCreateBanner: true,
      targetType: c.targetType || 'CATEGORY',
      targetCategoryId: c.targetCategory?._id || c.targetCategory || '',
      targetProductIds: (c.targetProducts || []).map(String),
      discountValue: c.discountValue || '',
      startDate: toDatetimeLocal(c.startAt), endDate: toDatetimeLocal(c.endAt),
      isEnabled: c.isEnabled !== false,
    });
    setProductResults([]);
    setProductQuery('');
    setShowModal(true);
  };

  const openDetail = async (c) => {
    setDetailLoading(true);
    setDetail({ ...c });
    try {
      const res = await adminGet(`/campaigns/${c._id}`);
      setDetail(res.data);
    } catch (err) {
      triggerToast(err.message || 'Could not load campaign detail');
    } finally {
      setDetailLoading(false);
    }
  };

  const buildPayload = (isDraft) => {
    const fd = new FormData();
    fd.append('name', form.name);
    fd.append('description', form.description);
    fd.append('targetType', form.targetType);
    if (form.targetType === 'CATEGORY') fd.append('targetCategory', form.targetCategoryId);
    if (form.targetType === 'PRODUCTS') fd.append('targetProducts', JSON.stringify(form.targetProductIds));
    if (form.discountValue !== '') fd.append('discountValue', String(form.discountValue));
    if (form.startDate) fd.append('startAt', new Date(form.startDate).toISOString());
    if (form.endDate) fd.append('endAt', new Date(form.endDate).toISOString());
    fd.append('isEnabled', String(form.isEnabled));
    fd.append('isDraft', String(isDraft));
    fd.append('autoCreateBanner', String(form.autoCreateBanner));
    if (form.imageFile) fd.append('image', form.imageFile);
    else if (form.imageUrl) fd.append('bannerImage', form.imageUrl);
    return fd;
  };

  const save = async (isDraft) => {
    if (!form.name.trim()) { triggerToast('Give the campaign a name.'); return; }
    setSaving(true);
    try {
      const payload = buildPayload(isDraft);
      if (editing) await adminPatch(`/campaigns/${editing._id}`, payload);
      else await adminPost('/campaigns', payload);
      triggerToast(isDraft ? 'Saved as draft.' : (editing ? 'Campaign updated.' : 'Campaign published — eligible sellers notified.'));
      setShowModal(false);
      await load();
    } catch (err) {
      triggerToast(err.message || 'Could not save the campaign');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (c) => {
    try {
      await adminPatch(`/campaigns/${c._id}`, { isEnabled: !c.isEnabled });
      triggerToast(!c.isEnabled ? 'Campaign enabled.' : 'Campaign disabled.');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not update the campaign');
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete "${c.name}"? This only works if no seller has responded yet.`)) return;
    try {
      await adminDelete(`/campaigns/${c._id}`);
      triggerToast('Campaign deleted.');
      load();
    } catch (err) {
      triggerToast(err.message || 'Could not delete the campaign');
    }
  };

  const toggleProduct = (id) => setForm((f) => ({
    ...f,
    targetProductIds: f.targetProductIds.includes(id) ? f.targetProductIds.filter((p) => p !== id) : [...f.targetProductIds, id],
  }));

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Campaigns / Deals</h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {campaigns.length} Total
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Discount campaigns customers see once eligible sellers accept participation.
          </p>
        </div>
        <button className="sa-btn-primary" onClick={openCreate}>+ Create Campaign</button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" className="sa-search-input" placeholder="Search campaigns by name..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          {['DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'DISABLED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Name', 'Target', 'Discount', 'Start', 'End', 'Participation', 'Status'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>
                {campaigns.length === 0 ? 'No campaigns yet.' : 'No campaigns match your filters.'}
              </td></tr>
            ) : filtered.map((c, i) => (
              <tr key={c._id} style={{ borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                <td style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--sa-text-primary)', cursor: 'pointer' }} onClick={() => openDetail(c)}>{c.name}</td>
                <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>
                  {c.targetType === 'CATEGORY' ? (c.targetCategory?.name || '—') : `${(c.targetProducts || []).length} product(s)`}
                </td>
                <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{c.discountValue}% OFF</td>
                <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{c.startAt ? new Date(c.startAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{c.endAt ? new Date(c.endAt).toLocaleDateString('en-IN') : '—'}</td>
                <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>
                  {c.participationCounts ? `${c.participationCounts.accepted} accepted / ${c.participationCounts.pending} pending` : '—'}
                </td>
                <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${LIFECYCLE_CLASS[c.lifecycle]}`}>{c.lifecycle}</span></td>
                <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => openEdit(c)}>Edit</button>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => toggleEnabled(c)}>
                    {c.isEnabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, color: 'var(--sa-error)' }} onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---- Create/Edit modal ---- */}
      {showModal && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 560 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{editing ? 'Edit Campaign' : 'Create Campaign'}</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={fieldLabel}>Campaign Name</label>
                <input style={fieldInput} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Summer Special 2027" />
              </div>
              <div>
                <label style={fieldLabel}>Description (optional)</label>
                <textarea style={{ ...fieldInput, resize: 'vertical' }} rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>

              <div>
                <label style={fieldLabel}>Campaign Banner Image (optional)</label>
                <input type="file" accept="image/*" onChange={(e) => setForm((f) => ({ ...f, imageFile: e.target.files?.[0] || null }))} style={{ fontSize: 12 }} />
                <span style={{ fontSize: 10, color: 'var(--sa-text-muted)', display: 'block', marginTop: 3 }}>
                  Recommended size: 1200 x 450 px (Aspect Ratio ~2.6 : 1)
                </span>
                {(form.imageFile || form.imageUrl) && (
                  <img
                    src={form.imageFile ? URL.createObjectURL(form.imageFile) : form.imageUrl}
                    alt="" style={{ marginTop: 8, width: '100%', maxHeight: 110, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--sa-border)', backgroundColor: '#f8fafc' }}
                  />
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, marginTop: 8 }}>
                  <input type="checkbox" checked={form.autoCreateBanner} onChange={(e) => setForm((f) => ({ ...f, autoCreateBanner: e.target.checked }))} />
                  Auto-publish as Homepage Hero Carousel Banner
                </label>
              </div>

              <div>
                <label style={fieldLabel}>Target Type</label>
                <select className="sa-select" style={{ width: '100%' }} value={form.targetType} onChange={(e) => setForm((f) => ({ ...f, targetType: e.target.value }))}>
                  <option value="CATEGORY">Category</option>
                  <option value="PRODUCTS">Specific Products</option>
                </select>
              </div>

              {form.targetType === 'CATEGORY' ? (
                <div>
                  <label style={fieldLabel}>Target Category</label>
                  <select className="sa-select" style={{ width: '100%' }} value={form.targetCategoryId} onChange={(e) => setForm((f) => ({ ...f, targetCategoryId: e.target.value }))}>
                    <option value="">Select a category…</option>
                    {categoryOptions.map((c) => <option key={c._id} value={c._id}>{c.name} ({STOREFRONT_LABEL[c.type] || c.type})</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label style={fieldLabel}>Target Products ({form.targetProductIds.length} selected)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input style={{ ...fieldInput, flex: 1 }} value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchProducts(); } }} placeholder="Search approved products…" />
                    <button type="button" className="sa-action-btn" style={{ width: 'auto', padding: '0 14px' }} onClick={searchProducts}>Search</button>
                  </div>
                  {productResults.length > 0 && (
                    <div style={{ marginTop: 6, border: '1px solid var(--sa-border)', borderRadius: 8, maxHeight: 160, overflowY: 'auto' }}>
                      {productResults.map((p) => (
                        <label key={p._id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--sa-border)' }}>
                          <input type="checkbox" checked={form.targetProductIds.includes(p._id)} onChange={() => toggleProduct(p._id)} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel}>Discount %</label>
                  <input type="number" min="1" max="100" style={fieldInput} value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))} placeholder="30" />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, alignSelf: 'end', marginBottom: 9 }}>
                  <input type="checkbox" checked={form.isEnabled} onChange={(e) => setForm((f) => ({ ...f, isEnabled: e.target.checked }))} />
                  Enabled
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={fieldLabel}>Start</label>
                  <input type="datetime-local" style={fieldInput} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label style={fieldLabel}>End</label>
                  <input type="datetime-local" style={fieldInput} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button className="sa-action-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={saving} onClick={() => save(true)}>
                  Save Draft
                </button>
                <button className="sa-btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={() => save(false)}>
                  {saving ? 'Saving…' : (editing ? 'Update Campaign' : 'Publish Campaign')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Detail drawer ---- */}
      {detail && (
        <div className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 560 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{detail.name}</h3>
              <button className="admin-modal-close" onClick={() => setDetail(null)}>✕</button>
            </div>
            {detailLoading ? (
              <p style={{ color: 'var(--sa-text-muted)', fontSize: 12.5 }}>Loading…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--sa-text-secondary)' }}>{detail.description}</p>
                <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
                  <span><b>{detail.discountValue}%</b> OFF</span>
                  <span>{detail.startAt ? new Date(detail.startAt).toLocaleDateString('en-IN') : '—'} → {detail.endAt ? new Date(detail.endAt).toLocaleDateString('en-IN') : '—'}</span>
                </div>
                {detail.summary && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[
                      ['Sellers', detail.summary.eligibleSellers], ['Pending', detail.summary.pending],
                      ['Accepted', detail.summary.accepted], ['Rejected', detail.summary.rejected],
                    ].map(([label, val]) => (
                      <div key={label} style={{ background: '#f8fafc', border: '1px solid var(--sa-border)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
                        <div style={{ fontSize: 16, fontWeight: 900, color: 'var(--sa-text-primary)' }}>{val}</div>
                        <div style={{ fontSize: 10, color: 'var(--sa-text-muted)', textTransform: 'uppercase' }}>{label}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid var(--sa-border)', borderRadius: 10 }}>
                  {(detail.participation || []).map((row) => (
                    <div key={row._id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--sa-border)', display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>{row.productId?.name || 'Product'} — {row.sellerId?.businessName || row.sellerId?.storeDetails?.name || 'Seller'}</span>
                      <span className={`sa-status-pill ${row.status === 'ACCEPTED' ? 'approved' : row.status === 'REJECTED' ? 'rejected' : 'pending'}`}>{row.status}</span>
                    </div>
                  ))}
                  {(!detail.participation || detail.participation.length === 0) && (
                    <p style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--sa-text-muted)' }}>No participation yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const fieldLabel = { display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 };
const fieldInput = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--sa-border)', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

export default CampaignsTab;
