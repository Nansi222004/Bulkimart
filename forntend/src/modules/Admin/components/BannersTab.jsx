import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import React, { useEffect, useMemo, useState } from 'react';
import { useAdmin } from '../context/AdminContext';
import { authGet, authPost, authPut, authDelete, adminGet, adminPost } from '../../../utils/adminApi';
import { apiUrl } from '../../../utils/api';

/**
 * Admin Banner Management.
 *
 * A Banner is display + discovery + navigation only — never a discount, a
 * seller advertisement, a campaign, or a payment record. Those are future,
 * separate features; this screen only ever writes to the Banner model.
 *
 * `type` is the existing, working storefront scope (which carousel a
 * banner belongs to); `category` is the existing sub-nav tab scope within
 * it. Both predate this rebuild and are left exactly as they worked.
 * What's new here is the action model (CATEGORY/PRODUCT/EXTERNAL_URL/NONE)
 * replacing free-text target routes, and a proper full-screen management
 * page instead of a small modal bolted onto the generic section shell.
 */

const STOREFRONT_OPTIONS = [
  { value: 'grocery', label: 'Quick Commerce' },
  { value: 'ecommerce', label: 'Shop All' },
  { value: 'general', label: 'General (All Storefronts)' },
];

const ACTION_OPTIONS = [
  { value: 'NONE', label: 'No action (informational only)' },
  { value: 'CATEGORY', label: 'Open a category' },
  { value: 'PRODUCT', label: 'Open a product' },
  { value: 'CAMPAIGN', label: 'Open a campaign / deal' },
  { value: 'EXTERNAL_URL', label: 'Open an external link' },
];

const emptyForm = {
  title: '', subtitle: '', imageFile: null, imageUrl: '',
  type: 'grocery', category: 'home',
  actionType: 'NONE', targetCategoryId: '', targetProductId: '', targetProductLabel: '',
  targetCampaignId: '', externalUrl: '',
  priority: 0, startDate: '', endDate: '', isActive: true,
  mobileImage: '', video: '', cta: '', placement: 'HOME_HERO',
};

const toDatetimeLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** DRAFT / SCHEDULED / ACTIVE / EXPIRED / DISABLED — computed, never stored
 *  as its own drifting field (other than the genuinely separate isDraft). */
const lifecycleOf = (b) => {
  if (b.isArchived) return 'Archived';
  if (b.isDraft) return 'Draft';
  if (!b.isActive) return 'Disabled';
  const now = Date.now();
  if (b.startDate && new Date(b.startDate).getTime() > now) return 'Scheduled';
  if (b.endDate && new Date(b.endDate).getTime() <= now) return 'Expired';
  return 'Active';
};
const LIFECYCLE_CLASS = {
  Archived: 'rejected',
  Draft: 'pending', Disabled: 'rejected', Scheduled: 'processing', Expired: 'rejected', Active: 'approved',
};

export const BannersTab = () => {
  const ui = useFeedback();
  const { triggerToast } = useAdmin();

  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const uploadMedia = async (file, field) => {
    if (!file) return;
    setUploading(true);
    try { const data = new FormData(); data.append('media', file); const result = await adminPost('/storefront/media', data); setForm(f => ({ ...f, [field]: result.data.url, ...(field === 'imageUrl' ? { imageFile: null } : {}) })); triggerToast('Media uploaded. Save the banner to use it.'); }
    catch (err) { triggerToast(err.message, { type: 'error' }); }
    finally { setUploading(false); }
  };

  const [categoryOptions, setCategoryOptions] = useState([]);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [campaignOptions, setCampaignOptions] = useState([]);

  const fetchBanners = async () => {
    setLoading(true);
    try {
      const res = await authGet('/api/banners?all=true');
      setBanners(res.data || []);
    } catch (err) {
      triggerToast(err.message || 'Could not load banners', {type:'error'});
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchBanners(); }, []);

  // Real header categories for the storefront the form is currently set to —
  // replaces the old hardcoded 5-item tab lists.
  useEffect(() => {
    if (form.type === 'general') { setCategoryOptions([]); return; }
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/categories?type=${form.type}&parent=null`));
        const rows = await res.json().catch(() => []);
        setCategoryOptions(Array.isArray(rows) ? rows : []);
      } catch {
        setCategoryOptions([]);
      }
    })();
  }, [form.type, showModal]);

  // Every campaign regardless of lifecycle — an admin may deliberately
  // link a banner to a campaign that's still Scheduled, launching both
  // together. The Campaign's own effective-active check still gates what
  // the customer actually sees.
  useEffect(() => {
    if (!showModal) return;
    (async () => {
      try {
        const res = await adminGet('/campaigns');
        setCampaignOptions(res.data || []);
      } catch {
        setCampaignOptions([]);
      }
    })();
  }, [showModal]);

  const searchProducts = async () => {
    setSearchingProducts(true);
    try {
      const res = await adminGet(`/products?search=${encodeURIComponent(productQuery)}&status=approved&limit=8`);
      setProductResults(res.data || []);
    } catch {
      setProductResults([]);
    } finally {
      setSearchingProducts(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return banners.filter((b) => {
      if (q && !(b.title || '').toLowerCase().includes(q)) return false;
      if (typeFilter !== 'All' && b.type !== typeFilter) return false;
      if (statusFilter !== 'All' && lifecycleOf(b) !== statusFilter) return false;
      return true;
    });
  }, [banners, search, typeFilter, statusFilter]);

  const openCreate = () => { setEditing(null); setForm(emptyForm); setProductResults([]); setProductQuery(''); setShowModal(true); };

  const openEdit = (b) => {
    setEditing(b);
    setForm({
      title: b.title || '', subtitle: b.subtitle || '', imageFile: null, imageUrl: b.image || '',
      type: b.type === 'general' ? 'general' : b.type, category: b.category || 'home',
      actionType: b.actionType || 'NONE',
      targetCategoryId: b.targetCategory?._id || b.targetCategory || '',
      targetProductId: b.targetProduct?._id || b.targetProduct || '',
      targetProductLabel: b.targetProduct?.name || '',
      targetCampaignId: b.targetCampaign?._id || b.targetCampaign || '',
      externalUrl: b.externalUrl || '',
      priority: b.priority || 0,
      startDate: toDatetimeLocal(b.startDate), endDate: toDatetimeLocal(b.endDate),
      isActive: b.isActive !== false,
      mobileImage: b.mobileImage || '', video: b.video || '', cta: b.cta || '', placement: b.placement || 'HOME_HERO',
    });
    setProductResults([]);
    setProductQuery('');
    setShowModal(true);
  };

  const buildFormData = (isDraft) => {
    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('subtitle', form.subtitle);
    for (const key of ['mobileImage', 'video', 'cta', 'placement']) fd.append(key, form[key] || '');
    fd.append('type', form.type);
    fd.append('category', form.category);
    fd.append('actionType', form.actionType);
    if (form.actionType === 'CATEGORY') fd.append('targetCategory', form.targetCategoryId);
    if (form.actionType === 'PRODUCT') fd.append('targetProduct', form.targetProductId);
    if (form.actionType === 'CAMPAIGN') fd.append('targetCampaign', form.targetCampaignId);
    if (form.actionType === 'EXTERNAL_URL') fd.append('externalUrl', form.externalUrl);
    fd.append('priority', String(form.priority || 0));
    fd.append('startDate', form.startDate ? new Date(form.startDate).toISOString() : '');
    fd.append('endDate', form.endDate ? new Date(form.endDate).toISOString() : '');
    fd.append('isActive', String(form.isActive));
    fd.append('isDraft', String(isDraft));
    if (form.imageFile) fd.append('image', form.imageFile);
    else if (form.imageUrl) fd.append('image', form.imageUrl);
    return fd;
  };

  const save = async (isDraft) => {
    if (saving || uploading) return;
    if (!form.title.trim()) { triggerToast('Give the banner a title.'); return; }
    if (!form.imageFile && !form.imageUrl) { triggerToast('Upload a banner image.'); return; }

    setSaving(true);
    try {
      const fd = buildFormData(isDraft);
      if (editing) await authPut(`/api/banners/${editing._id}`, fd);
      else await authPost('/api/banners', fd);
      triggerToast(isDraft ? 'Saved as draft.' : (editing ? 'Banner updated.' : 'Banner published.'));
      setShowModal(false);
      await fetchBanners();
    } catch (err) {
      triggerToast(err.message || 'Could not save the banner', {type:'error'});
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (b) => {
    try {
      await authPut(`/api/banners/${b._id}`, { isActive: !b.isActive });
      triggerToast(!b.isActive ? 'Banner enabled.' : 'Banner disabled.');
      fetchBanners();
    } catch (err) {
      triggerToast(err.message || 'Could not update the banner', {type:'error'});
    }
  };

  const restore = async b => {
    try { await authPut(`/api/banners/${b._id}`, { isArchived: false, isDraft: true, isActive: false }); triggerToast('Restored as a disabled draft. Review it before publishing.'); fetchBanners(); }
    catch (err) { triggerToast(err.message, { type: 'error' }); }
  };

  const remove = async (b) => {
    return ui.perform(`Archive "${b.title}"? Its media and history will be preserved.`, async () => {
    try {
      await authDelete(`/api/banners/${b._id}`);
      triggerToast('Banner archived.');
      fetchBanners();
    } catch (err) {
      triggerToast(err.message || 'Could not delete the banner', {type:'error'});
    }

});
};

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sa-text-primary)' }}>Banners</h2>
            <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 12, backgroundColor: 'var(--sa-primary-glow)', color: 'var(--sa-primary)' }}>
              {banners.length} Total
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--sa-text-secondary)' }}>
            Manage customer-facing banners, category discovery and promotional content.
          </p>
        </div>
        <button className="sa-btn-primary" onClick={openCreate}>+ Create Banner</button>
      </div>

      <p style={{ padding: 12, border: '1px solid var(--sa-border)', borderRadius: 10, fontSize: 12, color: 'var(--sa-text-secondary)' }}>
        The default Bulkimart banner appears when no homepage banner is active. Upload artwork, choose Homepage hero and the storefront, then save it as published and enabled to replace the default. Studio-only artwork appears after its promotional campaign is published in Storefront Studio.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, backgroundColor: '#ffffff', padding: 12, borderRadius: 10, border: '1px solid var(--sa-border)' }}>
        <div className="sa-search-wrapper" style={{ flex: 1, width: 'auto' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--sa-text-muted)" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" className="sa-search-input" placeholder="Search banners by title..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="sa-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="All">All Storefronts</option>
          {STOREFRONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="sa-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="All">All Statuses</option>
          {['Draft', 'Scheduled', 'Active', 'Expired', 'Disabled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div tabIndex={0} role="region" aria-label="Scrollable data table" style={{ backgroundColor: '#ffffff', borderRadius: 12, border: '1px solid var(--sa-border)', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--sa-border)' }}>
              {['Image', 'Title', 'Storefront', 'Action', 'Start', 'End', 'Status', 'Order'].map((c) => (
                <th key={c} style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{c}</th>
              ))}
              <th style={{ padding: '12px 16px', fontSize: 10, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 30, textAlign: 'center', color: 'var(--sa-text-muted)' }}>
                {banners.length === 0 ? 'No banners configured yet.' : 'No banners match your filters.'}
              </td></tr>
            ) : filtered.map((b, i) => {
              const status = lifecycleOf(b);
              return (
                <tr key={b._id} style={{ borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--sa-border)' }}>
                  <td style={{ padding: '10px 16px' }}>
                    <img src={b.image} alt={b.title} style={{ width: 64, height: 36, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--sa-border)' }} />
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 800, color: 'var(--sa-text-primary)' }}>{b.title}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>
                    {STOREFRONT_OPTIONS.find((o) => o.value === b.type)?.label || b.type}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>
                    {b.actionType === 'CATEGORY' ? `Category: ${b.targetCategory?.name || '—'}`
                      : b.actionType === 'PRODUCT' ? `Product: ${b.targetProduct?.name || '—'}`
                      : b.actionType === 'CAMPAIGN' ? `Campaign: ${b.targetCampaign?.name || '—'}`
                      : b.actionType === 'EXTERNAL_URL' ? 'External link'
                      : 'None'}
                  </td>
                  <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{b.startDate ? new Date(b.startDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{b.endDate ? new Date(b.endDate).toLocaleDateString('en-IN') : '—'}</td>
                  <td style={{ padding: '12px 16px' }}><span className={`sa-status-pill ${LIFECYCLE_CLASS[status]}`}>{status}</span></td>
                  <td style={{ padding: '12px 16px', color: 'var(--sa-text-secondary)' }}>{b.priority}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => openEdit(b)}>Edit</button>
                    <button disabled={b.isArchived} className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, marginRight: 6 }} onClick={() => toggleActive(b)}>
                      {b.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button disabled={b.isArchived} className="sa-action-btn" style={{ display: 'inline-flex', width: 'auto', padding: '4px 10px', fontSize: 10, color: 'var(--sa-error)' }} onClick={() => remove(b)}>Archive</button>
                    {b.isArchived && <button className="sa-action-btn" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => restore(b)}>Restore draft</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ---- Create/Edit modal ---- */}
      {showModal && (
        <ModalPortal className="admin-modal-overlay">
          <div className="admin-modal-sheet" style={{ maxWidth: 640 }}>
            <div className="admin-modal-header">
              <h3 className="admin-modal-title">{editing ? 'Edit Banner' : 'Create Banner'}</h3>
              <button className="admin-modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div style={{ maxWidth: 520, margin: '0 auto' }}>
              {/* Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={fieldLabel}>Banner Title</label>
                  <input style={fieldInput} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Summer Special" />
                </div>

                <div>
                  <label style={fieldLabel}>Banner Image</label>
                  <input aria-label="Upload desktop artwork or video poster" type="file" disabled={uploading} accept="image/jpeg,image/png,image/webp" onChange={(e) => uploadMedia(e.target.files?.[0], 'imageUrl')} style={{ fontSize: 12 }} />
                  <span style={{ fontSize: 10, color: 'var(--sa-text-muted)', display: 'block', marginTop: 3 }}>
                    Recommended size: 1200 x 450 px or 1000 x 400 px (Aspect Ratio ~2.6 : 1)
                  </span>
                  {(form.imageFile || form.imageUrl) && (
                    <img
                      src={form.imageFile ? URL.createObjectURL(form.imageFile) : form.imageUrl}
                      alt="" style={{ marginTop: 8, width: '100%', maxHeight: 120, objectFit: 'contain', borderRadius: 8, border: '1px solid var(--sa-border)', backgroundColor: '#f8fafc' }}
                    />
                  )}
                </div>

                <label style={fieldLabel}>Reuse image / poster URL<input style={fieldInput} value={form.imageUrl} onChange={e => setForm(f => ({ ...f, imageUrl: e.target.value }))} placeholder="https://… or /uploads/…" /></label>
                <label style={fieldLabel}>Mobile artwork<input aria-label="Upload mobile artwork" type="file" disabled={uploading} accept="image/jpeg,image/png,image/webp" onChange={e => uploadMedia(e.target.files?.[0], 'mobileImage')} /><input style={fieldInput} value={form.mobileImage} onChange={e => setForm(f => ({ ...f, mobileImage: e.target.value }))} placeholder="Optional mobile image URL" /></label>
                <label style={fieldLabel}>Short video (optional, 15 MB maximum)<input aria-label="Upload promotional video" type="file" disabled={uploading} accept="video/mp4,video/webm" onChange={e => uploadMedia(e.target.files?.[0], 'video')} /><input style={fieldInput} value={form.video} onChange={e => setForm(f => ({ ...f, video: e.target.value }))} placeholder="Optional HTTPS video URL" /></label>
                {form.video && <video src={form.video} poster={form.imageUrl} controls muted playsInline preload="none" style={{ width: '100%', maxHeight: 180 }} />}
                {uploading && <p role="status">Uploading media…</p>}
                <label style={fieldLabel}>Subtitle<input style={fieldInput} value={form.subtitle} maxLength={300} onChange={e => setForm(f => ({ ...f, subtitle: e.target.value }))} /></label>
                <label style={fieldLabel}>Button text<input style={fieldInput} value={form.cta} maxLength={60} onChange={e => setForm(f => ({ ...f, cta: e.target.value }))} /></label>
                <label style={fieldLabel}>Placement<select className="sa-select" value={form.placement} onChange={e => setForm(f => ({ ...f, placement: e.target.value }))}><option value="HOME_HERO">Homepage hero (legacy compatible)</option><option value="STUDIO">Studio only (splash, announcement, section or scheduled hero)</option></select></label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={fieldLabel}>Storefront</label>
                    <select className="sa-select" style={{ width: '100%' }} value={form.type}
                      onChange={(e) => setForm((f) => ({ ...f, type: e.target.value, category: 'home', targetCategoryId: '' }))}>
                      {STOREFRONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabel}>Sub-nav Tab</label>
                    <select className="sa-select" style={{ width: '100%' }} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                      <option value="home">My Home (default)</option>
                      {categoryOptions.map((c) => <option key={c._id} value={c.slug}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label style={fieldLabel}>Action</label>
                  <select className="sa-select" style={{ width: '100%' }} value={form.actionType} onChange={(e) => setForm((f) => ({ ...f, actionType: e.target.value }))}>
                    {ACTION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                {form.actionType === 'CATEGORY' && (
                  <div>
                    <label style={fieldLabel}>Target Category</label>
                    <select className="sa-select" style={{ width: '100%' }} value={form.targetCategoryId} onChange={(e) => setForm((f) => ({ ...f, targetCategoryId: e.target.value }))}>
                      <option value="">Select a category…</option>
                      {categoryOptions.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                {form.actionType === 'PRODUCT' && (
                  <div>
                    <label style={fieldLabel}>Target Product</label>
                    {form.targetProductId ? (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', border: '1.5px solid var(--sa-border)', borderRadius: 8, fontSize: 12.5 }}>
                        <span>{form.targetProductLabel || form.targetProductId}</span>
                        <button type="button" onClick={() => setForm((f) => ({ ...f, targetProductId: '', targetProductLabel: '' }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--sa-error)', fontWeight: 800 }}>✕</button>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input style={{ ...fieldInput, flex: 1 }} value={productQuery} onChange={(e) => setProductQuery(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchProducts(); } }} placeholder="Search approved products…" />
                          <button type="button" className="sa-action-btn" style={{ width: 'auto', padding: '0 14px' }} onClick={searchProducts}>
                            {searchingProducts ? '…' : 'Search'}
                          </button>
                        </div>
                        {productResults.length > 0 && (
                          <div style={{ marginTop: 6, border: '1px solid var(--sa-border)', borderRadius: 8, maxHeight: 160, overflowY: 'auto' }}>
                            {productResults.map((p) => (
                              <div key={p._id} onClick={() => setForm((f) => ({ ...f, targetProductId: p._id, targetProductLabel: p.name }))}
                                style={{ padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--sa-border)' }}>
                                {p.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {form.actionType === 'CAMPAIGN' && (
                  <div>
                    <label style={fieldLabel}>Target Campaign</label>
                    <select className="sa-select" style={{ width: '100%' }} value={form.targetCampaignId} onChange={(e) => setForm((f) => ({ ...f, targetCampaignId: e.target.value }))}>
                      <option value="">Select a campaign…</option>
                      {campaignOptions.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.lifecycle})</option>)}
                    </select>
                  </div>
                )}

                {form.actionType === 'EXTERNAL_URL' && (
                  <div>
                    <label style={fieldLabel}>External URL</label>
                    <input style={fieldInput} value={form.externalUrl} onChange={(e) => setForm((f) => ({ ...f, externalUrl: e.target.value }))} placeholder="https://example.com" />
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={fieldLabel}>Start Date</label>
                    <input type="datetime-local" style={fieldInput} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                    <span style={{ fontSize: 10, color: 'var(--sa-text-muted)', display: 'block', marginTop: 2 }}>Leave empty for immediate display</span>
                  </div>
                  <div>
                    <label style={fieldLabel}>End Date</label>
                    <input type="datetime-local" style={fieldInput} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
                  <div>
                    <label style={fieldLabel}>Display Order</label>
                    <input type="number" style={fieldInput} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} />
                    <span style={{ fontSize: 10, color: 'var(--sa-text-muted)' }}>Higher number shows first.</span>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700 }}>
                    <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
                    Enabled
                  </label>
                </div>

                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button className="sa-action-btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={saving} onClick={() => save(true)}>
                    Save Draft
                  </button>
                  <button className="sa-btn-primary" style={{ flex: 1, justifyContent: 'center' }} disabled={saving} onClick={() => save(false)}>
                    {saving ? 'Saving…' : (editing ? 'Update & Publish' : 'Publish Banner')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
};

const fieldLabel = { display: 'block', fontSize: 10.5, fontWeight: 800, color: 'var(--sa-text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 };
const fieldInput = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid var(--sa-border)', fontSize: 13, fontFamily: 'inherit', outline: 'none' };

export default BannersTab;
