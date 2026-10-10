import React, { useEffect, useState } from 'react';
import { apiUrl } from '../../../utils/api';

/**
 * Promotion / Advertisement — paid visibility a seller buys through Admin
 * verification + PhonePe payment. Kept entirely separate from
 * SellerCampaignsTab.jsx (free admin-run discount invitations): nothing
 * here is a discount, and nothing there costs the seller anything.
 *
 * V1: "one advertisement = one module" — a seller picks QUICK or
 * ECOMMERCE as the very first step, and every product/package choice
 * after that is scoped to it. A seller wanting both creates two separate
 * advertisements (mirrors backend/models/SellerPromotion.js's `module`
 * field, fixed at creation and never editable afterwards).
 */

const MODULE_TO_CHANNEL = { QUICK: 'grocery', ECOMMERCE: 'ecommerce' };
const MODULE_LABEL = { QUICK: 'Quick Commerce', ECOMMERCE: 'E-Commerce / Shop All' };

const money = (n) => '₹' + Math.round(Number(n) || 0);
const token = () => localStorage.getItem('userToken');
const authHeaders = (json = true) => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  Authorization: 'Bearer ' + token(),
});

const api = {
  list: (status) => fetch(apiUrl(`/api/sellers/promotions${status && status !== 'all' ? `?status=${status}` : ''}`), { headers: authHeaders(false) }).then((r) => r.json()),
  detail: (id) => fetch(apiUrl(`/api/sellers/promotions/${id}`), { headers: authHeaders(false) }).then((r) => r.json()),
  packages: (moduleName) => fetch(apiUrl(`/api/sellers/promotions/packages?module=${moduleName}`), { headers: authHeaders(false) }).then((r) => r.json()),
  myProducts: (channel) => fetch(apiUrl(`/api/products/seller/mine?type=${channel}&roleContext=seller`), { headers: authHeaders(false) }).then((r) => r.json()),
  myProfile: () => fetch(apiUrl('/api/sellers/me'), { headers: authHeaders(false) }).then((r) => r.json()),
  create: (fd) => fetch(apiUrl('/api/sellers/promotions'), { method: 'POST', headers: authHeaders(false), body: fd }).then((r) => r.json()),
  update: (id, fd) => fetch(apiUrl(`/api/sellers/promotions/${id}`), { method: 'PUT', headers: authHeaders(false), body: fd }).then((r) => r.json()),
  submit: (id) => fetch(apiUrl(`/api/sellers/promotions/${id}/submit`), { method: 'POST', headers: authHeaders() }).then((r) => r.json()),
  resubmit: (id) => fetch(apiUrl(`/api/sellers/promotions/${id}/resubmit`), { method: 'POST', headers: authHeaders() }).then((r) => r.json()),
  cancel: (id) => fetch(apiUrl(`/api/sellers/promotions/${id}/cancel`), { method: 'POST', headers: authHeaders() }).then((r) => r.json()),
  pay: (id) => fetch(apiUrl(`/api/sellers/promotions/${id}/payment`), { method: 'POST', headers: authHeaders() }).then((r) => r.json()),
};

const STATUS_BADGE = {
  DRAFT:             { bg: '#f1f5f9', fg: '#475569', label: 'Draft' },
  PENDING_REVIEW:    { bg: '#e0e7ff', fg: '#3730a3', label: 'Pending Review' },
  CHANGES_REQUESTED: { bg: '#fef3c7', fg: '#92400e', label: 'Changes Requested' },
  APPROVED:          { bg: '#dbeafe', fg: '#1e40af', label: 'Approved' },
  PAYMENT_PENDING:   { bg: '#fef3c7', fg: '#92400e', label: 'Payment Pending' },
  ACTIVE:            { bg: '#dcfce7', fg: '#166534', label: 'Active' },
  EXPIRED:           { bg: '#f1f5f9', fg: '#64748b', label: 'Expired' },
  REJECTED:          { bg: '#fee2e2', fg: '#991b1b', label: 'Rejected' },
  CANCELLED:         { bg: '#f1f5f9', fg: '#64748b', label: 'Cancelled' },
  DISABLED:          { bg: '#fee2e2', fg: '#991b1b', label: 'Disabled' },
};

const label = { display: 'block', fontSize: 10.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 };
const input = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e2e8f0', fontSize: 13, fontFamily: 'inherit', outline: 'none' };
const btnPrimary = { padding: '10px 18px', borderRadius: 10, border: 'none', background: '#10b981', color: '#fff', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' };
const btnGhost = { padding: '10px 18px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' };

const STEPS = ['Module', 'Products', 'Shop', 'Banner & Details', 'Package', 'Preview'];

export const SellerPromotionsTab = () => {
  const [view, setView] = useState('list'); // 'list' | 'wizard' | 'detail'
  const [promotions, setPromotions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ---- wizard state ----
  const [editingId, setEditingId] = useState(null);
  const [step, setStep] = useState(0);
  const [moduleChoice, setModuleChoice] = useState(''); // 'QUICK' | 'ECOMMERCE'
  const [moduleLocked, setModuleLocked] = useState(false); // true once the promotion actually exists
  const [bannerFile, setBannerFile] = useState(null);
  const [bannerPreview, setBannerPreview] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [shop, setShop] = useState(null);
  const [myProducts, setMyProducts] = useState([]);
  const [selectedProductIds, setSelectedProductIds] = useState(new Set());
  const [packages, setPackages] = useState([]);
  const [packageId, setPackageId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (status = statusFilter) => {
    setLoading(true);
    try {
      const res = await api.list(status);
      setPromotions(res.data || []);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [statusFilter]);

  const openDetail = async (id) => {
    setView('detail');
    setDetailLoading(true);
    try {
      const res = await api.detail(id);
      setDetail(res.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadModuleScopedData = async (moduleName) => {
    const channel = MODULE_TO_CHANNEL[moduleName];
    const [shopRes, prodRes, pkgRes] = await Promise.all([api.myProfile(), api.myProducts(channel), api.packages(moduleName)]);
    setShop(shopRes.seller || null);
    const rows = Array.isArray(prodRes) ? prodRes : (prodRes.data || prodRes.products || []);
    setMyProducts(rows);
    setPackages(pkgRes.data || []);
  };

  const openWizard = async (existing) => {
    setEditingId(existing?._id || null);
    setModuleLocked(!!existing);
    setModuleChoice(existing?.module || '');
    setStep(existing ? 1 : 0); // module already fixed once the promotion exists — skip straight past it
    setBannerFile(null);
    setBannerPreview(existing?.bannerImage || '');
    setTitle(existing?.title && existing.title !== 'Untitled promotion' ? existing.title : '');
    setDescription(existing?.description || '');
    setSelectedProductIds(new Set((existing?.selectedProducts || []).map((p) => String(p.id || p))));
    setPackageId(existing?.packageId ? String(existing.packageId) : '');
    setView('wizard');
    if (existing?.module) await loadModuleScopedData(existing.module);
  };

  const startCreate = () => {
    setEditingId(null);
    setModuleLocked(false);
    setModuleChoice('');
    setStep(0);
    setBannerFile(null);
    setBannerPreview('');
    setTitle('');
    setDescription('');
    setSelectedProductIds(new Set());
    setPackageId('');
    setMyProducts([]);
    setPackages([]);
    setView('wizard');
  };

  const chooseModuleAndCreate = async () => {
    if (!moduleChoice) { alert('Select QUICK or E-Commerce first.'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('module', moduleChoice);
      const res = await api.create(fd);
      if (!res.success) { alert(res.message || 'Could not start this advertisement'); return; }
      setEditingId(res.data._id);
      setModuleLocked(true);
      await loadModuleScopedData(moduleChoice);
      setStep(1);
    } finally {
      setSaving(false);
    }
  };

  const toggleProduct = (id) => setSelectedProductIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const saveStep = async (extra = {}) => {
    setSaving(true);
    try {
      const fd = new FormData();
      if (title !== undefined) fd.append('title', title);
      if (description !== undefined) fd.append('description', description);
      if (bannerFile) fd.append('bannerImage', bannerFile);
      if (extra.selectedProducts) fd.append('selectedProducts', JSON.stringify(extra.selectedProducts));
      if (extra.packageId) fd.append('packageId', extra.packageId);
      const res = await api.update(editingId, fd);
      if (!res.success) { alert(res.message || 'Could not save'); return false; }
      return true;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (step === 1) { if (!await saveStep({ selectedProducts: [...selectedProductIds] })) return; }
    else if (step === 4) { if (!await saveStep({ packageId })) return; }
    else if (step !== 0) { if (!await saveStep()) return; }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submitPromotion = async () => {
    setSaving(true);
    try {
      const res = editingId && detail?.status === 'CHANGES_REQUESTED' ? await api.resubmit(editingId) : await api.submit(editingId);
      if (!res.success) { alert(res.message || 'Could not submit'); return; }
      alert('Submitted for admin verification.');
      setView('list');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const payNow = async (id) => {
    const res = await api.pay(id);
    if (!res.success) { alert(res.message || 'Could not start payment'); return; }
    window.location.href = res.data.redirectUrl;
  };

  const cancelIt = async (id) => {
    if (!window.confirm('Cancel this promotion?')) return;
    await api.cancel(id);
    setView('list');
    await load();
  };

  const selectedPackage = packages.find((p) => String(p._id) === String(packageId));

  // ============================================================ WIZARD
  if (view === 'wizard') {
    return (
      <div style={{ padding: 20, maxWidth: 720 }}>
        <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', color: '#10b981', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', marginBottom: 12, padding: 0 }}>
          ← Back to Advertisements
        </button>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{
              flex: 1, minWidth: 90, textAlign: 'center', padding: '8px 4px', borderRadius: 8, fontSize: 11, fontWeight: 800,
              background: i === step ? '#10b981' : i < step ? '#dcfce7' : '#f1f5f9',
              color: i === step ? '#fff' : i < step ? '#166534' : '#94a3b8',
            }}>
              {i + 1}. {s}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              Choose one module for this advertisement. Want visibility on both? Create a second, separate advertisement afterwards.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {['QUICK', 'ECOMMERCE'].map((m) => (
                <label key={m} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: 16, borderRadius: 12, cursor: 'pointer',
                  border: moduleChoice === m ? '2px solid #10b981' : '1.5px solid #e2e8f0',
                }}>
                  <input type="radio" name="module" checked={moduleChoice === m} onChange={() => setModuleChoice(m)} />
                  <span style={{ fontWeight: 800, fontSize: 14 }}>{MODULE_LABEL[m]}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              {MODULE_LABEL[moduleChoice]} products from your own listings ({selectedProductIds.size} selected).
            </p>
            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 12 }}>
              {myProducts.length === 0 ? (
                <p style={{ padding: 20, textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>No {MODULE_LABEL[moduleChoice]} products listed yet.</p>
              ) : myProducts.map((p) => (
                <label key={p._id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}>
                  <input type="checkbox" checked={selectedProductIds.has(String(p._id))} onChange={() => toggleProduct(String(p._id))} style={{ width: 16, height: 16 }} />
                  <img src={p.images?.[0]} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{p.name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#64748b' }}>
                      {money(p.price)} · {p.status === 'approved' && p.isActive ? 'Available' : 'Not available yet'}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>Your shop — loaded automatically, cannot be changed here.</p>
            {shop && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, background: '#fff' }}>
                {shop.storeDetails?.logo && <img src={shop.storeDetails.logo} alt="" style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover' }} />}
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14 }}>{shop.storeDetails?.name || shop.businessName}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{shop.businessName}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                    {[shop.storeDetails?.address, shop.storeDetails?.city, shop.storeDetails?.state].filter(Boolean).join(', ') || 'No address on file'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            <label style={label}>Advertisement Title</label>
            <input style={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer Fresh Fruits" />
            <label style={{ ...label, marginTop: 14 }}>Short Description (optional)</label>
            <textarea style={{ ...input, resize: 'vertical' }} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            <label style={{ ...label, marginTop: 14 }}>Promotion Banner</label>
            <input type="file" accept="image/*" onChange={(e) => {
              const f = e.target.files?.[0] || null;
              setBannerFile(f);
              if (f) setBannerPreview(URL.createObjectURL(f));
            }} style={{ fontSize: 12 }} />
            {bannerPreview && (
              <img src={bannerPreview} alt="" style={{ marginTop: 10, width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: '1px solid #e2e8f0' }} />
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>{MODULE_LABEL[moduleChoice]} packages — set by Admin.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {packages.length === 0 ? (
                <p style={{ fontSize: 12, color: '#94a3b8' }}>No packages available for this module right now — check back later.</p>
              ) : packages.map((pkg) => (
                <label key={pkg._id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderRadius: 12, cursor: 'pointer',
                  border: String(packageId) === String(pkg._id) ? '2px solid #10b981' : '1.5px solid #e2e8f0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="radio" name="pkg" checked={String(packageId) === String(pkg._id)} onChange={() => setPackageId(String(pkg._id))} />
                    <div>
                      <p style={{ margin: 0, fontWeight: 800, fontSize: 13.5 }}>{pkg.name}</p>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>{pkg.durationDays} Days · Up to {pkg.maxProducts} products</p>
                    </div>
                  </div>
                  <b style={{ fontSize: 15, color: '#10b981' }}>{money(pkg.price)}</b>
                </label>
              ))}
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12 }}>
              The duration clock starts only once Admin approves — waiting for review never costs you advertising days.
            </p>
          </div>
        )}

        {step === 5 && (
          <div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>Exactly what the admin will review.</p>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', background: '#fff' }}>
              {bannerPreview && <img src={bannerPreview} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover' }} />}
              <div style={{ padding: 16 }}>
                <span style={{ display: 'inline-block', marginBottom: 8, fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}>
                  {MODULE_LABEL[moduleChoice]}
                </span>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 900 }}>{title || 'Untitled promotion'}</h3>
                <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#64748b' }}>{description}</p>
                <p style={{ margin: '0 0 4px', fontSize: 12.5 }}><b>Shop:</b> {shop?.storeDetails?.name}</p>
                <p style={{ margin: '0 0 4px', fontSize: 12.5 }}><b>Seller:</b> {shop?.businessName}</p>
                <p style={{ margin: '0 0 12px', fontSize: 12.5 }}><b>Address:</b> {[shop?.storeDetails?.address, shop?.storeDetails?.city].filter(Boolean).join(', ')}</p>
                <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 800 }}>Featured Products:</p>
                {myProducts.filter((p) => selectedProductIds.has(String(p._id))).map((p) => (
                  <p key={p._id} style={{ margin: '0 0 4px', fontSize: 12.5 }}>{p.name} — {money(p.price)}</p>
                ))}
                {selectedPackage && (
                  <p style={{ margin: '12px 0 0', fontSize: 12.5 }}><b>Package:</b> {selectedPackage.name} · {selectedPackage.durationDays} days · {money(selectedPackage.price)}</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          {step > 1 && (
            <button style={btnGhost} onClick={() => setStep((s) => s - 1)}>Back</button>
          )}
          {step === 0 ? (
            <button style={btnPrimary} disabled={saving || !moduleChoice} onClick={chooseModuleAndCreate}>{saving ? 'Starting…' : 'Next'}</button>
          ) : step < STEPS.length - 1 ? (
            <button style={btnPrimary} disabled={saving} onClick={goNext}>{saving ? 'Saving…' : 'Next'}</button>
          ) : (
            <button style={btnPrimary} disabled={saving} onClick={submitPromotion}>{saving ? 'Submitting…' : 'Submit for Admin Verification'}</button>
          )}
        </div>
      </div>
    );
  }

  // ============================================================ DETAIL
  if (view === 'detail') {
    const d = detail;
    const badge = d ? (STATUS_BADGE[d.status] || STATUS_BADGE.DRAFT) : null;
    return (
      <div style={{ padding: 20, maxWidth: 720 }}>
        <button onClick={() => setView('list')} style={{ background: 'none', border: 'none', color: '#10b981', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', marginBottom: 12, padding: 0 }}>
          ← Back to Advertisements
        </button>
        {detailLoading ? <p style={{ color: '#94a3b8', fontSize: 12.5 }}>Loading…</p> : d && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <span style={{ display: 'inline-block', marginBottom: 6, fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}>
                  {MODULE_LABEL[d.module] || d.module}
                </span>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>{d.title}</h2>
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: badge.bg, color: badge.fg }}>{badge.label}</span>
            </div>

            {d.status === 'CHANGES_REQUESTED' && d.adminFeedback && (
              <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <p style={{ margin: '0 0 6px', fontSize: 12.5, fontWeight: 800, color: '#92400e' }}>⚠ Changes Requested</p>
                <p style={{ margin: '0 0 12px', fontSize: 12.5, color: '#78350f' }}>Admin Feedback: "{d.adminFeedback}"</p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={btnPrimary} onClick={() => openWizard(d)}>Edit Promotion</button>
                </div>
              </div>
            )}

            {d.status === 'REJECTED' && d.adminFeedback && (
              <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: '#991b1b' }}>Rejected: "{d.adminFeedback}"</p>
              </div>
            )}

            {d.status === 'APPROVED' && d.expiresAt && (
              <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 12.5, color: '#1e40af' }}>
                  Approved — your {d.durationDaysSnapshot}-day window runs until <b>{new Date(d.expiresAt).toLocaleDateString('en-IN')}</b> regardless of when you pay. Pay now to go live.
                </p>
              </div>
            )}

            {d.bannerImage && <img src={d.bannerImage} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 12, marginBottom: 14 }} />}
            <p style={{ fontSize: 12.5, color: '#64748b' }}>{d.description}</p>

            <div style={{ display: 'flex', gap: 16, fontSize: 12.5, margin: '10px 0' }}>
              {d.amountSnapshot !== undefined && <span><b>{money(d.amountSnapshot)}</b> · {d.durationDaysSnapshot} days</span>}
              {d.expiresAt && <span>Until {new Date(d.expiresAt).toLocaleDateString('en-IN')}</span>}
            </div>

            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              {(d.selectedProducts || []).map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                  <img src={p.image} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{p.name}</p>
                    <p style={{ margin: '2px 0 0', fontSize: 11.5, color: '#64748b' }}>{money(p.price)} {!p.available && '· Unavailable'}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              {d.status === 'DRAFT' && <button style={btnPrimary} onClick={() => openWizard(d)}>Edit / Submit</button>}
              {d.status === 'APPROVED' && <button style={btnPrimary} onClick={() => payNow(d._id)}>Pay Now</button>}
              {['DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'].includes(d.status) && (
                <button style={btnGhost} onClick={() => cancelIt(d._id)}>Cancel</button>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ============================================================ LIST
  const filters = ['all', 'DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'PAYMENT_PENDING', 'ACTIVE', 'EXPIRED'];
  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 900, color: '#0f172a' }}>My Advertisements</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>Paid advertisements for your shop — admin-verified before they go live.</p>
        </div>
        <button style={btnPrimary} onClick={startCreate}>+ Create Advertisement</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {filters.map((f) => (
          <button key={f} onClick={() => setStatusFilter(f)} style={{
            padding: '6px 12px', borderRadius: 999, border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer',
            background: statusFilter === f ? '#10b981' : '#f1f5f9', color: statusFilter === f ? '#fff' : '#64748b',
          }}>
            {f === 'all' ? 'All' : (STATUS_BADGE[f]?.label || f)}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 12.5 }}>Loading…</p>
      ) : promotions.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 12.5, textAlign: 'center', padding: '40px 0' }}>No advertisements yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {promotions.map((p) => {
            const badge = STATUS_BADGE[p.status] || STATUS_BADGE.DRAFT;
            return (
              <div key={p._id} onClick={() => openDetail(p._id)} style={{
                background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, cursor: 'pointer',
                display: 'flex', gap: 14, alignItems: 'center',
              }}>
                {p.bannerImage && <img src={p.bannerImage} alt="" style={{ width: 64, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9.5, fontWeight: 800, padding: '2px 7px', borderRadius: 999, background: '#f1f5f9', color: '#64748b' }}>
                      {MODULE_LABEL[p.module] || p.module}
                    </span>
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{p.title}</p>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: 11.5, color: '#94a3b8' }}>
                    {p.productsCount} product(s){p.amount !== undefined ? ` · ${money(p.amount)}` : ''}
                    {p.expiresAt ? ` · until ${new Date(p.expiresAt).toLocaleDateString('en-IN')}` : ''}
                  </p>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 10px', borderRadius: 999, background: badge.bg, color: badge.fg, whiteSpace: 'nowrap' }}>
                  {badge.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SellerPromotionsTab;
