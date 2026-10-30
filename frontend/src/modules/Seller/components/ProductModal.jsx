import ModalPortal from '../../../components/ModalPortal';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import VariantAttributesEditor from './VariantAttributesEditor';
import VariantWholesaleFields from './VariantWholesaleFields';
import { eligibleWholesaleProduct, hasWholesaleAccess } from '../utils/wholesaleEligibility';
import useSellerDialog from '../hooks/useSellerDialog';
import { offerPayload, validateWholesaleOffer } from '../utils/wholesaleOffer';
import { boundedFetch } from '../../../utils/portalRequests';
import React, { useState, useEffect, useRef, useMemo, useContext } from 'react';
import SellerContext from '../context/SellerContext';
import { apiUrl } from '../../../utils/api';
import './ProductModal.css';

/**
 * Premium tabbed product create/edit panel.
 *
 * Self-contained, reading straight off context the same way every other
 * panel modal in this app does (LocationPromptModal / SubscriptionRequired-
 * Modal follow the same shape) — no prop-drilling from whichever tab mounts
 * it. That's what lets Seller's ProductsTab.jsx/StockTab.jsx mount this
 * component without duplicating the
 * category tree fetch, the image handling or the submit wiring between them.
 *
 * Reads the Seller context directly for the listing form contract.
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



const slugify = (s) => (s || '').toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export const ProductModal = () => {
  const ui = useFeedback();
  const sellerCtx = useContext(SellerContext) || {};

  const {
    showAddProductModal, setShowAddProductModal,
    newProductForm, setNewProductForm,
    submitNewProduct, submitProductEdit,
    savingProduct, productError,
    activeChannel: selectedChannel, productListingMode,
    platformLimits, sellerProfile,
    editingProduct, editingProductId, setEditingProductId, wholesaleVariantId,
    triggerToast,
  } = sellerCtx;

  const wholesaleProductEditor = productListingMode === 'wholesale' && (!editingProductId || (!wholesaleVariantId && editingProduct?.sellingChannels?.length === 1 && editingProduct.sellingChannels[0] === 'wholesale'));
  const activeChannel = editingProduct?.type || (wholesaleProductEditor ? 'ecommerce' : selectedChannel);
  const wholesaleOnly = productListingMode === 'wholesale' && !wholesaleProductEditor;
  const wholesaleDialog = useRef(null);
  useSellerDialog(wholesaleDialog, showAddProductModal && (wholesaleOnly || wholesaleProductEditor));
  const isEditing = Boolean(editingProductId);
  // A new e-book whose listing was created but whose PDF upload failed: the
  // editor stays on that draft so a retry cannot create a duplicate.
  const ebookDraftAwaitingPdf = isEditing && editingProduct?.fulfillmentType === 'digital' && editingProduct?.digital?.file?.status !== 'uploaded';
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!showAddProductModal || !viewport) return;
    let frame;
    const revealField = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const field = document.activeElement;
        if (window.matchMedia('(max-width: 767px)').matches && wholesaleDialog.current?.contains(field)
          && field?.matches('input,textarea,select')) field.scrollIntoView({ block: 'nearest' });
      });
    };
    viewport.addEventListener('resize', revealField);
    return () => { viewport.removeEventListener('resize', revealField); cancelAnimationFrame(frame); };
  }, [showAddProductModal]);
  const isDigital = newProductForm.fulfillmentType === 'digital' || editingProduct?.fulfillmentType === 'digital';
  const [activeTab, setActiveTab] = useState('general');
  const [ebookFile, setEbookFile] = useState(null);
  const [savingWholesale, setSavingWholesale] = useState(false);
  const [wholesaleError, setWholesaleError] = useState('');
  const [wholesaleSuccess, setWholesaleSuccess] = useState('');
  const wholesaleLock = useRef(false), wholesaleGeneration = useRef(0), wholesaleRequest = useRef(null);
  const formSnapshot = useRef('');
  const [offerSnapshot, setOfferSnapshot] = useState('');
  useEffect(() => {
    wholesaleGeneration.current++; wholesaleRequest.current?.abort(); wholesaleLock.current=false;
    setSavingWholesale(false); setWholesaleError(''); setWholesaleSuccess('');
    formSnapshot.current = JSON.stringify(newProductForm);
    setOfferSnapshot(JSON.stringify((newProductForm.variants || []).map(v => [v._id,v.wholesalePricing || {enabled:false}])));
    if (showAddProductModal && wholesaleOnly) setActiveTab('variants');
    return () => { wholesaleGeneration.current++; wholesaleRequest.current?.abort(); };
  }, [showAddProductModal, editingProductId, wholesaleVariantId]);
  const wholesaleAuthorized = sellerProfile?.status === 'approved'
    && sellerProfile?.wholesaleChannel?.status === 'approved'
    && sellerProfile?.salesChannels?.includes('wholesale');

  // ---- category cascade: Header (L1) -> Main (L2) -> Sub (L3) --------------
  // Only the deepest level chosen is submitted; the server re-checks it is an
  // active leaf in this seller's channel — exactly the rule the legacy modal
  // already enforced, carried over unchanged.
  const [catTree, setCatTree] = useState([]);
  const [catsLoading, setCatsLoading] = useState(false);
  const [pickL1, setPickL1] = useState('');
  const [pickL2, setPickL2] = useState('');
  const [pickL3, setPickL3] = useState('');

  // E-books use the Shop All tree; everything else follows the active channel.
  const categoryTreeType = isDigital ? 'ecommerce' : activeChannel;

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
  const effectiveCategoryId = useMemo(() => {
    if (pickL3) return pickL3;
    if (pickL2 && l3List.length === 0) return pickL2;
    if (pickL1 && l2List.length === 0) return pickL1;
    return '';
  }, [pickL1, pickL2, pickL3, l2List.length, l3List.length]);

  const categoryBreadcrumb = useMemo(() => {
    const parts = [];
    if (l1Node) parts.push(l1Node.name);
    if (l2Node) parts.push(l2Node.name);
    const l3Node = l3List.find((c) => c._id === pickL3);
    if (l3Node) parts.push(l3Node.name);
    return parts.join(' > ');
  }, [l1Node, l2Node, l3List, pickL3]);

  useEffect(() => {
    setNewProductForm((f) => ({ ...f, categoryId: effectiveCategoryId }));
  }, [effectiveCategoryId, setNewProductForm]);

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
   * Load the admin category limit for physical retail listings. Sellers may
   * choose a shorter product window but cannot widen this limit.
   */
  const showReturnableBlock = !wholesaleProductEditor && !wholesaleOnly && ['grocery','ecommerce','quick'].includes(activeChannel);
  const [catReturnPolicy, setCatReturnPolicy] = useState(null);
  const returnChoiceTouched = useRef(false);
  useEffect(() => { returnChoiceTouched.current = false; }, [showAddProductModal, editingProductId]);
  const [returnPolicyState, setReturnPolicyState] = useState('idle'), [returnPolicyAttempt, retryReturnPolicy] = useState(0);
  useEffect(() => {
    setCatReturnPolicy(null);
    if (!showReturnableBlock || !effectiveCategoryId) { setReturnPolicyState('idle'); return; }
    setReturnPolicyState('loading');
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/products/category-return-policy?categoryId=${effectiveCategoryId}`), {
          headers: { Authorization: `Bearer ${localStorage.getItem('sellerToken')}` },
        });
        const body = await res.json();
        if (!res.ok || body.success === false || typeof body.data?.eligible !== 'boolean') throw new Error('Unable to check category policy');
        if (!cancelled) {
          setCatReturnPolicy(body.data); setReturnPolicyState('ready');
          if (body.data.source === 'global' && editingProduct && editingProduct.type !== 'grocery' && !editingProduct.returnSettings && !returnChoiceTouched.current) setNewProductForm(form => ({ ...form, returnable: false }));
        }
      } catch {
        if (!cancelled) { setCatReturnPolicy(null); setReturnPolicyState('error'); }
      }
    })();
    return () => { cancelled = true; };
  }, [showReturnableBlock, effectiveCategoryId, returnPolicyAttempt]);

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
    setEbookFile(null);
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

  const updateWholesalePricing = (index, updater) => {
    setWholesaleSuccess(''); setWholesaleError('');
    setNewProductForm((form) => ({
      ...form,
      variants: (form.variants || []).map((variant, i) => i === index
        ? { ...variant, wholesalePricing: updater(variant.wholesalePricing || { enabled: false }) }
        : variant),
    }));
  };

  const savedOffers = new Map(JSON.parse(offerSnapshot || '[]').map(([id,pricing])=>[String(id),JSON.stringify(pricing)]));
  const wholesaleChanges = variants.filter(v=>v._id && JSON.stringify(v.wholesalePricing || {enabled:false})!==savedOffers.get(String(v._id)));
  // Retail variant additions/removals do not edit Wholesale offer terms.
  const wholesaleDirty = wholesaleOnly || wholesaleProductEditor
    ? offerSnapshot !== JSON.stringify(variants.map(v => [v._id,v.wholesalePricing || {enabled:false}]))
    : wholesaleChanges.length > 0;
  const wholesaleInvalid = wholesaleChanges.some(v => Object.keys(validateWholesaleOffer(v.wholesalePricing,v.stock)).length);
  const saveWholesalePricing = async () => {
    if (!isEditing || !editingProductId || !wholesaleAuthorized || isDigital || wholesaleLock.current) return;
    setWholesaleError(''); setWholesaleSuccess('');
    if (wholesaleInvalid) { setWholesaleError('Correct the Wholesale fields shown for each variant.'); setActiveTab('variants'); return; }
    const configured = wholesaleChanges.map(v=>({variantId:v._id,wholesalePricing:offerPayload(v.wholesalePricing)}));
    if (!configured.length) { setWholesaleError('Save the product variants first.'); return; }
    const generation=wholesaleGeneration.current, token=localStorage.getItem('sellerToken');
    const controller=new AbortController(); wholesaleRequest.current=controller;
    const current=()=>!controller.signal.aborted && generation===wholesaleGeneration.current && token===localStorage.getItem('sellerToken');
    wholesaleLock.current=true;setSavingWholesale(true);
    try {
      const response=await boundedFetch(apiUrl('/api/products/'+editingProductId+'/wholesale-pricing'),{method:'PATCH',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({variants:configured,version:editingProduct.__v ?? 0})});
      const body=await response.json();if(!current())return;
      if(!response.ok)throw new Error(body.message || 'Could not save Wholesale terms');
      sellerCtx.applySavedWholesaleTerms?.(editingProductId,body);
      setOfferSnapshot(JSON.stringify(variants.map(v=>[v._id,body.variants.find(t=>String(t.variantId)===String(v._id))?.wholesalePricing || v.wholesalePricing || {enabled:false}])));
      const baseline=JSON.parse(formSnapshot.current || '{}');
      baseline.variants=(baseline.variants || []).map(v=>({...v,wholesalePricing:body.variants.find(t=>String(t.variantId)===String(v._id))?.wholesalePricing || v.wholesalePricing}));
      formSnapshot.current=JSON.stringify(baseline);
      triggerToast('Wholesale terms saved.');
      setWholesaleSuccess('Wholesale terms saved. Retail prices and shared inventory are unchanged.');
      await sellerCtx.fetchMyProducts?.();
    }catch(error){if(current())setWholesaleError(error.message || 'Could not save Wholesale terms');}
    finally{if(current()){wholesaleLock.current=false;setSavingWholesale(false);}}
  };

  // Mirrors the server's own checks — every variant needs a name, a positive
  // price, a non-negative stock, and a selling price that never exceeds MRP.
  const variantErrors = variants.map((v) => {
    if (!v.name || !String(v.name).trim()) return 'needs a name';
    if (!wholesaleProductEditor && (v.price === '' || v.price === undefined || Number(v.price) <= 0)) return 'needs a valid selling price';
    if (v.stock === '' || v.stock === undefined || Number(v.stock) < 0) return 'stock cannot be negative';
    if (!wholesaleProductEditor && v.mrp !== '' && v.mrp !== undefined && Number(v.price) > Number(v.mrp)) return 'price cannot be higher than its MRP';
    return '';
  });

  const tabs = useMemo(() => [
    { id: 'general', label: 'General Info' },
    { id: 'groups', label: isDigital ? 'Category' : 'Category & Groups' },
    ...(!isDigital ? [{ id: 'variants', label: 'Item Variants' }] : []),
    { id: 'photos', label: isDigital ? 'Cover & PDF' : 'Photos' },
  ], [isDigital]);

  // E-book MRP is optional but never below the price; copies are a whole number.
  const ebookMrpError = isDigital && newProductForm.ebookMrp !== '' && newProductForm.ebookMrp !== undefined
    && (!(Number(newProductForm.ebookMrp) > 0) || Number(newProductForm.ebookMrp) < Number(newProductForm.ebookPrice))
    ? 'MRP must be at least the selling price' : '';
  const ebookStockError = isDigital && (newProductForm.ebookStock === '' || newProductForm.ebookStock === undefined
    || !Number.isSafeInteger(Number(newProductForm.ebookStock)) || Number(newProductForm.ebookStock) < 0)
    ? 'copies available must be a whole number (0 or more)' : '';
  const tabErrors = useMemo(() => {
    const errs = { general: [], groups: [], variants: [], photos: [] };

    // General Info validation
    const trimmedName = String(newProductForm.name || '').trim();
    if (!trimmedName) {
      errs.general.push('Product Title is required');
    } else if (trimmedName.length < 3) {
      errs.general.push('Product Title must be at least 3 characters');
    }

    if (isDigital) {
      if (!String(newProductForm.author || '').trim()) {
        errs.general.push('Author name is required for e-books');
      }
      if (!String(newProductForm.language || '').trim()) {
        errs.general.push('Language is required for e-books');
      }
      const ep = Number(newProductForm.ebookPrice);
      if (newProductForm.ebookPrice === '' || newProductForm.ebookPrice === undefined || !Number.isFinite(ep) || ep <= 0) {
        errs.general.push('Valid e-book price (₹) is required');
      }
      if (ebookMrpError) errs.general.push(`E-book ${ebookMrpError}`);
      if (ebookStockError) errs.general.push(`E-book ${ebookStockError}`);
    }

    if (!isDigital && showReturnableBlock && newProductForm.returnable && newProductForm.returnWindowDays !== '' && newProductForm.returnWindowDays != null) {
      const days = Number(newProductForm.returnWindowDays);
      if (!Number.isSafeInteger(days) || days <= 0) errs.general.push('Return window must be a positive whole number of days');
      else if (returnPolicyState === 'error' || returnPolicyState === 'loading') errs.general.push('Check the category return policy before saving a product window');
      else if (!catReturnPolicy?.eligible) errs.general.push('Admin must enable category or global returns before setting a product window');
      else if (days > catReturnPolicy.returnWindowDays) errs.general.push(`Return window cannot exceed ${catReturnPolicy.returnWindowDays} days`);
    }

    // Category / Groups validation
    if (!pickL1) {
      errs.groups.push('Please select a header category');
    } else if (l2List.length > 0 && !pickL2) {
      errs.groups.push('Please select a main category');
    } else if (l3List.length > 0 && !pickL3) {
      errs.groups.push('Please select a specific sub-category');
    } else if (!effectiveCategoryId) {
      errs.groups.push('Please select a valid category leaf');
    }

    // Variants validation (physical only)
    if (!isDigital) {
      if (!Array.isArray(variants) || variants.length === 0) {
        errs.variants.push('Add at least one variant with pricing and stock');
      } else {
        variants.forEach((v, i) => {
          const label = v.name ? `"${v.name}"` : `Variant ${i + 1}`;
          if (wholesaleProductEditor) {
            const errors = Object.values(validateWholesaleOffer(v.wholesalePricing,v.stock));
            if (errors.length) errs.variants.push(`${label}: ${errors[0]}`);
          }
          if (!v.name || !String(v.name).trim()) errs.variants.push(`${label} requires a name`);
          if (!wholesaleProductEditor && (v.price === '' || v.price === undefined || Number(v.price) <= 0)) errs.variants.push(`${label} requires a valid selling price (> 0)`);
          if (wholesaleProductEditor && ((v.attributes || []).some(a=>!a.name?.trim()||!a.value?.trim()) || !Number.isSafeInteger(Number(v.stock)))) errs.variants.push(`${label} requires whole stock and complete attributes`);
          if (v.stock === '' || v.stock === undefined || Number(v.stock) < 0) errs.variants.push(`${label} stock cannot be negative`);
          if (!wholesaleProductEditor && v.mrp !== '' && v.mrp !== undefined && Number(v.price) > Number(v.mrp)) errs.variants.push(`${label} price cannot exceed MRP`);
        });
      }
      if (wholesaleProductEditor && !isEditing && !variants.some(v=>v.wholesalePricing?.enabled)) errs.variants.push('Enable at least one Wholesale variant');
    }

    // Photos / Media validation
    const hasCover = Boolean(coverImage?.file || (isEditing && editingProduct?.images?.[0]));
    if (!hasCover) {
      errs.photos.push(isDigital ? 'Main e-book cover photo is required' : 'Main product cover photo is required');
    }
    if (isDigital) {
      const hasPdf = Boolean(ebookFile || editingProduct?.digital?.file?.status === 'uploaded');
      if (!hasPdf) {
        errs.photos.push('Digital e-book PDF file is required');
      }
    }

    return errs;
  }, [newProductForm, isDigital, pickL1, pickL2, pickL3, l2List.length, l3List.length, effectiveCategoryId, variants, wholesaleProductEditor, coverImage, isEditing, editingProduct, ebookFile, showReturnableBlock, catReturnPolicy, returnPolicyState, ebookMrpError, ebookStockError]);

  const allErrors = useMemo(() => Object.values(tabErrors).flat(), [tabErrors]);
  const creationTermsValid = !wholesaleProductEditor || (wholesaleAuthorized && (isEditing || variants.some(v=>v.wholesalePricing?.enabled)) && !variants.some(v=>Object.keys(validateWholesaleOffer(v.wholesalePricing,v.stock)).length));
  const canSubmit = !savingProduct && allErrors.length === 0 && creationTermsValid;
  const footerCanSubmit = wholesaleOnly ? wholesaleAuthorized && !wholesaleInvalid && wholesaleDirty : canSubmit;

  const navigateToFirstError = () => {
    for (const tab of tabs) {
      if (tabErrors[tab.id]?.length > 0) {
        setActiveTab(tab.id);
        break;
      }
    }
  };

  const handleSubmit = async (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (wholesaleOnly) { await saveWholesalePricing(); return; }
    if (!canSubmit) {
      navigateToFirstError();
      return;
    }
    const save = () => isEditing ? submitProductEdit(newProductForm, collectedFiles, ebookFile) : submitNewProduct(newProductForm, collectedFiles, ebookFile);
    // Confirming saves the product, so the dialog must read as a save, not a discard.
    if (!wholesaleProductEditor && wholesaleDirty) return ui.perform({
      title: 'Save product without the Wholesale changes?',
      message: 'You edited Wholesale terms but did not save them with “Save Wholesale Terms”. Saving now keeps your product details and leaves the Wholesale terms as they were.',
      confirmLabel: 'Save product', cancelLabel: 'Go back', destructive: false,
    }, save);
    return save();
  };

  const close = async () => {
    if (savingWholesale || savingProduct) return;
    if (ebookDraftAwaitingPdf) {
      // Nothing is discarded here: the listing already exists as a draft.
      if (!await ui.ask('This e-book is already saved as a draft, but its PDF is not uploaded yet, so buyers cannot see it. Close anyway? You can upload the PDF later from Edit.')) return;
      setShowAddProductModal(false); setEditingProductId(null);
      sellerCtx.fetchMyProducts?.();
      return;
    }
    if ((wholesaleDirty || formSnapshot.current !== JSON.stringify(newProductForm) || collectedFiles.length || ebookFile) && !await ui.ask('Discard unsaved product changes?')) return;
    setShowAddProductModal(false); setEditingProductId(null);
  };

  if (!showAddProductModal) return null;

  const slugPreview = slugify(newProductForm.name);

  if (wholesaleOnly) {
    const chosen = variants.map((variant,index)=>({variant,index})).filter(({variant})=>!wholesaleVariantId || String(variant._id)===String(wholesaleVariantId));
    const authorized=hasWholesaleAccess(sellerProfile);
    return <ModalPortal className="seller-modal-overlay seller-wholesale-overlay" onClick={close} onKeyDown={event=>{if(event.key==='Escape')close();}}>
      <div ref={wholesaleDialog} className="seller-wholesale-editor seller-modal-sheet" role="dialog" aria-modal="true" aria-labelledby="wholesale-editor-title" onClick={event=>event.stopPropagation()}>
        <header className="seller-products-dialog-heading"><div><small>WHOLESALE (B2B)</small><h2 id="wholesale-editor-title">Wholesale Offer Terms</h2><p>{editingProduct?.name}</p></div><button type="button" className="seller-products-button" aria-label="Close" onClick={close} disabled={savingWholesale}>×</button></header>
        <div className="seller-wholesale-editor-body">
          {!authorized || isDigital ? <p role="alert">This product or seller is not eligible for Wholesale. Refresh your seller access and choose an eligible physical product.</p> : !chosen.length ? <p role="alert">This variant is no longer available. Close the editor and refresh your products.</p> : chosen.map(({variant:v,index:i})=><section className="seller-wholesale-variant" key={String(v._id)}>
            <dl className="seller-offer-reference"><div><dt>Product</dt><dd>{editingProduct.name}</dd></div><div><dt>Variant</dt><dd>{v.name}</dd></div><div><dt>SKU</dt><dd>{v.sku || editingProduct.sku || 'Unavailable'}</dd></div><div><dt>Shared available stock</dt><dd>{v.stock} {v.unit || ''}</dd></div></dl>
            <p className="seller-products-hint">Retail price ₹{v.price}, MRP ₹{v.mrp}. Retail prices, stock, unit and weight are managed in {activeChannel==='grocery'?'Quick Commerce':'E-Commerce'}.</p>
            <VariantWholesaleFields variant={v} index={i} onChange={updateWholesalePricing} disabled={savingWholesale} eligible={eligibleWholesaleProduct(editingProduct)}/>
          </section>)}
          {wholesaleError && <p role="alert" className="seller-wholesale-errors">{wholesaleError} Your inputs are retained; correct the issue or retry Save Wholesale Terms.</p>}
          {wholesaleSuccess && <p role="status" className="seller-products-success">{wholesaleSuccess}</p>}
        </div>
        <footer className="seller-products-dialog-actions"><button type="button" className="seller-products-button" onClick={close} disabled={savingWholesale}>Close</button><button type="button" className="seller-products-button seller-products-primary" onClick={saveWholesalePricing} disabled={savingWholesale||!authorized||isDigital||!chosen.length||wholesaleInvalid||!wholesaleDirty}>{savingWholesale?'Saving…':'Save Wholesale Terms'}</button></footer>
      </div>
    </ModalPortal>;
  }

  // A listing's primary channel is fixed forever once created (the backend
  // doesn't even accept a `type` change on update) — only whether it's ALSO
  // cross-listed to the other storefront ("Both") can move.
  const showSameDayBlock = activeChannel === 'ecommerce';

  return (
    <ModalPortal className="pm-overlay" style={{...S.overlay,...(wholesaleProductEditor ? {zIndex:1100} : {})}} onClick={close} onKeyDown={event=>{if(event.key==='Escape')close();}}>
      <div ref={wholesaleDialog} role="dialog" aria-modal="true" aria-label={wholesaleProductEditor ? "Wholesale product listing" : "Product listing editor"} className={`pm-dialog ${wholesaleOnly ? 'pm-wholesale' : wholesaleProductEditor ? 'pm-wholesale-product' : ''}`} style={S.dialog} onClick={(e) => e.stopPropagation()}>
        {/* ---- left sidebar column ---- */}
        <div className="pm-sidebar" style={S.sidebar}>
          <div>
            <div className="pm-sidebar-brand" style={{ ...S.sidebarBrand, ...(wholesaleOnly ? { marginBottom: 8 } : {}) }}>
              <span style={S.sidebarBrandIcon}>🏷️</span>
              <span style={S.sidebarBrandLabel}>Listing Editor</span>
            </div>
            <nav className="pm-tab-nav" style={S.tabNav}>
              {tabs.map((t) => {
                const hasError = tabErrors[t.id]?.length > 0;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-current={activeTab === t.id ? 'step' : undefined}
                    onClick={() => setActiveTab(t.id)}
                    style={{ ...S.tabBtn, ...(activeTab === t.id ? S.tabBtnActive : {}) }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {t.label}
                      {hasError && (
                        <span style={S.tabErrorDot} title={`${tabErrors[t.id].length} item(s) need attention`}>●</span>
                      )}
                    </span>
                    {t.id === 'variants' && variants.length > 0 && (
                      <span style={S.tabCount}>{variants.length}</span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="pm-sidebar-footer" style={{ ...S.sidebarFooter, ...(wholesaleOnly ? { display: 'none' } : {}) }}>
            {!isDigital && !wholesaleProductEditor && <>
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
            </>}
          </div>
        </div>

        {/* ---- right content column ---- */}
        <div className="pm-right-column" style={S.rightColumn}>
          <div className="pm-header" style={S.header}>
            <div style={{ minWidth: 0 }}>
              <h3 style={S.title}>{wholesaleProductEditor ? (isEditing ? 'Edit Wholesale Product' : 'Add Wholesale Product') : ebookDraftAwaitingPdf ? 'E-book Draft — PDF Needed' : isEditing ? 'Edit Product' : 'Add Product Listing'}</h3>
              <div style={S.breadcrumb}>
                {wholesaleProductEditor ? 'WHOLESALE ONLY' : (activeChannel === 'quick' || activeChannel === 'grocery') ? 'QUICK COMMERCE' : 'SHOP ALL'}
                {' > '}
                {isEditing ? (editingProduct?.name || editingProductId) : 'NEW LISTING'}
              </div>
            </div>
            <button type="button" onClick={close} style={S.closeBtn} aria-label="Close">✕</button>
          </div>

          <div className="pm-main" style={S.main}>
            <p className="seller-products-hint" role="status">Selling channels: {wholesaleProductEditor ? 'Wholesale only. Not listed in E-Commerce or Quick Commerce. Physical products follow the existing publication policy.' : editingProduct?.sellingChannels?.join(', ') || [editingProduct?.type || activeChannel,...(editingProduct?.channels || []).filter(c=>c.isActive!==false).map(c=>c.type)].join(', ')}</p>
            {wholesaleOnly && <p style={{padding:12}}>Wholesale terms only. Retail details are shown for reference; manage them in E-Commerce or Quick Commerce.</p>}
            {activeTab === 'general' && (
              <div style={S.tabPanel} inert={wholesaleOnly || undefined}>
                {!isEditing && !wholesaleProductEditor && (
                  <div className="onboarding-form-group">
                    <span className="onboarding-label">What are you adding? *</span>
                    <div role="group" aria-label="Listing type" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {[['physical', '📦 Add Physical Product'], ...(activeChannel === 'ecommerce' ? [['digital', '📚 Add E-book']] : [])].map(([value, text]) => {
                        const active = (newProductForm.fulfillmentType || 'physical') === value;
                        return (
                          <button key={value} type="button" aria-pressed={active}
                            onClick={() => {
                              if (active) return;
                              resetCategoryPicks();
                              setNewProductForm((prev) => ({ ...prev, fulfillmentType: value, categoryId: '' }));
                              setActiveTab('general');
                            }}
                            style={{ ...S.gstBtn, ...(active ? S.gstBtnActive : {}) }}>
                            {text}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="onboarding-form-group">
                  <label className="onboarding-label">Category *</label>
                  {effectiveCategoryId ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 8, background: 'var(--bg-page)', border: '1.5px solid var(--primary)', gap: 10 }}>
                      <div>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)', display: 'block' }}>Selected Category Leaf</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{categoryBreadcrumb}</span>
                      </div>
                      <button type="button" onClick={() => setActiveTab('groups')} style={{ border: '1px solid var(--primary)', background: 'var(--bg-card)', color: 'var(--primary)', padding: '6px 12px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 11.5 }}>
                        Change Category →
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 8, background: '#fffbeb', border: '1.5px dashed #f59e0b', gap: 10 }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>⚠️ No category selected yet</span>
                        <span style={{ fontSize: 11, color: '#78350f', display: 'block' }}>Choose a category in the Category tab to enable submission</span>
                      </div>
                      <button type="button" onClick={() => setActiveTab('groups')} style={{ border: 'none', background: 'var(--primary)', color: '#fff', padding: '6px 14px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 11.5 }}>
                        Select Category →
                      </button>
                    </div>
                  )}
                </div>

                <div className="onboarding-form-group">
                  <label className="onboarding-label">Product Title *</label>
                  <input
                    type="text" className="onboarding-input" placeholder={isDigital ? 'e.g. 1984 by George Orwell' : 'e.g. Stainless Steel Peeler'}
                    value={newProductForm.name}
                    onChange={(e) => setNewProductForm({ ...newProductForm, name: e.target.value })}
                    minLength={3} required
                  />
                  {newProductForm.name && newProductForm.name.trim().length < 3 && (
                    <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                      * Title must be at least 3 characters
                    </span>
                  )}
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
                    placeholder={isDigital ? 'Book summary, chapters, target audience...' : 'Material, size, what makes it good...'}
                    value={newProductForm.desc}
                    onChange={(e) => setNewProductForm({ ...newProductForm, desc: e.target.value })} />
                </div>

                {!isDigital && <div className="onboarding-form-group">
                  <label className="onboarding-label">Brand Name</label>
                  {/* Plain input with in-page chips: a <datalist> opens a native popup
                      that mobile browsers draw over the on-screen keyboard. */}
                  <input
                    type="text" className="onboarding-input"
                    placeholder="e.g. Local Make"
                    autoComplete="off"
                    value={newProductForm.brandName}
                    onChange={(e) => setNewProductForm({ ...newProductForm, brandName: e.target.value })}
                  />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }} aria-label="Brand suggestions">
                    {BRAND_SUGGESTIONS.map((b) => {
                      const active = newProductForm.brandName === b;
                      return (
                        <button key={b} type="button" aria-pressed={active}
                          onClick={() => setNewProductForm({ ...newProductForm, brandName: b })}
                          style={{ ...S.gstBtn, ...(active ? S.gstBtnActive : {}) }}>
                          {b}
                        </button>
                      );
                    })}
                  </div>
                </div>}

                {isDigital && <>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Author *</label>
                    <input className="onboarding-input" maxLength={160} placeholder="e.g. George Orwell" value={newProductForm.author || ''}
                      onChange={(event) => setNewProductForm({ ...newProductForm, author: event.target.value })} />
                    {!String(newProductForm.author || '').trim() && (
                      <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                        * Author is required
                      </span>
                    )}
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Language *</label>
                    <input className="onboarding-input" maxLength={80} placeholder="e.g. English, Hindi, Marathi" value={newProductForm.language || ''}
                      onChange={(event) => setNewProductForm({ ...newProductForm, language: event.target.value })} />
                    {!String(newProductForm.language || '').trim() && (
                      <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                        * Language is required
                      </span>
                    )}
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Price (₹) *</label>
                    <input type="number" min="0.01" step="0.01" className="onboarding-input" placeholder="e.g. 199" value={newProductForm.ebookPrice || ''}
                      onChange={(event) => setNewProductForm({ ...newProductForm, ebookPrice: event.target.value })} />
                    {(newProductForm.ebookPrice === '' || Number(newProductForm.ebookPrice) <= 0) && (
                      <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                        * Valid selling price greater than ₹0 is required
                      </span>
                    )}
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">MRP (₹)</label>
                    <input type="number" min="0.01" step="0.01" className="onboarding-input" placeholder="e.g. 299 (leave blank to use the price)" value={newProductForm.ebookMrp ?? ''}
                      onChange={(event) => setNewProductForm({ ...newProductForm, ebookMrp: event.target.value })} />
                    {ebookMrpError && <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>* {ebookMrpError}</span>}
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Copies available *</label>
                    <input type="number" min="0" step="1" inputMode="numeric" className="onboarding-input" placeholder="e.g. 100" value={newProductForm.ebookStock ?? ''}
                      onChange={(event) => setNewProductForm({ ...newProductForm, ebookStock: event.target.value })} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'block' }}>One copy is used per sale; at 0 the e-book shows as sold out.</span>
                    {ebookStockError && <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>* {ebookStockError}</span>}
                  </div>
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">License / permitted use (optional)</label>
                    <textarea className="onboarding-input" rows={3} maxLength={2000} placeholder="e.g. Standard personal use license. Redistribution prohibited." value={newProductForm.licenseTerms || ''}
                      onChange={(event) => setNewProductForm({ ...newProductForm, licenseTerms: event.target.value })} />
                  </div>
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: '#f0f9ff', border: '1px solid #bae6fd', color: '#0369a1', fontSize: 12, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>📖</span> Digital E-book Listing Guide
                    </div>
                    E-books are fulfilled digitally with no shipping; set how many copies you want to sell above. Next, pick a category in the <strong>Category</strong> tab and upload the cover image plus your original PDF file in the <strong>Cover & PDF</strong> tab. Once submitted, your listing is sent for admin review. Approved listings can be purchased through Razorpay and delivered through the customer’s private Digital Library.
                  </div>
                </>}

                {!isDigital && <div className="onboarding-form-group">
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
                </div>}

                {!isDigital && <div className="onboarding-form-group">
                  <span className="onboarding-label">GST Price Type</span>
                  <p style={{ fontSize: 12, lineHeight: 1.5 }}><strong>Your prices include GST.</strong> Enter the final price the customer pays:
                    at 5% GST, a ₹105 price includes ₹5 GST. This applies to every variant and wholesale price. Commission GST is separate.</p>
                </div>}

                {!isDigital && <div style={S.hintBox}>
                  {wholesaleProductEditor ? 'Configure shared stock and Wholesale MOQ, increments and tier prices in' : 'Selling price, MRP, stock, unit and weight are set per variant — head to the'} <strong>Item Variants</strong> tab.
                </div>}

                {/*
                  Allow Returns — QUICK COMMERCE ONLY.
                  A plain YES/NO opt-out, never a window: the number of days
                  always comes from Admin's Category Return Policy, shown
                  here read-only so the Seller knows what they're opting
                  into/out of without being able to change it.
                */}
                {!isDigital && showReturnableBlock && (
                  <div className="onboarding-form-group" style={{ border: '1.5px solid var(--border-color)', borderRadius: 10, padding: 12 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                      <input type="checkbox" checked={Boolean(newProductForm.returnable)}
                        onChange={(e) => { returnChoiceTouched.current = true; setNewProductForm({ ...newProductForm, returnable: e.target.checked }); }} />
                      <span style={{ fontSize: 12.5, fontWeight: 800 }}>↩️ Allow Returns</span>
                    </label>
                    <div style={{ marginTop: 8, marginLeft: 26, fontSize: 11, color: 'var(--text-secondary)' }}>
                      {!effectiveCategoryId
                        ? 'Pick a category to see its return window.'
                        : returnPolicyState === 'loading' ? 'Checking the category return window…'
                        : returnPolicyState === 'error' ? <span role="alert">Category return policy could not be checked. <button type="button" onClick={() => retryReturnPolicy(n => n + 1)}>Retry return policy</button></span>
                        : catReturnPolicy?.eligible
                          ? `${catReturnPolicy.source === 'global' ? 'Global' : 'Category'} limit: ${catReturnPolicy.returnWindowDays} days. Choose your product window below.`
                          : 'No return window is available. Admin can set a category policy or enable the global default.'}
                    </div>
                    {newProductForm.returnable && <label className="onboarding-label" style={{ marginTop: 10 }}>Return window (days after delivery)
                      <input className="onboarding-input" type="number" min="1" step="1" max={catReturnPolicy?.returnWindowDays || undefined}
                        disabled={returnPolicyState !== 'ready' || !catReturnPolicy?.eligible}
                        placeholder={catReturnPolicy?.eligible ? `Use ${catReturnPolicy.source === 'global' ? 'global' : 'category'} default (${catReturnPolicy.returnWindowDays} days)` : 'Set an active category or global window first'}
                        value={newProductForm.returnWindowDays ?? ''} onChange={e => setNewProductForm({ ...newProductForm, returnWindowDays: e.target.value })}/>
                    </label>}
                    <p style={{ fontSize: 11, marginTop: 8 }} role="status">{!newProductForm.returnable ? 'Customers will see: Non-Returnable.' : catReturnPolicy?.eligible ? `Customers will see: ${Math.min(Number(newProductForm.returnWindowDays) || catReturnPolicy.returnWindowDays, catReturnPolicy.returnWindowDays)} days return available. Existing orders keep their original policy.` : 'Returns require an active category policy or global default.'}</p>
                  </div>
                )}

                {/* Same-Day, only on the Ecommerce/Shop All leg. */}
                {isEditing && !wholesaleProductEditor && !isDigital && showSameDayBlock && (
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
                        {!sellerProfile?.sameDay?.enabled && (
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
                  <button type="button" disabled={wholesaleOnly||savingWholesale||savingProduct} onClick={addVariant} style={S.addBtn}>+ ADD</button>
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
                            <input readOnly={wholesaleOnly||savingWholesale||savingProduct} type="text" className="onboarding-input" placeholder="Default, Pack of 2…" value={v.name} aria-label={`Variant ${i+1} name`}
                              onChange={(e) => updateVariant(i, 'name', e.target.value)} />
                          </div>
                          {variants.length > 1 && (
                            <button type="button" disabled={wholesaleOnly||savingWholesale||savingProduct} onClick={() => removeVariant(i)} style={S.trashBtn} aria-label="Remove variant">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                        <div className="pm-variant-fields" style={wholesaleOnly ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : undefined}>
                          {!wholesaleProductEditor && <><div style={S.variantField}>
                            <label style={S.microLabel}>SELLING PRICE (₹) *</label>
                            <input readOnly={wholesaleOnly||savingWholesale||savingProduct} type="number" min="1" className="onboarding-input" placeholder="499" value={v.price}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'price', e.target.value)} />
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>MRP (₹)</label>
                            <input readOnly={wholesaleOnly||savingWholesale||savingProduct} type="number" min="0" className="onboarding-input" placeholder="699" value={v.mrp}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'mrp', e.target.value)} />
                          </div>
                          </>}<div style={S.variantField}>
                            <label style={S.microLabel}>STOCK *</label>
                            <input readOnly={wholesaleOnly||savingWholesale||savingProduct} type="number" min="0" className="onboarding-input" placeholder="25" value={v.stock} aria-label={`Variant ${i+1} stock`}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'stock', e.target.value)} />
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>UNIT</label>
                            <select disabled={wholesaleOnly||savingWholesale||savingProduct} className="onboarding-select" value={v.unit || 'piece'}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'unit', e.target.value)}>
                              {['piece', 'kg', 'g', 'litre', 'ml', 'dozen', 'pack'].map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </div>
                          <div style={S.variantField}>
                            <label style={S.microLabel}>WEIGHT (g)</label>
                            <input readOnly={wholesaleOnly||savingWholesale||savingProduct} type="number" min="0" className="onboarding-input" placeholder="500" value={v.weight}
                              style={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }}
                              onChange={(e) => updateVariant(i, 'weight', e.target.value)} />
                          </div>
                        </div>
                        {wholesaleProductEditor && <div className="seller-offer-variant-details"><label className="seller-offer-field">SKU<input className="onboarding-input" value={v.sku || ''} disabled={savingProduct} onChange={e=>updateVariant(i,'sku',e.target.value)} /></label><VariantAttributesEditor value={v.attributes} disabled={savingProduct} onChange={value=>updateVariant(i,'attributes',value)}/></div>}
                        {variantErrors[i] && <div style={S.errorText}>{v.name || `Variant ${i + 1}`} {variantErrors[i]}.</div>}
                        {wholesaleAuthorized && (isEditing || wholesaleProductEditor) && !isDigital && <VariantWholesaleFields allowUnsaved={wholesaleProductEditor} variant={v} index={i} onChange={updateWholesalePricing} disabled={savingWholesale||savingProduct} eligible={wholesaleProductEditor || (editingProduct?.status==='approved'&&editingProduct?.isActive&&editingProduct?.category?.isActive!==false)}/>}
                      </div>
                    ))}
                  </div>
                )}
                {wholesaleAuthorized && isEditing && !isDigital && !wholesaleProductEditor && (
                  <section aria-label="Wholesale catalog settings" style={{ marginTop: 14, padding: 12, border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }}>
                    <strong style={{ color: '#073b78', fontSize: 13 }}>Wholesale catalog</strong>
                    {wholesaleError && <p role="alert" className="seller-wholesale-errors">{wholesaleError}</p>}
                    <p style={{ margin: '5px 0 10px', color: '#64748b', fontSize: 11, lineHeight: 1.5 }}>Set per-variant MOQ and quantity prices. Customer Wholesale carts use these terms with your shared inventory.</p>
                    <button type="button" onClick={saveWholesalePricing} disabled={savingWholesale || savingProduct || wholesaleInvalid || !wholesaleDirty} style={{ border: 0, borderRadius: 8, background: '#08b9e8', color: '#fff', padding: '8px 12px', fontWeight: 800, cursor: savingWholesale ? 'wait' : 'pointer', opacity: savingWholesale || variants.some((variant) => !variant._id) ? 0.6 : 1 }}>
                      {savingWholesale ? 'Saving…' : 'Save Wholesale Terms'}
                    </button>
                  </section>
                )}
              </div>
            )}

            {activeTab === 'groups' && (
              <div style={S.tabPanel} inert={wholesaleOnly || undefined}>
                <div style={{ marginBottom: 12 }}>
                  <h4 style={S.sectionTitle}>{isDigital ? 'E-book Category' : 'Product Category & Taxonomy'}</h4>
                  <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    {isDigital
                      ? 'Select the category leaf under the E-Commerce catalogue where your e-book will appear.'
                      : `Select the category hierarchy in the ${(activeChannel === 'quick' || activeChannel === 'grocery') ? 'Quick Commerce' : 'Shop All'} catalogue.`}
                  </p>
                </div>

                <div className="onboarding-form-group">
                  <label className="onboarding-label">
                    Main Group (Header) * <span style={{ fontWeight: 600, opacity: 0.7 }}>({categoryTreeType === 'ecommerce' ? 'Shop All' : 'Quick Commerce'} catalogue)</span>
                  </label>
                  <select className="onboarding-select" value={pickL1}
                    onChange={(e) => { setPickL1(e.target.value); setPickL2(''); setPickL3(''); }} required>
                    <option value="">{catsLoading ? 'Loading categories...' : 'Select header category'}</option>
                    {catTree.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                </div>

                {pickL1 && l2List.length > 0 && (
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Main Category *</label>
                    <select className="onboarding-select" value={pickL2}
                      onChange={(e) => { setPickL2(e.target.value); setPickL3(''); }} required>
                      <option value="">Select main category *</option>
                      {l2List.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    {!pickL2 && (
                      <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                        * Main Category is required.
                      </span>
                    )}
                  </div>
                )}

                {pickL2 && l3List.length > 0 && (
                  <div className="onboarding-form-group">
                    <label className="onboarding-label">Sub-Category *</label>
                    <select className="onboarding-select" value={pickL3}
                      onChange={(e) => setPickL3(e.target.value)} required>
                      <option value="">Select sub-category *</option>
                      {l3List.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    {!pickL3 && (
                      <span style={{ fontSize: 11, color: '#dc2626', marginTop: 4, display: 'block' }}>
                        * Specific sub-category is required to complete listing taxonomy.
                      </span>
                    )}
                  </div>
                )}

                {pickL1 && l2List.length === 0 && (
                  <div style={{ padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', color: '#065f46', fontSize: 12, fontWeight: 600 }}>
                    ℹ️ This header category has no sub-categories and will be used directly as your listing category leaf.
                  </div>
                )}

                {pickL2 && l3List.length === 0 && (
                  <div style={{ padding: '10px 14px', background: '#ecfdf5', borderRadius: 8, border: '1px solid #a7f3d0', color: '#065f46', fontSize: 12, fontWeight: 600 }}>
                    ℹ️ This category has no further sub-categories and will be used directly as your listing category leaf.
                  </div>
                )}

                {effectiveCategoryId ? (
                  <div style={{ marginTop: 14, padding: '12px 16px', borderRadius: 10, background: 'var(--primary-light)', border: '1.5px solid var(--primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>✅</span>
                    <div>
                      <span style={{ fontSize: 10, textTransform: 'uppercase', fontWeight: 800, color: 'var(--primary)', letterSpacing: '0.4px', display: 'block' }}>Active Listing Leaf Category</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)' }}>{categoryBreadcrumb}</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', fontSize: 12, fontWeight: 600 }}>
                    ⚠️ Please complete the selection above until a specific category leaf is determined.
                  </div>
                )}
              </div>
            )}

            {activeTab === 'photos' && (
              <div style={S.tabPanel} inert={wholesaleOnly || undefined}>
                {isDigital ? (
                  <>
                    <div style={{ marginBottom: 14 }}>
                      <h4 style={S.sectionTitle}>E-book Media & Digital Assets</h4>
                      <p style={{ margin: '4px 0 0 0', fontSize: 11.5, color: 'var(--text-secondary)' }}>
                        Provide a storefront cover image and upload your private original PDF document.
                      </p>
                    </div>

                    <div className="onboarding-form-group">
                      <label className="onboarding-label">E-book Cover Photo {!isEditing && '*'}</label>
                      <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }}
                        onChange={(e) => { pickCover(e.target.files?.[0]); e.target.value = ''; }} />
                      <div onClick={() => coverInputRef.current?.click()} style={S.coverBox}>
                        {coverImage ? (
                          <img src={coverImage.url} alt="Cover" style={S.coverImg} />
                        ) : isEditing && editingProduct?.images?.[0] ? (
                          <img src={editingProduct.images[0]} alt="Current cover" style={S.coverImg} />
                        ) : (
                          <div style={{ textAlign: 'center', padding: 16 }}>
                            <span style={{ fontSize: 32, display: 'block', marginBottom: 6 }}>📚</span>
                            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 700, display: 'block' }}>
                              Add Cover Photo *
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>JPG, PNG or WEBP (Max 5 MB)</span>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
                        This cover image is published to Cloudinary and displayed to buyers on catalogue cards and book details.
                      </div>
                    </div>

                    <div className="onboarding-form-group" style={{ marginTop: 14 }}>
                      <label className="onboarding-label">
                        Original Digital E-book File (PDF) {!editingProduct?.digital?.file?.status && '*'}
                      </label>
                      <div style={{ border: '1.5px dashed var(--border-color)', borderRadius: 12, padding: 18, background: 'var(--bg-page)' }}>
                        <input
                          type="file"
                          accept="application/pdf"
                          id="ebook-pdf-file-input"
                          style={{ display: 'none' }}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
                                triggerToast('Only PDF files are allowed for e-books.');
                                return;
                              }
                              setEbookFile(file);
                            }
                          }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 20 }}>🔒</span>
                              {ebookFile ? (
                                <span style={{ color: 'var(--primary)' }}>{ebookFile.name} ({Math.ceil(ebookFile.size / 1024)} KB)</span>
                              ) : editingProduct?.digital?.file?.status === 'uploaded' ? (
                                <span style={{ color: '#16a34a' }}>PDF already securely stored ({Math.ceil((editingProduct.digital.file.sizeBytes || 0) / 1024)} KB)</span>
                              ) : (
                                <span>No PDF file attached yet *</span>
                              )}
                            </div>
                            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                              Secured in private backend storage with SHA-256 verification. Never exposed through public URLs or CDNs.
                            </div>
                          </div>
                          <label
                            htmlFor="ebook-pdf-file-input"
                            style={{
                              border: '1px solid var(--primary)',
                              background: 'var(--bg-card)',
                              color: 'var(--primary)',
                              padding: '9px 18px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: 'pointer',
                              display: 'inline-block',
                            }}
                          >
                            {ebookFile || editingProduct?.digital?.file?.status === 'uploaded' ? 'Change PDF File' : 'Add PDF File *'}
                          </label>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
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
                          <div style={{ textAlign: 'center', padding: 16 }}>
                            <span style={{ fontSize: 32, display: 'block', marginBottom: 6 }}>📷</span>
                            <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 700, display: 'block' }}>
                              Click to upload main cover photo *
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>JPG, PNG or WEBP (Max 5 MB)</span>
                          </div>
                        )}
                      </div>
                      {isEditing && (
                        <span style={{ fontSize: 10, opacity: 0.65, display: 'block', marginTop: 6 }}>
                          Attaching a new cover or any additional photo replaces the entire photo set.
                        </span>
                      )}
                    </div>

                    <div className="onboarding-form-group">
                      <label className="onboarding-label">Additional Product Photos ({ADDITIONAL_SLOTS} optional slots)</label>
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
                  </>
                )}
              </div>
            )}

            {productError && <div role="alert" style={S.errorBox}>{productError}</div>}
          </div>

          {/* ---- footer ---- */}
          <div className="pm-footer" style={S.footer}>
            {!wholesaleOnly && !canSubmit && !savingProduct && allErrors.length > 0 && (
              <div className="pm-footer-error" style={S.footerErrorHint} onClick={navigateToFirstError} title="Click to fix missing fields">
                <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>
                  ⚠️ {allErrors[0]} {allErrors.length > 1 ? `(+${allErrors.length - 1} more)` : ''}
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', marginLeft: 8, textDecoration: 'underline' }}>
                  Fix in {tabs.find((t) => tabErrors[t.id]?.length > 0)?.label} →
                </span>
              </div>
            )}
            <button type="button" onClick={close} style={S.footerCloseBtn}>Close</button>
            <button
              type="button"
              onClick={wholesaleOnly || canSubmit ? handleSubmit : navigateToFirstError}
              disabled={savingProduct || savingWholesale || (wholesaleOnly && (!wholesaleAuthorized || wholesaleInvalid || !wholesaleDirty))}
              style={{
                ...S.footerSaveBtn,
                ...(footerCanSubmit ? {} : S.footerSaveBtnDisabled),
                ...(savingProduct ? { opacity: 0.7, cursor: 'wait' } : {}),
              }}
              title={wholesaleOnly ? 'Save only the changed variant Wholesale terms' : canSubmit ? 'Submit listing' : 'Resolve required fields to submit'}
            >
              {savingProduct || savingWholesale ? 'Saving…' : wholesaleOnly ? 'Save Wholesale Terms' : (wholesaleProductEditor ? 'Save Wholesale Product' : ebookDraftAwaitingPdf ? 'Retry PDF Upload' : isEditing ? 'Save Changes' : 'Save & Submit Listing')}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

const S = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    width: '92%', maxWidth: 1020, height: '90dvh', maxHeight: 720,
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
  tabNav: { display: 'flex', gap: 2 },
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
  rightColumn: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 },
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
    display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, padding: '16px 24px',
    borderTop: '1px solid var(--border-color)', flexShrink: 0, background: 'var(--bg-card)', flexWrap: 'wrap',
  },
  footerCloseBtn: { border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)', borderRadius: 10, padding: '10px 20px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  footerSaveBtn: { border: 'none', background: 'var(--primary)', color: 'var(--text-white)', borderRadius: 10, padding: '10px 24px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  footerSaveBtnDisabled: { background: 'var(--text-muted)', cursor: 'not-allowed', opacity: 0.8 },
  tabErrorDot: { color: '#dc2626', fontSize: 13, lineHeight: 1, fontWeight: 900 },
  footerErrorHint: {
    display: 'flex', alignItems: 'center', cursor: 'pointer', padding: '6px 14px', borderRadius: 8,
    background: '#fef2f2', border: '1px solid #fee2e2', marginRight: 'auto', flexWrap: 'wrap',
  },
};

export default ProductModal;
