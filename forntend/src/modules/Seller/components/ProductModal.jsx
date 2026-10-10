import React, { useState, useEffect, useRef, useMemo, useContext } from 'react';
import SellerContext from '../context/SellerContext';
import SHGContext from '../../SHG/context/SHGContext';
import { apiUrl } from '../../../utils/api';

/**
 * Premium tabbed product create/edit panel.
 *
 * Self-contained, reading straight off context the same way every other
 * panel modal in this app does (LocationPromptModal / SubscriptionRequired-
 * Modal follow the same shape) — no prop-drilling from whichever tab mounts
 * it. That's what lets Seller's ProductsTab.jsx/StockTab.jsx AND SHG's
 * SHGProductsTab.jsx all mount this exact component with a one-line
 * `<ProductModal />` (or `<ProductModal isShgUser />`) and never duplicate the
 * category tree fetch, the image handling or the submit wiring between them.
 *
 * `isShgUser` picks which of the two contexts supplies the shared contract
 * (`newProductForm`, `submitNewProduct`, `editingProduct`, etc.) — read via
 * the raw `useContext(XContext)` rather than the modules' own `useSeller()`/
 * `useSHG()` hooks, since those throw outside their provider and this
 * component is mounted inside only one of the two trees at a time.
 *
 * The category cascade (Header → Main → Sub) and the multipart image upload
 * are carried over unchanged from the modal this replaces — same endpoints,
 * same validation, same "images are required to create, not to edit" rule —
 * just reorganised into tabs instead of one long scrolling form.
 */

const GST_RATES = [0, 5, 12, 18, 28];
const IMAGE_TYPES = ['Front', 'Back', 'Side', 'Detail', 'Packaging'];
const ADDITIONAL_SLOTS = 4; // + 1 cover = 5, the same cap Product.images has always had
const BRAND_SUGGESTIONS = ['Local Make', 'House Brand', 'Unbranded'];

const TABS = [
  { id: 'general', label: 'General Info' },
  { id: 'variants', label: 'Item Variants' },
  { id: 'groups', label: 'Groups' },
  { id: 'photos', label: 'Photos' },
];

// SHG-only: which shopper-facing storefront(s) this listing goes out on.
// Not a Seller concept — a Seller's channel is fixed by which dashboard
// panel (Quick/Shop All) they're in, never chosen per-listing.
const STOREFRONT_OPTIONS = [
  { value: 'ecommerce', label: 'E-Commerce (Shop All)' },
  { value: 'grocery', label: 'Quick Commerce (30-min Express)' },
  { value: 'both', label: 'Both Storefronts (Cross-listed)' },
];

const slugify = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export const ProductModal = ({ isShgUser = false }) => {
  const sellerCtx = useContext(SellerContext) || {};
  const shgCtx = useContext(SHGContext) || {};
  const ctx = isShgUser ? shgCtx : sellerCtx;

  const {
    showAddProductModal, setShowAddProductModal,
    newProductForm, setNewProductForm,
    submitNewProduct, submitProductEdit,
    savingProduct, productError,
    activeChannel,
    platformLimits, sellerProfile,
    editingProduct, editingProductId, setEditingProductId,
    triggerToast,
  } = ctx;

  const isEditing = Boolean(editingProductId);
  const [activeTab, setActiveTab] = useState('general');

  // ---- category cascade: Header (L1) -> Main (L2) -> Sub (L3) --------------
  // Only the deepest level chosen is submitted; the server re-checks it is an
  // active leaf in this seller's channel — exactly the rule the legacy modal
  // already enforced, carried over unchanged.
  const [catTree, setCatTree] = useState([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [pickL1, setPickL1] = useState('');
  const [pickL2, setPickL2] = useState('');
  const [pickL3, setPickL3] = useState('');

  // An SHG group's products always live under the SHG category tree,
  // regardless of which storefront(s) the listing is targeting — only a
  // Seller's tree is channel-scoped.
  const categoryTreeType = isShgUser ? 'shg' : activeChannel;

  useEffect(() => {
    if (!showAddProductModal) return;
    let cancelled = false;
    (async () => {
      setCatsLoading(true);
      try {
        const res = await fetch(apiUrl(`/api/categories/tree?type=${categoryTreeType}`));
        const body = await res.json();
        const rows = Array.isArray(body) ? body : (body.data || []);
        if (!cancelled) setCatTree(rows);
      } catch {
        if (!cancelled) setCatTree([]);
      } finally {
        if (!cancelled) setCatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showAddProductModal, categoryTreeType]);

  const l1Node = useMemo(() => catTree.find((c) => c._id === pickL1) || null, [catTree, pickL1]);
  const l2List = l1Node ? (l1Node.children || []) : [];
  const l2Node = useMemo(() => l2List.find((c) => c._id === pickL2) || null, [l2List, pickL2]);
  const l3List = l2Node ? (l2Node.children || []) : [];
  const effectiveCategoryId = pickL3 || (l3List.length === 0 ? pickL2 : '');

  useEffect(() => {
    setNewProductForm((f) => ({ ...f, categoryId: effectiveCategoryId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCategoryId]);

  const resetCategoryPicks = () => { setPickL1(''); setPickL2(''); setPickL3(''); };

  // Put the picker back on the category this listing was saved under, once
  // the tree has arrived — it's the tree that says which level it sits at.
  useEffect(() => {
    const savedId = editingProduct?.category?._id || editingProduct?.category;
    if (!savedId || catTree.length === 0) return;
    const target = String(savedId);
    for (const l1 of catTree) {
      if (String(l1._id) === target) { setPickL1(target); return; }
      for (const l2 of l1.children || []) {
        if (String(l2._id) === target) { setPickL1(String(l1._id)); setPickL2(target); return; }
        for (const l3 of l2.children || []) {
          if (String(l3._id) === target) {
            setPickL1(String(l1._id)); setPickL2(String(l2._id)); setPickL3(target);
            return;
          }
        }
      }
    }
  }, [editingProduct, catTree]);

  useEffect(() => { resetCategoryPicks(); }, [activeChannel]);

  /**
   * QUICK COMMERCE ONLY — read-only "Category Return Window: N Days" shown
   * next to the Allow Returns toggle below. Never sets anything; a Seller
   * cannot configure this number, only see what Admin has already set for
   * the chosen category (GET /api/products/category-return-policy).
   */
  const showReturnableBlock = !isShgUser && activeChannel === 'grocery';
  const [catReturnPolicy, setCatReturnPolicy] = useState(null);
  useEffect(() => {
    if (!showReturnableBlock || !effectiveCategoryId) { setCatReturnPolicy(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/products/category-return-policy?categoryId=${effectiveCategoryId}`), {
          headers: { Authorization: `Bearer ${localStorage.getItem('userToken')}` },
        });
        const body = await res.json();
        if (!cancelled) setCatReturnPolicy(res.ok ? body.data : null);
      } catch {
        if (!cancelled) setCatReturnPolicy(null);
      }
    })();
    return () => { cancelled = true; };
  }, [showReturnableBlock, effectiveCategoryId]);

  // ---- images: one cover + up to 4 typed additional slots -------------------
  const coverInputRef = useRef(null);
  const [coverImage, setCoverImage] = useState(null); // { file, url }
  const [slots, setSlots] = useState(
    Array.from({ length: ADDITIONAL_SLOTS }, () => ({ type: '', file: null, url: '' }))
  );
  const slotInputRefs = useRef([]);

  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_SIZE = 5 * 1024 * 1024;

  const validateFile = (file) => {
    if (!allowed.includes(file.type)) { triggerToast(file.name + ': only JPG, PNG or WEBP allowed.'); return false; }
    if (file.size > MAX_SIZE) { triggerToast(file.name + ' is larger than 5 MB.'); return false; }
    return true;
  };

  const pickCover = (file) => {
    if (!file || !validateFile(file)) return;
    if (coverImage) URL.revokeObjectURL(coverImage.url);
    setCoverImage({ file, url: URL.createObjectURL(file) });
  };

  const pickSlotFile = (index, file) => {
    if (!file || !validateFile(file)) return;
    setSlots((prev) => {
      const next = [...prev];
      if (next[index].url) URL.revokeObjectURL(next[index].url);
      next[index] = { ...next[index], file, url: URL.createObjectURL(file) };
      return next;
    });
  };

  const setSlotType = (index, type) => {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], type };
      return next;
    });
  };

  // The full ordered file list this submit will carry — cover first, since
  // the backend (and every product card in the app) treats images[0] as the
  // cover photo.
  const collectedFiles = useMemo(() => {
    const files = [];
    if (coverImage) files.push(coverImage);
    slots.forEach((s) => { if (s.file && s.url) files.push({ file: s.file, url: s.url }); });
    return files;
  }, [coverImage, slots]);

  // Release preview blobs and reset every local tab's state when the panel closes.
  useEffect(() => {
    if (showAddProductModal) return;
    if (coverImage) URL.revokeObjectURL(coverImage.url);
    setCoverImage(null);
    setSlots((prev) => {
      prev.forEach((s) => { if (s.url) URL.revokeObjectURL(s.url); });
      return Array.from({ length: ADDITIONAL_SLOTS }, () => ({ type: '', file: null, url: '' }));
    });
    resetCategoryPicks();
    setActiveTab('general');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddProductModal]);

  // ---- variants --------------------------------------------------------
  // Pricing, stock, unit and weight live here now, not on the product root —
  // every listing carries at least one ("Default") variant, since it's the
  // only place left to enter what the item costs.
  const variants = newProductForm.variants || [];
  const addVariant = () => {
    setNewProductForm((f) => ({
      ...f,
      variants: [...(f.variants || []), { name: '', price: '', mrp: '', stock: '', unit: 'piece', weight: '' }],
    }));
  };
  const removeVariant = (index) => {
    setNewProductForm((f) => ({ ...f, variants: (f.variants || []).filter((_, i) => i !== index) }));
  };
  const updateVariant = (index, field, value) => {
    setNewProductForm((f) => ({
      ...f,
      variants: (f.variants || []).map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    }));
  };

  // Mirrors the server's own checks — every variant needs a name, a positive
  // price, a non-negative stock, and a selling price that never exceeds MRP.
  const variantErrors = variants.map((v) => {
    if (!v.name || !String(v.name).trim()) return 'needs a name';
    if (v.price === '' || v.price === undefined || Number(v.price) <= 0) return 'needs a valid selling price';
    if (v.stock === '' || v.stock === undefined || Number(v.stock) < 0) return 'stock cannot be negative';
    if (v.mrp !== '' && v.mrp !== undefined && Number(v.price) > Number(v.mrp)) return 'price cannot be higher than its MRP';
    return '';
  });
  const firstVariantError = variantErrors.find(Boolean) || (variants.length === 0 ? 'Add at least one variant with pricing and stock.' : '');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isEditing) await submitProductEdit(newProductForm);
    else await submitNewProduct(newProductForm, collectedFiles);
  };

  const close = () => { setShowAddProductModal(false); setEditingProductId(null); };

  if (!showAddProductModal) return null;

  const slugPreview = slugify(newProductForm.name);
  const canSubmit = !savingProduct
    && (isEditing || collectedFiles.length > 0)
    && !!newProductForm.categoryId
    && !firstVariantError;

  // A listing's primary channel is fixed forever once created (the backend
  // doesn't even accept a `type` change on update) — only whether it's ALSO
  // cross-listed to the other storefront ("Both") can move. Editing an
  // SHG listing that's ecommerce-only must not offer a "Quick Commerce
  // only" option that would silently do nothing.
  const shgPrimaryType = isShgUser && isEditing
    ? (editingProduct?.type === 'ecommerce' ? 'ecommerce' : 'grocery')
    : null;
  const showSameDayBlock = isShgUser
    ? (newProductForm.storefrontTarget === 'ecommerce' || newProductForm.storefrontTarget === 'both')
    : activeChannel === 'ecommerce';

  return (
    <div style={S.overlay} onClick={close}>
      {/* Mobile: sidebar stacks above the main content instead of beside it —
          at 260px fixed width (see S.sidebar) inside a 92%-wide dialog, the
          two-pane layout only left ~92px for the main content on a 375px
          screen. `flexDirection`/sidebar `width` aren't in the S.* inline
          style objects (deliberately removed from S.sidebar below), so this
          class can govern them without an inline style winning over it. */}
      <style dangerouslySetInnerHTML={{ __html: `
        .pm-dialog { flex-direction: column; }
        .pm-sidebar { width: 100%; }
        @media (min-width: 768px) {
          .pm-dialog { flex-direction: row; }
          .pm-sidebar { width: 260px; }
        }
      ` }} />
      <div className="pm-dialog" style={S.dialog} onClick={(e) => e.stopPropagation()}>
        {/* ---- left sidebar column ---- */}
        <div className="pm-sidebar" style={S.sidebar}>
          <div>
            <div style={S.sidebarBrand}>
              <span style={S.sidebarBrandIcon}>🏷️</span>
              <span style={S.sidebarBrandLabel}>Listing Editor</span>
            </div>
            <nav style={S.tabNav}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  style={{ ...S.tabBtn, ...(activeTab === t.id ? S.tabBtnActive : {}) }}
                >
                  {t.label}
                  {t.id === 'variants' && variants.length > 0 && (
                    <span style={S.tabCount}>{variants.length}</span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          <div style={S.sidebarFooter}>
            <label style={S.sideLabel}>Status</label>
            <select
              value={newProductForm.status || 'Published'}
              onChange={(e) => setNewProductForm({ ...newProductForm, status: e.target.value })}
              style={S.statusSelect}
            >
              <option value="Published">Published</option>
              <option value="Draft">Draft</option>
            </select>

            <label style={{ ...S.sideLabel, marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(newProductForm.isFeatured)}
                onChange={(e) => setNewProductForm({ ...newProductForm, isFeatured: e.target.checked })}
              />
              Featured
            </label>
          </div>
        </div>

        {/* ---- right content column ---- */}
        <div style={S.rightColumn}>
          <div style={S.header}>
            <div style={{ minWidth: 0 }}>
              <h3 style={S.title}>{isEditing ? 'Edit Product' : 'Add Product Listing'}</h3>
              <div style={S.breadcrumb}>
                {isShgUser
                  ? 'SHG'
                  : ((activeChannel === 'quick' || activeChannel === 'grocery') ? 'QUICK COMMERCE' : 'SHOP ALL')}
                {' > '}
                {isEditing ? (editingProduct?.name || editingProductId) : 'NEW LISTING'}
              </div>
            </div>
            <button type="button" onClick={close} style={S.closeBtn} aria-label="Close">✕</button>
          </div>

          <div style={S.main}>
            {activeTab === 'general' && (
              <div style={S.tabPanel}>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Product Title *</label>
                  <input
                    type="text" className="onboarding-input" placeholder="e.g. Stainless Steel Peeler"
                    value={newProductForm.name}
                    onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                    minLength={3} required
                  />
                </div>

                <div className="onboarding-form-group">
                  <label className="onboarding-label">Web Address</label>
                  <input type="text" className="onboarding-input" readOnly disabled
                    value={slugPreview ? `/product/${slugPreview}` : '/product/…'}
                    style={{ opacity: 0.7, cursor: 'not-allowed' }} />
                </div>

                <div className="onboarding-form-group">
                  <label className="onboarding-label">About This Item</label>
                  <textarea className="onboarding-input" rows={4}
                    placeholder="Material, size, what makes it good..."
                    value={newProductForm.desc}
                    onChange={(e) => setNewProductForm({ ...newProductForm, desc: e.target.value })} />
                </div>

                {!isShgUser && (
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Brand Name</label>
                    <input
                      list="brand-suggestions" type="text" className="onboarding-input"
                      placeholder="e.g. Local Make"
                      value={newProductForm.brandName}
                      onChange={(e) => setNewProductForm({ ...newProductForm, brandName: e.target.value })}
                    />
                    <datalist id="brand-suggestions">
                      {BRAND_SUGGESTIONS.map((b) => <option key={b} value={b} />)}
                    </datalist>
                  </div>
                )}

                {isShgUser && (
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Storefront Target *</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {STOREFRONT_OPTIONS.map((opt) => {
                        const active = newProductForm.storefrontTarget === opt.value;
                        const locked = shgPrimaryType && opt.value !== 'both' && opt.value !== shgPrimaryType;
                        return (
                          <button
                            key={opt.value} type="button"
                            disabled={locked}
                            onClick={() => setNewProductForm({ ...newProductForm, storefrontTarget: opt.value })}
                            style={{
                              ...S.gstBtn, ...(active ? S.gstBtnActive : {}),
                              ...(locked ? { opacity: 0.4, cursor: 'not-allowed' } : {}),
                            }}
                            title={locked ? "A listing's original storefront can't be swapped for a different one — only added to." : undefined}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>
                      This listing is always handmade by your SHG group — shown automatically as a badge to shoppers.
                    </span>
                  </div>
                )}

                <div className="onboarding-form-group">
                  <label className="onboarding-label">GST Tax Rate (%)</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {GST_RATES.map((r) => {
                      const active = Number(newProductForm.gstRate) === r;
                      return (
                        <button
                          key={r} type="button"
                          onClick={() => setNewProductForm({ ...newProductForm, gstRate: r })}
                          style={{ ...S.gstBtn, ...(active ? S.gstBtnActive : {}) }}
                        >
                          {r}%
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={S.hintBox}>
                  Selling price, MRP, stock, unit and weight are set per variant — head to the <strong>Item Variants</strong> tab.
                </div>

                {/*
                  Allow Returns — QUICK COMMERCE ONLY.
                  A plain YES/NO opt-out, never a window: the number of days
                  always comes from Admin's Category Return Policy, shown
                  here read-only so the Seller knows what they're opting
                  into/out of without being able to change it.
                */}
                {showReturnableBlock && (
                  <div className="onboarding-form-group" style={{ border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                      <input type="checkbox" checked={Boolean(newProductForm.returnable)}
                        onChange={(e) => setNewProductForm({ ...newProductForm, returnable: e.target.checked })} />
                      <span style={{ fontSize: 12.5, fontWeight: 800 }}>↩️ Allow Returns</span>
                    </label>
                    <div style={{ marginTop: 8, marginLeft: 26, fontSize: 11, color: 'var(--text-secondary)' }}>
                      {!effectiveCategoryId
                        ? 'Pick a category to see its return window.'
                        : catReturnPolicy?.eligible
                          ? `Category Return Window: ${catReturnPolicy.returnWindowDays} Day(s)`
                          : 'This category has no active return window set by Admin — items stay non-returnable either way.'}
                    </div>
                  </div>
                )}

                {/* Same-Day, only on the Ecommerce/Shop All leg. */}
                {showSameDayBlock && (
                  <div className="onboarding-form-group" style={{ border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                      <input type="checkbox" checked={Boolean(newProductForm.sameDayEnabled)}
                        onChange={(e) => setNewProductForm({ ...newProductForm, sameDayEnabled: e.target.checked })} />
                      <span style={{ fontSize: 12.5, fontWeight: 800 }}>⚡ Offer same-day delivery</span>
                    </label>
                    {newProductForm.sameDayEnabled && (
                      <div style={{ marginTop: 12, marginLeft: 26 }}>
                        <label className="onboarding-label">Packing time (minutes) *</label>
                        <input type="number" min="0" max={platformLimits.sameDayMaxProcessingMinutes}
                          className="onboarding-input" placeholder="30"
                          value={newProductForm.processingMinutes}
                          onChange={(e) => setNewProductForm({ ...newProductForm, processingMinutes: e.target.value })} />
                        {!isShgUser && !sellerProfile?.sameDay?.enabled && (
                          <div style={S.warnBox}>
                            Your shop has not switched same-day on yet — set it up in Profile first.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'variants' && (
              <div style={S.tabPanel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h4 style={S.sectionTitle}>Product Variants</h4>
                  <button type="button" onClick={addVariant} style={S.addBtn}>+ ADD</button>
                </div>

                {variants.length === 0 ? (
                  <div style={S.emptyState}>
                    No variants yet — add one to set pricing and stock.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {variants.map((v, i) => (
                      <div key={i} style={S.variantCard}>
                        <div style={S.variantCardTop}>
                          <div style={{ ...S.variantField, flex: 2 }}>
                            <label style={S.microLabel}>VARIANT NAME</label>
                            <input type="text" className="onboarding-input" placeholder="Default, Pack of 2…" value={v.name}
                              onChange={(e) => updateVariant(i, 'name', e.target.value)} />
                          </div>
                          {variants.length > 1 && (
                            <button type="button" onClick={() => removeVariant(i)} style={S.trashBtn} aria-label="Remove variant">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <div style={S.variantCardGrid}>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>SELLING PRICE (₹) *</label>
                            <input type="number" min="1" className="onboarding-input" placeholder="499" value={v.price}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'price', e.target.value)} />
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>MRP (₹)</label>
                            <input type="number" min="0" className="onboarding-input" placeholder="699" value={v.mrp}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'mrp', e.target.value)} />
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>STOCK *</label>
                            <input type="number" min="0" className="onboarding-input" placeholder="25" value={v.stock}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'stock', e.target.value)} />
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>UNIT</label>
                            <select className="onboarding-select" value={v.unit || 'piece'}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'unit', e.target.value)}>
                              {['piece', 'kg', 'g', 'litre', 'ml', 'dozen', 'pack'].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>WEIGHT (g)</label>
                            <input type="number" min="0" className="onboarding-input" placeholder="500" value={v.weight}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'weight', e.target.value)} />
                          </div>
                        </div>
                        {variantErrors[i] && <div style={S.errorText}>{v.name || `Variant ${i + 1}`} {variantErrors[i]}.</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'groups' && (
              <div style={S.tabPanel}>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">
                    Main Group (Header) * <span style={{ fontWeight: 600, opacity: 0.7 }}>({isShgUser ? 'SHG' : ((activeChannel === 'quick' || activeChannel === 'grocery') ? 'Quick Commerce' : 'Shop All')} catalogue)</span>
                  </label>
                  <select className="onboarding-select" value={pickL1}
                    onChange={(e) => { setPickL1(e.target.value); setPickL2(''); setPickL3(''); }} required>
                    <option value="">{catsLoading ? 'Loading categories...' : 'Select header category'}</option>
                    {catTree.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>

                {pickL1 && (
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Main Category *</label>
                    <select className="onboarding-select" value={pickL2}
                      onChange={(e) => { setPickL2(e.target.value); setPickL3(''); }} required>
                      <option value="">Select main category *</option>
                      {l2List.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    {!pickL2 && l2List.length > 0 && (
                      <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                        * Main Category is required.
                      </span>
                    )}
                  </div>
                )}

                {pickL2 && l3List.length > 0 && (
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Sub-Category (Optional)</label>
                    <select className="onboarding-select" value={pickL3}
                      onChange={(e) => setPickL3(e.target.value)}>
                      <option value="">Select sub category</option>
                      {l3List.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                {pickL2 && l3List.length === 0 && (
                  <span style={{ fontSize: 11, opacity: 0.65 }}>
                    This category has no sub-categories, so it will be used directly.
                  </span>
                )}

                {effectiveCategoryId && (
                  <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                    Selected: {l1Node && l1Node.name}
                    {l2Node ? ' > ' + l2Node.name : ''}
                    {pickL3 ? ' > ' + ((l3List.find((c) => c._id === pickL3) || {}).name || '') : ''}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'photos' && (
              <div style={S.tabPanel}>
                <div className="onboarding-form-group">
                  <label className="onboarding-label">Main Cover Photo {!isEditing && '*'}</label>
                  <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                    onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
                  <div
                    onClick={() => coverInputRef.current?.click()}
                    style={S.coverBox}
                  >
                    {coverImage ? (
                      <img src={coverImage.url} alt="Cover" style={S.coverImg} />
                    ) : isEditing && editingProduct?.images?.[0] ? (
                      <img src={editingProduct.images[0]} alt="Current cover" style={S.coverImg} />
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 700 }}>Click to upload cover photo</span>
                    )}
                  </div>
                  {isEditing && (
                    <span style={{ fontSize: 10, opacity: 0.65, display: 'block', marginTop: 6 }}>
                      Attaching a new cover or any additional photo replaces the entire photo set.
                    </span>
                  )}
                </div>

                <div className="onboarding-form-group">
                  <label className="onboarding-label">Additional Product Photos ({ADDITIONAL_SLOTS} slots)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                    {slots.map((slot, i) => (
                      <div key={i} style={S.slotCard}>
                        <select
                          value={slot.type}
                          onChange={(e) => setSlotType(i, e.target.value)}
                          style={S.slotTypeSelect}
                        >
                          <option value="">Image type…</option>
                          {IMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>

                        <input
                          ref={(el) => { slotInputRefs.current[i] = el; }}
                          type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                          onChange={(e) => { pickSlotFile(i, e.target.files?.[0]); e.target.value = ''; }}
                        />

                        <div
                          onClick={() => slot.type && slotInputRefs.current[i]?.click()}
                          style={{
                            ...S.slotUpload,
                            opacity: slot.type ? 1 : 0.45,
                            cursor: slot.type ? 'pointer' : 'not-allowed',
                          }}
                        >
                          {slot.url ? (
                            <img src={slot.url} alt={slot.type} style={S.coverImg} />
                          ) : (
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontWeight: 700, textAlign: 'center', padding: 6 }}>
                              {slot.type ? 'Click to upload' : 'Choose a type first'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {productError && <div style={S.errorBox}>{productError}</div>}
          </div>

          {/* ---- footer ---- */}
          <div style={S.footer}>
            <button type="button" onClick={close} style={S.footerCloseBtn}>Close</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} style={{ ...S.footerSaveBtn, ...(canSubmit ? {} : S.footerSaveBtnDisabled) }}>
              {savingProduct ? 'Saving…' : (isEditing ? 'Save Changes' : 'Save & Submit Listing')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const S = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    width: '92%', maxWidth: 1020, height: '90vh', maxHeight: 720,
    background: 'var(--bg-card)', borderRadius: 16, display: 'flex', overflow: 'hidden',
    boxShadow: 'var(--shadow-premium, var(--shadow-lg))', position: 'relative',
  },
  sidebar: {
    // width is set responsively by the .pm-sidebar CSS class (100% mobile /
    // 260px at 768px+) — an inline width here would override that at every
    // screen size, the same bug the header row had (see DashboardPage.jsx).
    flexShrink: 0, borderRight: '1px solid var(--border-color)',
    background: 'var(--bg-page)', padding: 24,
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  },
  sidebarBrand: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 22 },
  sidebarBrandIcon: { fontSize: 18 },
  sidebarBrandLabel: { fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' },
  tabNav: { display: 'flex', flexDirection: 'column', gap: 2 },
  tabBtn: {
    textAlign: 'left', border: 'none', background: 'none', padding: '11px 12px', borderRadius: 10,
    fontSize: 12.5, fontWeight: 700, color: 'var(--text-secondary)', cursor: 'pointer',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  tabBtnActive: { background: 'var(--primary-light)', color: 'var(--primary)', fontWeight: 800 },
  tabCount: {
    fontSize: 9.5, fontWeight: 800, background: 'var(--primary)', color: 'var(--text-white)',
    borderRadius: 999, padding: '1px 6px', minWidth: 16, textAlign: 'center',
  },
  sidebarFooter: { paddingTop: 16, borderTop: '1px solid var(--border-color)' },
  sideLabel: { display: 'block', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 },
  statusSelect: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', background: 'var(--bg-card)' },
  rightColumn: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
  },
  title: { margin: 0, fontFamily: "'Outfit', sans-serif", fontSize: 17, fontWeight: 800, color: 'var(--text-primary)' },
  breadcrumb: { marginTop: 4, fontSize: 10.5, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.4px', fontFamily: 'monospace' },
  closeBtn: { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-secondary)', padding: 4 },
  main: { flex: 1, overflowY: 'auto', padding: 24 },
  tabPanel: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: { margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' },
  addBtn: {
    border: '1px solid var(--primary)', background: 'var(--bg-card)', color: 'var(--primary)',
    borderRadius: 8, padding: '6px 14px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer',
  },
  emptyState: { fontSize: 12, color: 'var(--text-secondary)', padding: '24px 0', textAlign: 'center' },
  hintBox: { padding: '10px 12px', borderRadius: 8, background: 'var(--bg-page)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 11.5, fontWeight: 600 },
  variantCard: { display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border-color)', borderRadius: 12, padding: 14, width: '100%', boxSizing: 'border-box', overflow: 'hidden' },
  variantCardTop: { display: 'flex', gap: 10, alignItems: 'flex-end', width: '100%', boxSizing: 'border-box' },
  variantCardGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, width: '100%', boxSizing: 'border-box' },
  variantField: { flex: 1, minWidth: 0, width: '100%', boxSizing: 'border-box' },
  microLabel: { display: 'block', fontSize: 9.5, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 },
  trashBtn: { border: '1px solid var(--error)', background: 'var(--bg-page)', color: 'var(--error)', borderRadius: 8, width: 34, height: 34, cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  gstBtn: { border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' },
  gstBtnActive: { border: '1px solid var(--primary)', background: 'var(--primary-light)', color: 'var(--primary)' },
  coverBox: {
    width: '100%', height: 160, borderRadius: 12, border: '1.5px dashed var(--border-color)', background: 'var(--bg-page)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden',
  },
  coverImg: { width: '100%', height: '100%', objectFit: 'cover' },
  slotCard: { display: 'flex', flexDirection: 'column', gap: 6 },
  slotTypeSelect: { padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border-color)', fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', background: 'var(--bg-card)' },
  slotUpload: {
    height: 90, borderRadius: 10, border: '1.5px dashed var(--border-color)', background: 'var(--bg-page)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  warnBox: { marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-page)', border: '1px solid var(--warning)', color: 'var(--warning)', fontSize: 10.5, fontWeight: 700 },
  errorText: { fontSize: 11, color: 'var(--error)', fontWeight: 700 },
  errorBox: { padding: 10, borderRadius: 8, marginTop: 14, fontSize: 11.5, background: 'var(--bg-page)', border: '1px solid var(--error)', color: 'var(--error)' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 24px',
    borderTop: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-card)',
  },
  footerCloseBtn: { border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)', borderRadius: 10, padding: '10px 20px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  footerSaveBtn: { border: 'none', background: 'var(--primary)', color: 'var(--text-white)', borderRadius: 10, padding: '10px 24px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  footerSaveBtnDisabled: { background: 'var(--text-muted)', cursor: 'not-allowed' },
};

export default ProductModal;
