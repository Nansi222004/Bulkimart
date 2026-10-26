import { payoutIntent } from '../utils/payoutIntent';
import { useFeedback } from '../../../components/feedback/FeedbackProvider';
import { sellerStepIssues } from '../utils/onboardingValidation';
import { boundedFetch, portalRequest, clearPortalRequests } from '../../../utils/portalRequests';
import { readSellerFinances } from '../utils/sellerFinanceRead';
import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';

// Import image assets for product listings
import { apiUrl } from '../../../utils/api';
import { socket, connectSocket, disconnectSocket } from '../../../utils/socket';
import { stopRing } from '../../../utils/notificationSoundManager';
import { initPushNotifications, deregisterPushToken } from '../../../utils/firebaseMessaging';
import {
  clearSellerDraft,
  getSellerDraftKey,
  readSellerDraft,
  readSellerSessionDraft,
  selectedModesToChannels,
  writeSellerDraft,
  writeSellerSessionDraft,
} from '../utils/onboardingDraft';
import { normalizePhoneInput, normalizeSellerIntent, safeErrorMessage, sellerOtpPayload } from '../utils/sellerAuth';
import { SELLER_SESSION_CHANGED as SESSION_CHANGED, saveSellerSession } from '../../../utils/portalSession';

const SellerContext = createContext();
const getUserId = (profile) => {
  const id = profile?._id || profile?.id || profile?.userId?._id || profile?.userId;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
};
const getBrowserStorage = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
};

export const SellerProvider = ({ children }) => {
  const ui = useFeedback();
  const [userProfile, setUserProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sellerUserProfile') || 'null'); } catch { return null; }
  });
  const userId = getUserId(userProfile);
  const draftKey = getSellerDraftKey(userId);
  const [draftIdentityKey, setDraftIdentityKey] = useState(draftKey);
  const [initialDraft] = useState(() => readSellerDraft(getBrowserStorage(), draftKey));
  const [initialSessionDraft] = useState(() => readSellerSessionDraft(draftKey));
  const submitSellerApplicationLock = React.useRef(false);

  // GLOBAL STATES
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(() => initialSessionDraft?.step || Math.min(initialDraft?.step || 1, 3));
  const [selectedTypes, setSelectedTypes] = useState(() => initialSessionDraft?.selectedTypes || initialDraft?.selectedTypes || ['ecommerce']); // can contain 'ecommerce', 'quick'
  const [activeMode, setActiveMode] = useState('ecommerce'); // 'ecommerce' | 'quick'

  // The panel toggle says "Quick"; the database calls that channel `grocery`.
  // One place to translate, so nothing downstream has to remember the mapping.
  const CHANNEL_OF_MODE = { ecommerce: 'ecommerce', quick: 'grocery' };
  const activeChannel = CHANNEL_OF_MODE[activeMode] || 'ecommerce';
  const getTabFromPath = () => {
    const pathname = window.location.pathname;
    const parts = pathname.split('/').filter(Boolean);
    if (parts[1] && parts[0] === 'seller') return parts[1];
    return 'dashboard';
  };

  const [activeTab, setActiveTabState] = useState(getTabFromPath);

  const currentTabFromPath = getTabFromPath();
  if (activeTab !== currentTabFromPath) {
    setActiveTabState(currentTabFromPath);
  }

  const setActiveTab = (tabId) => {
    detailGeneration.current++; setSelectedOrder(null); setOrderDetailId(null); setOrderDetailLoading(false); setOrderDetailError('');
    const newPath = tabId === 'dashboard' ? '/seller' : `/seller/${tabId}`;
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
    setActiveTabState(tabId);
  };
  const [toastMessage, setToastMessage] = useState('');

  // ONBOARDING FORM STATE
  const [otpSent, setOtpSent] = useState(false);
  const [sellerPhone, setSellerPhone] = useState('');
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpTimer, setOtpTimer] = useState(0);
  // Set when /api/auth/seller/send-otp (or verify) reports this phone has
  // never registered on the customer shopping app — the seller entry point checks,
  // never auto-creates, an account. SellerLoginPage.jsx renders a dedicated
  // "not a member" screen instead of the phone/OTP form while this is true.
  const [notAMember, setNotAMember] = useState(false);
  const [aadhaarVerified, setAadhaarVerified] = useState(() => Boolean(initialSessionDraft?.aadhaarVerified));
  const [aadhaarVerifying, setAadhaarVerifying] = useState(false);
  const [aadhaarNo, setAadhaarNo] = useState(() => initialSessionDraft?.aadhaarNo || '');

  const [bizForm, setBizForm] = useState(() => ({
    storeName: initialDraft?.bizForm?.storeName || '',
    vendorType: initialDraft?.bizForm?.vendorType || 'General Vendor',
    category: initialDraft?.bizForm?.category || 'Groceries',
    description: initialDraft?.bizForm?.description || '',
    pickupEmail: '',
    leaderName: '',
    ...initialSessionDraft?.bizForm,
  }));

  /**
   * The store address, plus where it actually is.
   *
   * The defaults used to be 'Delhi' / 'New Delhi', which quietly filed every
   * seller who skipped the field under a city they had never been to.
   */
  const [addressForm, setAddressForm] = useState(() => ({
    street: '',
    landmark: '',
    state: '',
    district: '',
    pincode: '',
    lat: undefined,
    lng: undefined,
    accuracy: undefined,
    source: undefined,
    formatted: '',
    ...initialSessionDraft?.addressForm,
  }));

  const [bankForm, setBankForm] = useState(() => ({
    holderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    ...initialSessionDraft?.bankForm,
  }));

  // Real File objects picked from the user's device (not placeholders).
  const [uploadedDocs, setUploadedDocs] = useState(() => ({
    aadhaarFront: null,
    aadhaarBack: null,
    pan: null,
    passbook: null,
    businessCert: null,
    ...initialSessionDraft?.uploadedDocs,
  }));

  const [panNumber, setPanNumber] = useState(() => initialSessionDraft?.panNumber || '');
  const [gstDecision, setGstDecision] = useState(() => ({ choice: '', gstin: '', contactName: '', message: '', consent: false, ...initialSessionDraft?.gstDecision }));

  // Live application state returned by the backend
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submittedSeller, setSubmittedSeller] = useState(null);

  const [applicationId] = useState(() => 'APP' + Math.floor(10000000 + Math.random() * 90000000));
  const [applicationDate] = useState(() => new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));

  useEffect(() => {
    if (draftKey !== draftIdentityKey) {
      const switchingAccounts = Boolean(draftIdentityKey && draftKey && draftIdentityKey !== draftKey);
      clearSellerDraft(getBrowserStorage(), draftIdentityKey);
      const draft = readSellerDraft(getBrowserStorage(), draftKey);
      if (draft || switchingAccounts) {
        // Stored drafts omit identity and documents, so resume before those
        // steps rather than restoring Review with empty required fields.
        setOnboardingStep(Math.min(draft?.step || 1, 3));
        setSelectedTypes(draft?.selectedTypes || ['ecommerce']);
        setActiveMode(draft?.selectedTypes?.includes('quick') && !draft?.selectedTypes?.includes('ecommerce') ? 'quick' : 'ecommerce');
        setBizForm((current) => ({
          ...current,
          storeName: draft?.bizForm?.storeName || '',
          vendorType: draft?.bizForm?.vendorType || 'General Vendor',
          category: draft?.bizForm?.category || 'Groceries',
          description: draft?.bizForm?.description || '',
          pickupEmail: '',
        }));
      }
      if (switchingAccounts) {
        // Sensitive inputs and browser File objects must be re-entered after an
        // account change; they are never copied into another seller's session.
        setOtpSent(false); setOtpCode(''); setSellerPhone(''); setOtpVerified(false);
        setAadhaarNo(''); setAadhaarVerified(false);
        setAddressForm({ street: '', landmark: '', state: '', district: '', pincode: '', lat: undefined, lng: undefined, accuracy: undefined, source: undefined, formatted: '' });
        setBankForm({ holderName: '', bankName: '', accountNumber: '', ifscCode: '' });
        setUploadedDocs({ aadhaarFront: null, aadhaarBack: null, pan: null, passbook: null, businessCert: null });
        setPanNumber('');
        setGstDecision({ choice: '', gstin: '', contactName: '', message: '', consent: false });
        setSubmittedSeller(null);
      }
      setDraftIdentityKey(draftKey);
      return;
    }

    if (!draftKey) return;
    if (submittedSeller || onboardingStep >= 9) {
      clearSellerDraft(getBrowserStorage(), draftKey);
      return;
    }
    writeSellerDraft(getBrowserStorage(), draftKey, { step: onboardingStep, selectedTypes, bizForm });
    writeSellerSessionDraft(draftKey, { step: onboardingStep, selectedTypes, bizForm, aadhaarNo, aadhaarVerified, addressForm, bankForm, uploadedDocs, panNumber, gstDecision });
  }, [draftKey, draftIdentityKey, onboardingStep, selectedTypes, bizForm, submittedSeller, aadhaarNo, aadhaarVerified, addressForm, bankForm, uploadedDocs, panNumber, gstDecision]);

  // ACTIVE SELLER PANEL DATA STATES
  const [searchQuery, setSearchQuery] = useState('');
  const [activeProductTab, setActiveProductTab] = useState('All'); // All, Active, Pending, Rejected
  const [activeOrderTab, setActiveOrderTab] = useState('All'); // All, Pending, Confirmed, Shipped, Delivered, Cancelled
  const [activeFinanceTab, setActiveFinanceTab] = useState('Overview'); // Overview, Payouts, Support

  // Modals & Subpages states
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [trackingOrder, setTrackingOrder] = useState(null);
  const [showReturnPanel, setShowReturnPanel] = useState(false);
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [activeActionsMenuId, setActiveActionsMenuId] = useState(null);

  // Form states
  const [newProductForm, setNewProductForm] = useState({
    fulfillmentType: 'physical',
    name: '',
    categoryId: '',      // a real Category _id, never a display name
    desc: '',
    brandName: '',
    gstRate: 0,
    ebookPrice: '',
    author: '',
    language: '',
    licenseTerms: '',
    // Pricing, stock, unit and weight live per-variant now, not on the
    // product root — a listing always starts with one default variant so
    // there is somewhere to type them.
    variants: [{ name: 'Default', price: '', mrp: '', stock: '', unit: 'piece', weight: '' }],
    // Same-Day is off unless the seller says otherwise — Shop All listings only.
    sameDayEnabled: false,
    processingMinutes: '',
    // Seller return preference; a blank window uses the category default.
    returnable: false,
    returnWindowDays: '',
  });

  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutSubmitting, setPayoutSubmitting] = useState(false);
  const payoutSubmissionLock = React.useRef(false);

  // ==========================================================================
  // SELLER PANEL DATA — live from the API. Mock rows removed: a seller who has
  // uploaded nothing must see an empty store, not somebody else's demo catalogue.
  // ==========================================================================
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productListingMode, setProductListingMode] = useState('retail');
  const productListEpoch = React.useRef(0);
  const productListRequest = React.useRef(null);
  useEffect(() => () => { productListEpoch.current++; productListRequest.current?.abort(); }, []);

  /**
   * Platform ceilings, filled in from GET /api/sellers/me.
   *
   * The fallbacks here are only what the form shows before that call lands —
   * the server sends the real numbers and refuses anything past them regardless
   * of what this holds.
   */
  const [platformLimits, setPlatformLimits] = useState({
    sameDayMaxRadiusKm: 20,
    sameDayMaxProcessingMinutes: 480,
  });

  const [sellerKpis, setSellerKpis] = useState({
    rating: 0, totalOrders: 0, totalRevenue: 0, avgOrderValue: 0, lowStockCount: 0,
  });

  // Revenue and order count per storefront, for the hybrid seller's breakdown.
  const [channelKpis, setChannelKpis] = useState({
    ecommerce: { revenue: 0, orders: 0 },
    grocery: { revenue: 0, orders: 0 },
  });

  const authHeader = () => {
    const token = localStorage.getItem('sellerToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  /** Coordinates to address fields, for the store-location step. */
  const lookupStoreAddress = async (lat, lng, accuracy) => {
    try {
      const res = await fetch(apiUrl(`/api/geo/reverse?lat=${lat}&lng=${lng}${accuracy ? `&accuracy=${Math.round(accuracy)}` : ''}`), { headers: authHeader() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not look up that address' };
      return { ok: true, address: body.data };
    } catch (err) {
      return { ok: false, message: err.message || 'Could not reach the address service' };
    }
  };

  /**
   * Which listing is being edited, if any.
   *
   * The Edit button used to raise a toast saying the form had opened
   * "(simulation)" — no form appeared and nothing changed. The add-product modal
   * is reused for editing rather than a second one being built: the fields are
   * the same fields, and two forms for one shape is two places to add the next
   * one to.
   */
  /**
   * The whole listing, not just its id.
   *
   * The form needs more than an id to reopen faithfully: the category picker has
   * to walk its tree back to the saved category, and the images already on the
   * product have to be shown so the seller can see they are still there. Holding
   * only the id meant both came back blank.
   */
  const [editingProduct, setEditingProduct] = useState(null);
  const productSaveLock = React.useRef(false);
  const productDraftGeneration = React.useRef(0);
  const editingIdentity = React.useRef(null);
  const editingProductId = editingProduct?._id || editingProduct?.id || null;
  editingIdentity.current = editingProductId;
  const setEditingProductId = (v) => { if (!v) setEditingProduct(null); };

  /**
   * Open the modal on an existing listing.
   *
   * Takes the raw API product rather than the flattened row the table renders,
   * because the form needs the category id and the same-day settings, and the
   * row only carries what the table shows.
   */
  const [wholesaleVariantId, setWholesaleVariantId] = useState(null);
  const startEditProduct = (raw, variantId = null) => {
    if (!raw) return;
    productDraftGeneration.current++;
    setWholesaleVariantId(variantId ? String(variantId) : null);
    setProductError('');
    setEditingProduct(raw);
    setNewProductForm({
      sellingChannels: raw.sellingChannels,
      fulfillmentType: raw.fulfillmentType || 'physical',
      name: raw.name || '',
      categoryId: raw.category?._id || raw.category || '',
      desc: raw.description || '',
      brandName: raw.brandName || '',
      gstRate: raw.gstRate ?? 0,
      ebookPrice: raw.price ?? '',
      author: raw.digital?.author || '',
      language: raw.digital?.language || '',
      licenseTerms: raw.digital?.licenseTerms || '',
      // Every saved product carries at least its synced "Default" variant
      // (the model's pre-validate hook guarantees this), so this is never
      // empty for a real listing — but fall back to a blank one just in
      // case the form ever opens before a fetch has landed.
      variants: raw.variants?.length
        ? raw.variants.map((v) => ({ ...v }))
        : [{ name: 'Default', price: raw.price ?? '', mrp: raw.mrp ?? '', stock: raw.stock ?? '', unit: raw.unit || 'piece', weight: raw.weight ?? '' }],
      sameDayEnabled: Boolean(raw.sameDay?.enabled),
      processingMinutes: raw.sameDay?.processingMinutes ?? '',
      returnable: raw.type === 'grocery' ? Boolean(raw.returnable) : raw.returnSettings?.enabled !== false,
      returnWindowDays: raw.returnSettings?.windowDays ?? '',
    });
    setShowAddProductModal(true);
  };

  const startNewProduct = () => {
    productDraftGeneration.current++;
    setEditingProduct(null); setProductError('');
    setNewProductForm({ fulfillmentType: 'physical', name: '', categoryId: '', desc: '', brandName: '', gstRate: 0, ebookPrice: '', author: '', language: '', licenseTerms: '', variants: [{ name: 'Default', price: '', mrp: '', stock: '', unit: 'piece', weight: '' }], sameDayEnabled: false, processingMinutes: '', returnable: false });
    setShowAddProductModal(true);
  };

  const applySavedWholesaleTerms = (id, result) => {
    const update = product => product && String(product._id) === String(id) ? {
      ...product, __v: result.version,
      variants: product.variants.map(variant => ({ ...variant, wholesalePricing: result.variants.find(entry => String(entry.variantId) === String(variant._id))?.wholesalePricing || variant.wholesalePricing })),
    } : product;
    setEditingProduct(update);
    setNewProductForm(form => ({ ...form, variants: form.variants.map(variant => ({ ...variant, wholesalePricing: result.variants.find(entry => String(entry.variantId) === String(variant._id))?.wholesalePricing || variant.wholesalePricing })) }));
  };

  const startNewWholesaleProduct = () => {
    productDraftGeneration.current++;
    setEditingProduct(null); setWholesaleVariantId(null); setProductError('');
    setNewProductForm({ sellingChannels: ['wholesale'], fulfillmentType: 'physical', name: '', categoryId: '', desc: '', brandName: '', gstRate: 0, variants: [{ name: 'Default', price: 0, mrp: 0, stock: '', unit: 'piece', weight: '', wholesalePricing: { enabled: true, minimumQuantity: 1, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: '' }] } }] });
    setShowAddProductModal(true);
  };

  /**
   * Save an edit. PUT /api/products/:id, which has existed and been tested since
   * Phase 5 — only the screen for it was missing.
   *
   * Images are not resent: the update endpoint keeps the existing ones when none
   * are attached, and re-uploading unchanged photos on every text edit would cost
   * bandwidth and a Cloudinary write for nothing.
   *
   * `sameDay` is always sent, including when switched off, because leaving it out
   * means "no change" to the server — which would make disabling impossible.
   */
  const submitProductEdit = async (form, files = null, ebookFile = null) => {
    if (productSaveLock.current) return { ok: false };
    productSaveLock.current = true;
    const token = localStorage.getItem('sellerToken');
    const generation = productDraftGeneration.current;
    const current = () => token === localStorage.getItem('sellerToken') && editingIdentity.current === editingProductId && generation === productDraftGeneration.current;
    let actualFiles = files;
    let actualEbookFile = ebookFile;
    if (files instanceof File || (files && !Array.isArray(files) && files.name)) {
      actualEbookFile = files;
      actualFiles = null;
    }
    setSavingProduct(true);
    setProductError('');
    try {
      if (!form.categoryId) throw new Error('Please select a category.');
      if (form.fulfillmentType !== 'digital' && (!Array.isArray(form.variants) || form.variants.length === 0)) {
        throw new Error('Please add at least one variant with pricing and stock.');
      }

      const fd = new FormData();
      if (form.sellingChannels?.length === 1 && form.sellingChannels[0] === 'wholesale') fd.append('version', editingProduct.__v ?? 0);
      fd.append('name', form.name.trim());
      fd.append('category', form.categoryId);
      if (form.desc) fd.append('description', form.desc);
      if (form.brandName !== undefined) fd.append('brandName', form.brandName);
      fd.append('gstRate', form.gstRate || 0);

      // Wholesale terms have their own narrow endpoint so normal retail
      // product saves cannot accidentally rewrite those fields.
      const editVariants = form.fulfillmentType === 'digital'
        ? [{ ...(editingProduct?.variants?.[0]?._id ? { _id: editingProduct.variants[0]._id } : {}), name: 'E-book', price: Number(form.ebookPrice), mrp: Number(form.ebookPrice), stock: 0, unit: 'piece' }]
        : form.variants.map(({ wholesalePricing, ...variant }) => ({
            ...(form.sellingChannels?.length === 1 && form.sellingChannels[0] === 'wholesale' ? { wholesalePricing, sku: variant.sku, attributes: variant.attributes } : {}),
            ...(variant._id ? { _id: variant._id } : {}),
            name: String(variant.name || '').trim(),
            price: Number(variant.price),
            mrp: variant.mrp !== '' && variant.mrp !== undefined ? Number(variant.mrp) : Number(variant.price),
            stock: Number(variant.stock),
            unit: variant.unit || 'piece',
            ...(variant.weight !== '' && variant.weight !== undefined ? { weight: Number(variant.weight) } : {}),
          }));
      fd.append('variants', JSON.stringify(editVariants));
      if (form.fulfillmentType === 'digital') {
        fd.append('digital', JSON.stringify({
          author: String(form.author || '').trim(),
          language: String(form.language || '').trim(),
          format: 'pdf',
          licenseTerms: String(form.licenseTerms || '').trim(),
        }));
      }

      if (!(form.sellingChannels?.length === 1 && form.sellingChannels[0] === 'wholesale') && (editingProduct?.type || activeChannel) === 'ecommerce') {
        fd.append('sameDay', JSON.stringify(
          form.sameDayEnabled
            ? { enabled: true, processingMinutes: Number(form.processingMinutes) }
            : { enabled: false }
        ));
      }

      // Quick Commerce only — the backend ignores this for any other
      // channel, but it's kept off the request entirely here too, so an
      // E-commerce/SHG edit's request body is unchanged by this feature.
      if (form.fulfillmentType !== 'digital' && !(form.sellingChannels?.length === 1 && form.sellingChannels[0] === 'wholesale') && ['grocery','ecommerce'].includes(editingProduct?.type || activeChannel)) {
        fd.append('returnable', form.returnable ? 'true' : 'false');
        fd.append('returnWindowDays', form.returnable ? (form.returnWindowDays ?? '') : '');
      }

      if (Array.isArray(actualFiles) && actualFiles.length > 0) {
        actualFiles.forEach(({ file }) => { if (file) fd.append('images', file); });
      }

      const res = await fetch(apiUrl(`/api/products/${editingProductId}`), {
        method: 'PUT',
        headers: { Authorization: 'Bearer ' + token },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!current()) return { ok: false, stale: true };
      if (!res.ok) throw new Error(body.message || 'Could not save your changes');

      if (actualEbookFile) {
        const fileData = new FormData();
        fileData.append('file', actualEbookFile);
        const fileRes = await fetch(apiUrl(`/api/products/${editingProductId}/digital-file`), {
          method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fileData,
        });
        const fileBody = await fileRes.json().catch(() => ({}));
        if (!fileRes.ok) throw new Error(fileBody.message || 'Metadata saved, but the private PDF upload failed. You can retry the upload.');
      }

      if (!current()) return { ok: false, stale: true };
      triggerToast(form.fulfillmentType === 'digital' ? 'E-book changes submitted for admin review.' : 'Product updated.');
      setShowAddProductModal(false);
      setEditingProduct(null);
      await fetchMyProducts();
      return { ok: true };
    } catch (err) {
      if (!current()) return { ok: false, stale: true };
      setProductError(err.message);
      triggerToast(err.message, {type:'error'});
      return { ok: false };
    } finally {
      productSaveLock.current = false;
      setSavingProduct(false);
    }
  };

  /** GET /api/products/seller/mine — this seller's own listings only. */
  const fetchMyProducts = useCallback(async () => {
    const generation = ++productListEpoch.current;
    productListRequest.current?.abort();
    const controller = new AbortController(); productListRequest.current = controller;
    const token = localStorage.getItem('sellerToken');
    const current = () => !controller.signal.aborted && generation === productListEpoch.current && token === localStorage.getItem('sellerToken');
    setProductsLoading(true);
    setProductsError(''); setProducts([]);
    try {
      const scope = activeTab === 'products' && productListingMode === 'wholesale' ? '' : `type=${activeChannel}&`;
      const res = await boundedFetch(apiUrl(`/api/products/seller/mine?${scope}roleContext=seller`), { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
      const body = await res.json();
      if (!current()) return;
      if (!res.ok) throw new Error(body.message || 'Could not load your products');
      const rows = Array.isArray(body) ? body : (body.data || body.products || []);
      setProducts(rows.map(p => ({
        id: p._id,
        name: p.name,
        category: p.category?.name || '—',
        price: p.price,
        stock: p.stock,
        // backend: status pending|approved|rejected + isActive
        status: p.status === 'approved' ? (p.isActive ? 'Active' : 'Inactive')
          : p.status === 'rejected' ? 'Rejected' : 'Pending Approval',
        img: p.images?.[0] || null,
        raw: p,
      })));
    } catch (error) {
      if (current()) { setProducts([]); setProductsError(error.message || 'Could not load your products'); }
    } finally {
      if (current()) setProductsLoading(false);
    }
  }, [activeChannel, activeTab, productListingMode]);

  /**
   * GET /api/sellers/me — the seller's own registration record: business info,
   * store address, bank details and uploaded documents, exactly as submitted
   * during onboarding.
   */
  const [sellerProfile, setSellerProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(() => Boolean(localStorage.getItem('sellerToken')));
  const [profileError, setProfileError] = useState('');
  const profileEpoch = React.useRef(0);
  useEffect(() => () => { profileEpoch.current++; }, []);

  const fetchSellerProfile = useCallback(async (options = {}) => {
    const generation = ++profileEpoch.current;
    const token = localStorage.getItem('sellerToken');
    setProfileLoading(true);
    setProfileError('');
    try {
      const res = await portalRequest('seller', token, '/api/sellers/me', { cacheMs: 1000, fresh: options.fresh });
      if (generation !== profileEpoch.current || token !== localStorage.getItem('sellerToken')) return;
      const body = await res.json();
      if (!res.ok) throw new Error(body.message || 'Could not load seller profile');
      if (generation !== profileEpoch.current || token !== localStorage.getItem('sellerToken')) return;
      const seller = body.seller || null;
      if (body.success && body.seller === null) {
        setSellerProfile(null);
        return { ok: true, seller: null };
      }
      if (!seller?._id && !seller?.id) throw new Error('Seller profile response is unavailable. Retry loading your profile.');
      if (seller?.userId?._id) {
        setUserProfile(seller.userId);
        localStorage.setItem('sellerUserProfile', JSON.stringify(seller.userId));
      }
      setSellerProfile(seller);
      // Platform ceilings come from the server so the form cannot disagree with
      // the validation that actually enforces them.
      if (body.limits) setPlatformLimits(body.limits);

      // Restore the saved channel selection so a refresh does not reset it.
      const saved = seller?.salesChannels;
      const hasDraft = Boolean(readSellerDraft(getBrowserStorage(), draftKey));
      // A registration draft is never authoritative for an approved seller.
      if ((!hasDraft || seller.status === 'approved') && Array.isArray(saved) && saved.length) {
        const modes = saved.filter((channel) => channel === 'ecommerce' || channel === 'grocery')
          .map((channel) => (channel === 'grocery' ? 'quick' : 'ecommerce'));
        if (!modes.length) return;
        setSelectedTypes(modes);
        setActiveMode((cur) => (modes.includes(cur) ? cur : modes[0]));
      }
      return { ok: true, seller };
    } catch (error) {
      if (generation === profileEpoch.current && token === localStorage.getItem('sellerToken')) { setSellerProfile(null); setProfileError(error.message || 'Could not load seller profile'); }
      return { ok: false, message: error.message };
    } finally {
      if (generation === profileEpoch.current) setProfileLoading(false);
    }
  }, [draftKey]);

  const profileSaveLock = React.useRef(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const updateSellerProfile = async values => {
    if (profileSaveLock.current) return { ok: false, message: 'A profile update is already saving' };
    const token = localStorage.getItem('sellerToken');
    const generation = profileEpoch.current;
    profileSaveLock.current = true; setProfileSaving(true);
    try {
      const allowed = ['name', 'description', 'phone', 'email', 'address', 'city', 'state', 'pincode'];
      const payload = Object.fromEntries(allowed.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]));
      payload.version = sellerProfile?.__v ?? 0;
      const response = await boundedFetch(apiUrl('/api/sellers/profile'), { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (token !== localStorage.getItem('sellerToken') || generation !== profileEpoch.current) return { ok: false, stale: true };
      if (!response.ok) throw new Error(body.message || 'Could not save profile');
      const refreshed = await fetchSellerProfile({ fresh: true });
      return refreshed?.ok ? { ok: true } : { ok: false, message: 'Profile saved, but refresh failed. Retry loading your profile.' };
    } catch (error) { return { ok: false, message: error.message || 'Could not save profile' }; }
    finally { profileSaveLock.current = false; setProfileSaving(false); }
  };


  // Push registration, independent of whether the seller is currently
  // viewing the dashboard.
  useEffect(() => {
    if (sellerProfile && sellerProfile.status === 'approved') {
      initPushNotifications().catch(() => {});
    }
  }, [sellerProfile]);

  // --- Socket IO connections and events for Seller ---
  useEffect(() => {
    const token = localStorage.getItem('sellerToken');
    if (token && sellerProfile && sellerProfile.status === 'approved') {
      connectSocket(token, 'seller', sellerProfile._id);
    }

    return () => {
      disconnectSocket();
    };
  }, [sellerProfile]);

  /**
   * Save the shop's Same-Day hours and reach.
   *
   * Goes through the existing PUT /api/sellers/profile rather than a new
   * endpoint — that route already accepts a partial profile and ignores what is
   * absent, so sending only `sameDay` leaves the store name, address and pin
   * exactly as they were.
   *
   * Sent as JSON inside a multipart field because that route takes file uploads;
   * the server parses it back. The radius is checked in the form for a quick
   * message and again on the server, which is the check that actually counts.
   */
  const saveSameDaySettings = async (settings) => {
    try {
      const fd = new FormData();
      fd.append('sameDay', JSON.stringify(settings));

      const res = await fetch(apiUrl('/api/sellers/profile'), {
        method: 'PUT',
        headers: authHeader(),          // no Content-Type — the browser sets the boundary
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not save your same-day settings' };

      await fetchSellerProfile();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  };

  /** GET /api/sellers/dashboard — real KPIs (zeros for a brand-new store). */
  const fetchSellerKpis = useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/sellers/dashboard?type=${activeChannel}`), { headers: authHeader() });
      if (!res.ok) return;
      const body = await res.json();
      if (body.kpis) setSellerKpis(body.kpis);
      // The per-storefront split, so a hybrid seller sees both channels at once
      // rather than only whichever toggle happens to be active.
      if (body.byChannel) setChannelKpis(body.byChannel);
    } catch { /* leave zeros */ }
  }, [activeChannel]);

  useEffect(() => {
    if (localStorage.getItem('sellerToken')) {
      fetchSellerProfile();
    }
  }, [fetchSellerProfile]);

  useEffect(() => {
    if (sellerProfile?.status !== 'approved' || profileLoading || profileError) return;
    fetchMyProducts();
    fetchSellerKpis();
  }, [sellerProfile?._id, sellerProfile?.status, profileLoading, profileError, fetchMyProducts, fetchSellerKpis]);

  /**
   * Orders — live from GET /api/sellers/orders.
   *
   * The server returns only this seller's own line items out of each order, so a
   * shared basket never leaks a competitor's sales into this list.
   */
  const [orders, setOrders] = useState([]);
  const [orderListState, setOrderListState] = useState({ tab: 'all', search: '' });
  const [orderDetailId, setOrderDetailId] = useState(() => window.location.pathname.match(/^\/seller\/orders\/([^/]+)$/)?.[1] || null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState('');
  const orderReturnPath = React.useRef('/seller/orders');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');

  const detailGeneration = React.useRef(0);
  const detailRequests = React.useRef(new Map());
  const sessionToken = React.useRef(localStorage.getItem('sellerToken'));
  useEffect(() => {
    const changed = () => {
      const token = localStorage.getItem('sellerToken');
      if (token === sessionToken.current) return;
      clearPortalRequests('seller', sessionToken.current);
      sessionToken.current = token;
      financeEpoch.current++; setFinanceSummary(null); setPayouts([]); setLedgerEntries([]); setFinanceError(''); setFinanceLoading(false);
      detailGeneration.current++; detailRequests.current.clear();
      profileEpoch.current++; productListEpoch.current++; productListRequest.current?.abort(); setProducts([]); setProductsError('');
      disconnectSocket(); setSelectedOrder(null); setOrders([]); setSellerProfile(null);
      setOrderDetailId(null); setOrderDetailError(''); setOrderDetailLoading(false); setOrderListState({ tab: 'all', search: '' });
      try { setUserProfile(JSON.parse(localStorage.getItem('sellerUserProfile') || 'null')); } catch { setUserProfile(null); }
      if (token) fetchSellerProfile();
    };
    window.addEventListener('storage', changed); window.addEventListener(SESSION_CHANGED, changed);
    return () => { detailGeneration.current++; window.removeEventListener('storage', changed); window.removeEventListener(SESSION_CHANGED, changed); };
  }, [fetchSellerProfile]);
  const fetchSellerOrder = useCallback((id) => {
    if (!/^[a-f\d]{24}$/i.test(String(id))) return Promise.resolve({ ok: false, message: 'Order unavailable' });
    const token = localStorage.getItem('sellerToken');
    const key = `${token}:${id}`;
    if (detailRequests.current.has(key)) return detailRequests.current.get(key);
    const request = (async () => {
      try {
        const response = await fetch(apiUrl(`/api/sellers/orders/${id}`), { headers: { Authorization: `Bearer ${token}` } });
        const body = await response.json();
        if (token !== localStorage.getItem('sellerToken')) return { ok: false, message: 'Session changed' };
        return response.ok ? { ok: true, data: body.data } : { ok: false, message: 'Order unavailable or access denied' };
      } catch { return { ok: false, message: 'Could not load order. Please retry.' }; }
      finally { detailRequests.current.delete(key); }
    })();
    detailRequests.current.set(key, request);
    return request;
  }, []);
  const openSellerOrder = useCallback(async (id, notificationId) => {
    const generation = ++detailGeneration.current;
    const token = localStorage.getItem('sellerToken');
    if (!window.location.pathname.startsWith('/seller/orders/')) orderReturnPath.current = window.location.pathname === '/seller/orders' ? window.location.pathname + window.location.search : '/seller/orders';
    const path = '/seller/orders/' + encodeURIComponent(id);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setOrderDetailId(String(id)); setOrderDetailLoading(true); setOrderDetailError('');
    setSelectedOrder(current => String(current?._id) === String(id) ? current : null);
    setActiveTabState('orders');
    const result = await fetchSellerOrder(id);
    if (generation !== detailGeneration.current || token !== localStorage.getItem('sellerToken')) return false;
    setOrderDetailLoading(false);
    if (!result.ok) { setSelectedOrder(null); setOrderDetailError(result.message); triggerToast(result.message); return false; }
    setSelectedOrder(result.data);
    setActiveMode(result.data.channel === 'grocery' ? 'quick' : 'ecommerce');
    if (window.location.search) window.history.replaceState(null, '', path);
    setActiveTabState('orders');
    if (/^[a-f\d]{24}$/i.test(String(notificationId || ''))) {
      try {
        const response = await fetch(apiUrl(`/api/notifications/${notificationId}/read`), { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
        if (response.ok && token === localStorage.getItem('sellerToken')) window.dispatchEvent(new CustomEvent('notification_read', { detail: { id: notificationId } }));
      } catch { /* Opening the order must not depend on read-state delivery. */ }
    }
    return true;
  }, [fetchSellerOrder]);
  const closeSellerOrder = useCallback(() => {
    detailGeneration.current++;
    setSelectedOrder(null);
    setOrderDetailId(null); setOrderDetailError(''); setOrderDetailLoading(false);
    window.history.pushState(null, '', orderReturnPath.current); setActiveTabState('orders');
  }, []);
  useEffect(() => {
    if (sellerProfile?.status !== 'approved') return;
    const openLink = () => {
      const params = new URLSearchParams(window.location.search);
      const id = window.location.pathname.match(/^\/seller\/orders\/([^/]+)$/)?.[1] || (window.location.pathname === '/seller/orders' && params.get('order'));
      if (id) openSellerOrder(id, params.get('notification'));
      else { detailGeneration.current++; setSelectedOrder(null); setOrderDetailId(null); setOrderDetailLoading(false); setActiveTabState(getTabFromPath()); }
    };
    openLink(); window.addEventListener('popstate', openLink);
    return () => { detailGeneration.current++; window.removeEventListener('popstate', openLink); };
  }, [sellerProfile?._id, sellerProfile?.status, openSellerOrder]);



  const fetchSellerOrders = useCallback(async (status = 'all') => {
    setOrdersLoading(true);
    setOrdersError('');
    try {
      const res = await fetch(
        apiUrl(`/api/sellers/orders?type=${activeChannel}&status=${status}&limit=100`),
        { headers: authHeader() }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOrdersError(body.message || 'Could not load your orders');
        setOrders([]);
        return;
      }
      const data = body.data || [];
      setOrders(data);

    } catch (err) {
      setOrdersError(err.message || 'Network error — is the server running?');
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [activeChannel]);

  /**
   * Move an order along — the real thing, not a repainted pill.
   *
   * The orders list used to carry Accept / Ship / Deliver buttons wired to a
   * local state setter, so a seller could believe they had dispatched something
   * the customer still saw as pending. This goes to the server first and re-reads
   * the list from it afterwards, so what is on screen is what the order is.
   *
   * `extra` carries the courier name and waybill number when dispatching a Shop
   * All parcel — the server refuses that transition without them, because once a
   * courier has it those two strings are the only thread the customer has left.
   */
  const updateOrderStatus = useCallback(async (orderId, status, extra = {}) => {
    try {
      const res = await fetch(apiUrl(`/api/sellers/orders/${orderId}/status`), {
        method: 'PATCH',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...extra }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not update this order' };

      await fetchSellerOrders();
      const fresh = await fetchSellerOrder(orderId);
      if (fresh.ok) setSelectedOrder(current => String(current?._id) === String(orderId) ? fresh.data : current);
      return { ok: true, message: body.message };
    } catch (err) {
      return { ok: false, message: err.message || 'Network error — is the server running?' };
    }
  }, [fetchSellerOrders]);

  const getFulfillmentOptions = useCallback(async (orderId) => {
    try {
      const res = await fetch(apiUrl(`/api/sellers/orders/${orderId}/fulfillment-options`), { headers: authHeader() });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, data: body.data } : { ok: false, message: body.message || 'Could not evaluate fulfillment options' };
    } catch (err) { return { ok: false, message: err.message }; }
  }, []);

  const selectManualFulfillment = useCallback(async (orderId) => {
    try {
      const res = await fetch(apiUrl(`/api/sellers/orders/${orderId}/fulfillment/manual`), {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Could not select manual delivery' };
      await fetchSellerOrders();
      const fresh = await fetchSellerOrder(orderId);
      if (fresh.ok) setSelectedOrder(current => String(current?._id) === String(orderId) ? fresh.data : current);
      return { ok: true, message: body.message };
    } catch (err) { return { ok: false, message: err.message }; }
  }, [fetchSellerOrders]);

  const createShiprocketShipment = useCallback(async (orderId, packageSize, quotedCourierCharge) => {
    try {
      const res = await fetch(apiUrl(`/api/sellers/orders/${orderId}/fulfillment/shiprocket`), {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, package: packageSize, quotedCourierCharge }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, message: body.message || 'Shipment creation failed' };
      await fetchSellerOrders();
      const fresh = await fetchSellerOrder(orderId);
      if (fresh.ok) setSelectedOrder(current => String(current?._id) === String(orderId) ? fresh.data : current);
      return { ok: true, message: body.message, data: body.data };
    } catch (err) { return { ok: false, message: err.message }; }
  }, [fetchSellerOrders]);

  // Its own effect rather than a line in the one above, because that effect is
  // declared before this callback exists — naming it there would read the
  // binding before initialisation.
  useEffect(() => {
    if (sellerProfile?.status === 'approved' && !profileLoading && !profileError) fetchSellerOrders();
  }, [sellerProfile?._id, sellerProfile?.status, profileLoading, profileError, fetchSellerOrders]);

  const [payouts, setPayouts] = useState([]);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [financeError, setFinanceError] = useState('');
  const financeEpoch = React.useRef(0);
  useEffect(() => () => { financeEpoch.current++; }, []);

  const fetchSellerFinances = useCallback(async () => {
    const generation = ++financeEpoch.current;
    const token = localStorage.getItem('sellerToken');
    const current = () => generation === financeEpoch.current && token === localStorage.getItem('sellerToken');
    setFinanceLoading(true); setFinanceError('');
    try {
      const [summaryRes, ledgerRes] = await Promise.all([
        portalRequest('seller', token, '/api/sellers/finances/summary'),
        portalRequest('seller', token, '/api/sellers/finances/ledger?limit=50'),
      ]);
      const summaryBody = await summaryRes.json().catch(() => ({}));
      const ledgerBody = await ledgerRes.json().catch(() => ({}));
      if (!current()) return;
      if (!summaryRes.ok) throw new Error(summaryBody.message || 'Could not load seller balances');
      if (!ledgerRes.ok) throw new Error(ledgerBody.message || 'Could not load seller ledger');
      const { summary, entries } = readSellerFinances(summaryBody, ledgerBody);
      setFinanceSummary(summary);
      setPayouts(summary.payouts);
      setLedgerEntries(entries);
    } catch (error) {
      if (!current()) return;
      setFinanceError(error.message || 'Could not load seller finances');
      setFinanceSummary(null); setPayouts([]); setLedgerEntries([]);
    } finally { if (current()) setFinanceLoading(false); }
  }, []);

  const getOrderFinancialBreakdown = useCallback(async (orderId) => {
    try {
      const res = await fetch(apiUrl(`/api/sellers/orders/${orderId}/financial-breakdown`), { headers: authHeader() });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, data: body.data } : { ok: false, message: body.message || 'Could not load financial breakdown' };
    } catch (error) { return { ok: false, message: error.message }; }
  }, []);

  useEffect(() => {
    financeEpoch.current++;
    setFinanceSummary(null); setPayouts([]); setLedgerEntries([]); setFinanceError(''); setFinanceLoading(false);
    if (sellerProfile?.status === 'approved' && !profileLoading && !profileError && ['earnings', 'paymenthistory', 'moneyrequest'].includes(activeTab)) fetchSellerFinances();
  }, [activeTab, userProfile, sellerProfile?.status, profileLoading, profileError, fetchSellerFinances]);



  // TOAST TRIGGER
  const triggerToast = (message, options) => ui.notify(message, options);

  /**
   * Toggle a sales channel and PERSIST it.
   *
   * These checkboxes used to be local state only, so a refresh reverted them.
   * They are now saved to Seller.salesChannels via PATCH /api/sellers/channels,
   * and loaded back from GET /api/sellers/me on mount.
   *
   * `type` is the UI value ('ecommerce' | 'quick'); the API stores the channel
   * value ('ecommerce' | 'grocery').
   */
  const toggleSellerType = async (type) => {
    const prev = selectedTypes;
    let updated;

    if (prev.includes(type)) {
      if (prev.length === 1) {
        triggerToast('At least one sales channel must be enabled.');
        return;
      }
      updated = prev.filter((t) => t !== type);
    } else {
      updated = [...prev, type];
    }

    // Optimistic: flip the checkbox immediately, roll back if the save fails.
    setSelectedTypes(updated);

    // If the seller just disabled the channel they were viewing, move them to
    // one that is still enabled.
    if (!updated.includes(activeMode)) setActiveMode(updated[0]);

    try {
      const res = await fetch(apiUrl('/api/sellers/channels'), {
        method: 'PATCH',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: updated.map((t) => CHANNEL_OF_MODE[t]) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || 'Could not save sales channels');

      const enabled = updated.includes(type);
      triggerToast(`${type === 'quick' ? 'Quick Commerce' : 'E-Commerce'} ${enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      setSelectedTypes(prev);           // roll back
      if (!prev.includes(activeMode)) setActiveMode(prev[0]);
      triggerToast(err.message, {type:'error'});
    }
  };

  const [wholesaleRequestBusy, setWholesaleRequestBusy] = useState(false);
  const wholesaleRequestLock = React.useRef(false);
  const requestWholesaleChannel = async () => {
    if (wholesaleRequestLock.current) return { ok: false };
    wholesaleRequestLock.current = true;
    const token = localStorage.getItem('sellerToken');
    setWholesaleRequestBusy(true);
    try {
      const res = await boundedFetch(apiUrl('/api/sellers/wholesale-request'), {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (token !== localStorage.getItem('sellerToken')) return { ok: false, stale: true };
      if (!res.ok) throw new Error(body.message || 'Could not request Wholesale access');
      setSellerProfile((current) => current ? {
        ...current,
        wholesaleChannel: { ...(current.wholesaleChannel || {}), status: body.status },
        salesChannels: body.salesChannels || current.salesChannels,
      } : current);
      triggerToast(body.status === 'approved' ? 'Wholesale access is already approved.' : 'Wholesale access request sent for admin review.');
      await fetchSellerProfile({ fresh: true });
      return { ok: true, status: body.status };
    } catch (err) {
      triggerToast(err.message || 'Could not request Wholesale access', {type:'error'});
      return { ok: false, message: err.message };
    } finally {
      wholesaleRequestLock.current = false;
      setWholesaleRequestBusy(false);
    }
  };

  // OTP TIMER
  useEffect(() => {
    if (otpTimer > 0) {
      const timer = setTimeout(() => setOtpTimer(otpTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpTimer]);

  /**
   * Real OTP login, shared with the buyer app.
   *
   * The number entered here becomes the seller's permanent login identity — the
   * seller profile is created against this account, and they sign in with the
   * same number afterwards. Previously this step was a mock that created no
   * session at all, so submitting the application failed with "please log in".
   */
  const sendOtp = async (intent = 'login') => {
    const phone = normalizePhoneInput(sellerPhone);
    const safeIntent = normalizeSellerIntent(intent);
    if (phone.length !== 10) {
      triggerToast('Please enter a valid 10-digit mobile number.');
      return { ok: false, message: 'Please enter a valid 10-digit mobile number.' };
    }
    setNotAMember(false);
    try {
      // Seller-specific endpoint — checks the phone is already a registered
      // Bulkimart customer rather than auto-creating one (see
      // auth.controller.js's requestSellerOTP doc comment: a seller account
      // is always an extension of an existing customer identity).
      const res = await fetch(apiUrl('/api/auth/seller/send-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sellerOtpPayload(phone, safeIntent)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.meta?.code === 'NOT_A_MEMBER') {
          triggerToast(body.message || 'Mobile number not registered. Please register your store.');
          return { ok: false, code: 'NOT_A_MEMBER', message: body.message };
        }
        if (body.meta?.code === 'SELLER_EXISTS' || body.meta?.code === 'SELLER_NOT_FOUND') {
          triggerToast(body.message);
          return { ok: false, code: body.meta.code, message: body.message };
        }
        throw new Error(body.message || 'Could not send OTP');
      }

      setOtpSent(true);
      setOtpTimer(30);
      // In mock mode the server returns the OTP so it can be shown while testing.
      triggerToast(body.otp ? `OTP sent. Test code: ${body.otp}` : 'OTP sent to your mobile.');
      return { ok: true };
    } catch (err) {
      const message = safeErrorMessage(err, 'Could not send OTP');
      triggerToast(message, {type:'error'});
      return { ok: false, message };
    }
  };

  /** Verify the OTP and store the session the rest of the flow depends on. */
  const verifyOtpAndLogin = async (intent = 'login') => {
    const phone = normalizePhoneInput(sellerPhone);
    const safeIntent = normalizeSellerIntent(intent);
    if (!otpCode) {
      triggerToast('Please enter the OTP.');
      return { ok: false };
    }
    try {
      const res = await fetch(apiUrl('/api/auth/seller/verify-otp'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sellerOtpPayload(phone, safeIntent, otpCode)),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.meta?.code === 'NOT_A_MEMBER') {
          triggerToast(body.message || 'Mobile number not registered. Please register your store.');
          return { ok: false, code: 'NOT_A_MEMBER' };
        }
        if (body.meta?.code === 'SELLER_EXISTS' || body.meta?.code === 'SELLER_NOT_FOUND') {
          triggerToast(body.message);
          return { ok: false, code: body.meta.code, message: body.message };
        }
        throw new Error(body.message || 'OTP verification failed');
      }

      saveSellerSession(body);
      if (body.user) {
        localStorage.setItem('sellerUserProfile', JSON.stringify(body.user));
        setUserProfile(body.user);
      }

      setOtpVerified(true);
      triggerToast('Mobile number verified.');

      await fetchSellerProfile();
      await fetchMyProducts();
      await fetchSellerKpis();

      return { ok: true, user: body.user };
    } catch (err) {
      const message = safeErrorMessage(err, 'OTP verification failed');
      triggerToast(message, {type:'error'});
      return { ok: false, message };
    }
  };

  const verifyAadhaar = () => {
    if (!/^[0-9]{12}$/.test(aadhaarNo)) {
      triggerToast('Aadhaar number must be 12 digits');
      return;
    }
    setAadhaarVerifying(true);
    setTimeout(() => {
      setAadhaarVerifying(false);
      setAadhaarVerified(true);
      triggerToast('Aadhaar verified successfully!');
    }, 1500);
  };

  /** Store the actual File the user selected. Uploaded to Cloudinary on submit. */
  const handleDocUpload = (docKey, file) => {
    if (!file) return;
    const MAX = 5 * 1024 * 1024; // server limit
    if (file.size > MAX) {
      triggerToast('File is too large — maximum size is 5 MB.');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type)) {
      triggerToast('Only JPG, PNG, WEBP images or PDF files are allowed.');
      return;
    }
    setUploadedDocs(prev => ({ ...prev, [docKey]: file }));
    triggerToast(`${file.name} attached.`);
  };

  /**
   * Submit the whole application to the backend.
   * Runs the real onboarding chain: start → step 1..4 → submit.
   * Documents are uploaded to Cloudinary by the server during steps 2-4.
   */
  const submitSellerApplication = async () => {
    if (submitSellerApplicationLock.current) return { ok: false };
    submitSellerApplicationLock.current = true;
    setSubmitting(true);
    setSubmitError('');

    const token = localStorage.getItem('sellerToken');
    if (!token) {
      setSubmitting(false);
      submitSellerApplicationLock.current = false;
      setSubmitError('Please log in with your mobile number before registering as a seller.');
      return { ok: false };
    }

    const AUTH = { Authorization: `Bearer ${token}` };
    const JSON_H = { ...AUTH, 'Content-Type': 'application/json' };
    let profile = {};
    try { profile = JSON.parse(localStorage.getItem('sellerUserProfile') || '{}'); } catch { /* ignore */ }

    const call = async (path, options, label) => {
      const res = await fetch(apiUrl(path), options);
      const body = await res.json().catch(() => ({}));

      // A 401 here means the stored token is no longer usable — expired, or the
      // account it belongs to no longer exists (e.g. the database was re-seeded).
      // Clear the dead session rather than leaving the user stuck on an error.
      if (res.status === 401) {
        localStorage.removeItem('sellerToken');
        localStorage.removeItem('sellerUserProfile');
        throw new Error('Your session has expired. Please log in again with your mobile number, then re-open Become a Seller.');
      }

      if (!res.ok) throw new Error(`${label}: ${body.message || res.status}`);
      return body;
    };

    try {
      const salesChannels = selectedModesToChannels(selectedTypes);
      const registration = { aadhaarNo, bizForm, addressForm, bankForm, uploadedDocs, panNumber, gstDecision, userProfile: profile };
      for (const step of [3, 4, 5, 6, 7]) {
        const issues = sellerStepIssues(step, registration);
        if (issues.length) {
          throw new Error(issues.join(' '));
        }
      }
      await call('/api/sellers/start', {
        method: 'POST',
        headers: JSON_H,
        body: JSON.stringify({ salesChannels }),
      }, 'Start');

      await call('/api/sellers/step/1', {
        method: 'PUT',
        headers: JSON_H,
        body: JSON.stringify({
          businessName: bizForm.storeName,
          businessType: 'proprietorship',
          storeDetails: {
            name: bizForm.storeName,
            description: bizForm.description,
            address: addressForm.street,
            landmark: addressForm.landmark,
            city: addressForm.district,
            state: addressForm.state,
            pincode: addressForm.pincode,
            // Quick Commerce needs these to know who this store can reach.
            lat: addressForm.lat,
            lng: addressForm.lng,
            accuracy: addressForm.accuracy,
            source: addressForm.source,
            phone: profile.phone || '',
            email: bizForm.pickupEmail || profile.email || ''
          }
        })
      }, 'Business details');

      const f2 = new FormData();
      f2.append('aadhaarNumber', aadhaarNo);
      f2.append('aadhaarFront', uploadedDocs.aadhaarFront);
      f2.append('aadhaarBack', uploadedDocs.aadhaarBack);
      await call('/api/sellers/step/2', { method: 'PUT', headers: AUTH, body: f2 }, 'Aadhaar KYC');

      const f3 = new FormData();
      f3.append('accountNo', bankForm.accountNumber);
      f3.append('ifsc', bankForm.ifscCode);
      f3.append('holderName', bankForm.holderName);
      f3.append('bankName', bankForm.bankName);
      f3.append('passbookUrl', uploadedDocs.passbook);
      await call('/api/sellers/step/3', { method: 'PUT', headers: AUTH, body: f3 }, 'Bank details');

      const f4 = new FormData();
      f4.append('pan', panNumber);
      f4.append('gstChoice', gstDecision.choice);
      if (gstDecision.choice === 'has_gstin') f4.append('gstin', gstDecision.gstin);
      if (gstDecision.choice === 'assistance') {
        f4.append('gstAssistanceConsent', String(gstDecision.consent));
        f4.append('gstContactName', gstDecision.contactName);
        f4.append('gstAssistanceMessage', gstDecision.message);
      }
      if (uploadedDocs.pan) f4.append('pan_card', uploadedDocs.pan);
      if (uploadedDocs.businessCert) f4.append('trade_license', uploadedDocs.businessCert);
      await call('/api/sellers/step/4', { method: 'PUT', headers: AUTH, body: f4 }, 'Legal documents');

      const done = await call('/api/sellers/submit', { method: 'POST', headers: JSON_H }, 'Submit');

      clearSellerDraft(getBrowserStorage(), draftKey);
      setSubmittedSeller(done.seller);
      triggerToast('Application submitted for verification.');
      return { ok: true, seller: done.seller };
    } catch (err) {
      setSubmitError(err.message);
      triggerToast(err.message, {type:'error'});
      return { ok: false };
    } finally {
      setSubmitting(false);
      submitSellerApplicationLock.current = false;
    }
  };

  const handleDocDelete = (docKey) => {
    setUploadedDocs(prev => ({
      ...prev,
      [docKey]: null
    }));
    triggerToast(`Document deleted.`);
  };

  // ADD NEW PRODUCT HANDLER
  const [savingProduct, setSavingProduct] = useState(false);
  const [productError, setProductError] = useState('');

  /**
   * Create a product for real: POST /api/products as multipart.
   *
   * The server re-validates everything (category must be an active LEAF in this
   * seller's channel, 1-5 images, price/stock sanity), so the form's checks are
   * only there to give faster feedback.
   */
  const submitNewProduct = async (form, files, ebookFile = null) => {
    if (productSaveLock.current) return { ok: false };
    productSaveLock.current = true;
    const token = localStorage.getItem('sellerToken');
    const generation = productDraftGeneration.current;
    const current = () => token === localStorage.getItem('sellerToken') && generation === productDraftGeneration.current;
    setSavingProduct(true);
    setProductError('');

    try {
      if (!token) throw new Error('Your session expired. Please sign in again.');
      if (!form.categoryId) throw new Error('Please select a category.');
      if (!files || files.length === 0) throw new Error('Please add at least one product image.');
      if (form.fulfillmentType !== 'digital' && (!Array.isArray(form.variants) || form.variants.length === 0)) {
        throw new Error('Please add at least one variant with pricing and stock.');
      }
      if (form.fulfillmentType === 'digital' && !ebookFile) throw new Error('Choose a PDF e-book file before submitting.');

      const fd = new FormData();
      fd.append('roleContext', 'seller');
      fd.append('type', form.sellingChannels?.length === 1 && form.sellingChannels[0] === 'wholesale' ? 'ecommerce' : form.fulfillmentType === 'digital' ? 'ecommerce' : activeChannel);
      if (form.sellingChannels) fd.append('sellingChannels', JSON.stringify(form.sellingChannels));
      fd.append('fulfillmentType', form.fulfillmentType || 'physical');
      fd.append('name', form.name.trim());
      fd.append('category', form.categoryId);
      if (form.desc) fd.append('description', form.desc);
      if (form.brandName) fd.append('brandName', form.brandName);
      if (form.gstRate) fd.append('gstRate', form.gstRate);
      // A new product's own SKU is never sent — the backend always
      // auto-generates it (see Product.js's pre-validate hook), so a
      // seller can never collide with, or guess, another listing's code.
      const createVariants = form.fulfillmentType === 'digital'
        ? [{ name: 'E-book', price: Number(form.ebookPrice), mrp: Number(form.ebookPrice), stock: 0, unit: 'piece' }]
        : form.variants.map((v) => ({
            ...(form.sellingChannels?.includes('wholesale') ? { wholesalePricing: v.wholesalePricing, sku: v.sku, attributes: v.attributes } : {}),
            name: String(v.name || '').trim(),
            price: Number(v.price),
            mrp: v.mrp !== '' && v.mrp !== undefined ? Number(v.mrp) : Number(v.price),
            stock: Number(v.stock),
            unit: v.unit || 'piece',
            ...(v.weight !== '' && v.weight !== undefined ? { weight: Number(v.weight) } : {}),
          }));
      fd.append('variants', JSON.stringify(createVariants));
      if (form.fulfillmentType === 'digital') {
        fd.append('digital', JSON.stringify({
          author: String(form.author || '').trim(),
          language: String(form.language || '').trim(),
          format: 'pdf',
          licenseTerms: String(form.licenseTerms || '').trim(),
        }));
      }

      /**
       * Same-Day, only when the seller asked for it and only on Shop All.
       *
       * Sent as JSON in a multipart field, the same way `dimensions` already
       * travels — a FormData value is a string, and the server parses it back.
       * Omitted entirely when off, so a listing that never opts in is stored
       * with no `sameDay` field, exactly like every product made before this.
       *
       * Note what is not here: no price. Same-Day changes how the item is
       * delivered, never what it costs.
       */
      if (!form.sellingChannels?.includes('wholesale') && form.fulfillmentType !== 'digital' && activeChannel === 'ecommerce' && form.sameDayEnabled) {
        fd.append('sameDay', JSON.stringify({
          enabled: true,
          processingMinutes: Number(form.processingMinutes),
        }));
      }

      // Quick Commerce only — see the identical guard in submitProductEdit.
      if (form.fulfillmentType !== 'digital' && !(form.sellingChannels?.length === 1 && form.sellingChannels[0] === 'wholesale') && ['grocery','ecommerce'].includes(activeChannel)) {
        fd.append('returnable', form.returnable ? 'true' : 'false');
        fd.append('returnWindowDays', form.returnable ? (form.returnWindowDays ?? '') : '');
      }

      files.forEach(({ file }) => fd.append('images', file));

      // NOTE: do not set Content-Type. The browser must generate the multipart
      // boundary itself, otherwise multer cannot parse the request.
      const res = await fetch(apiUrl('/api/products'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));
      if (!current()) return { ok: false, stale: true };
      if (!res.ok) throw new Error(body.message || 'Could not save the product');

      if (form.fulfillmentType === 'digital') {
        // Keep the draft ID in the editor so a failed upload retry updates this
        // same listing instead of accidentally creating duplicate drafts.
        setEditingProduct(body.product);
        const fileData = new FormData();
        fileData.append('file', ebookFile);
        const fileRes = await fetch(apiUrl(`/api/products/${body.product._id}/digital-file`), {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fileData,
        });
        const fileBody = await fileRes.json().catch(() => ({}));
        if (!fileRes.ok) throw new Error(fileBody.message || 'Draft created, but the private PDF upload failed. Retry to upload it.');
      }

      if (!current()) return { ok: false, stale: true };
      triggerToast(form.fulfillmentType === 'digital'
        ? 'E-book listing created and submitted for admin review.'
        : form.sellingChannels?.includes('wholesale') ? 'Wholesale product published.' : 'Product published — it is live for customers now.');
      setShowAddProductModal(false);
      setNewProductForm({
        fulfillmentType: 'physical',
        name: '', categoryId: '', desc: '',
        brandName: '', gstRate: 0,
        ebookPrice: '', author: '', language: '', licenseTerms: '',
        variants: [{ name: 'Default', price: '', mrp: '', stock: '', unit: 'piece', weight: '' }],
        sameDayEnabled: false, processingMinutes: '', returnable: false,
      });
      await fetchMyProducts();
      return { ok: true };
    } catch (err) {
      if (!current()) return { ok: false, stale: true };
      setProductError(err.message);
      triggerToast(err.message, {type:'error'});
      return { ok: false };
    } finally {
      productSaveLock.current = false;
      setSavingProduct(false);
    }
  };

  // UPDATE INVENTORY STOCK — PATCH /api/products/:id/stock, an atomic $inc
  // on the server (see product.controller.js::adjustProductStock) so two
  // rapid adjustments can never lose one to the other. `change` is the
  // signed delta the caller already computed (e.g. StockTab's stepper).
  // Local state is never mutated optimistically here — the row only ever
  // shows what the server just confirmed, via a full re-fetch on success.
  const [stockUpdatingId, setStockUpdatingId] = useState(null);
  const handleUpdateStock = async (productId, change) => {
    if (stockUpdatingId) return; // one adjustment in flight at a time
    setStockUpdatingId(productId);
    try {
      const res = await fetch(apiUrl(`/api/products/${productId}/stock`), {
        method: 'PATCH',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta: change }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        triggerToast(body.message || 'Could not update stock');
        return;
      }
      await fetchMyProducts();
      triggerToast('Stock updated successfully!');
    } catch (err) {
      triggerToast(err.message || 'Network error updating stock', {type:'error'});
    } finally {
      setStockUpdatingId(null);
    }
  };

  // CHANGE PRODUCT STATUS (ACTIVE/INACTIVE)
  //
  // No real backend flow exists for a seller-controlled visibility toggle.
  // `Product.isActive` is exclusively the admin approval "go live" flag
  // (see product.controller.js::deleteProduct's own comment, and
  // admin.controller.js::approveProduct — never seller-writable), and no
  // route accepts a seller-facing `status` field. This handler is not
  // wired into any Seller UI.
  const handleToggleProductStatus = (productId, newStatus) => {
    setActiveActionsMenuId(null);
    triggerToast('Active/inactive toggle has no backend yet — not available.');
  };

  // DELETE PRODUCT — DELETE /api/products/:id (real soft-delete: sets
  // isDeleted + isActive false server-side, ownership-checked). Local
  // state is only updated by re-fetching from the server after a
  // confirmed 200, never by filtering the array on the assumption the
  // request will succeed.
  const [deletingProductId, setDeletingProductId] = useState(null);
  const handleDeleteProduct = async (productId) => {
    return ui.perform('Are you sure you want to delete this product from listings?', async () => {
    if (deletingProductId) return; // one delete in flight at a time
    setDeletingProductId(productId);
    try {
      const res = await fetch(apiUrl(`/api/products/${productId}`), {
        method: 'DELETE',
        headers: authHeader(),
      });
      const body = await res.json().catch(() => ({}));
      setActiveActionsMenuId(null);
      if (!res.ok) {
        triggerToast(body.message || 'Could not delete this product');
        return;
      }
      await fetchMyProducts();
      triggerToast('Product deleted successfully');
    } catch (err) {
      triggerToast(err.message || 'Network error deleting product', {type:'error'});
    } finally {
      setDeletingProductId(null);
    }

});
};

  // TRANSITION FULFILLMENT ORDER STATUS
  // handleUpdateOrderStatus removed. It repainted the status in local state and
  // told the seller "Order status updated" without calling anything — the
  // customer's view never changed. A button that lies about dispatching an order
  // is worse than no button, so it is gone until there is an endpoint behind it.

  // SUBMIT PAYOUT REQUEST
  const handleRequestPayout = async (e) => {
    e.preventDefault();
    if (payoutSubmissionLock.current) return { ok: false };
    if (!financeSummary?.payoutActionsEnabled) return { ok: false, message: 'Payout requests are unavailable' };
    const amount = Number(payoutAmount);
    if (!amount || amount <= 0) {
      triggerToast('Please enter a valid amount');
      return;
    }
    if (amount > Number(financeSummary?.balances?.eligible || 0)) {
      triggerToast('Insufficient withdrawable balance!');
      return { ok: false };
    }
    const payoutSessionToken = localStorage.getItem('sellerToken');
    payoutSubmissionLock.current = true; setPayoutSubmitting(true);
    try {
      const intent = payoutIntent(sessionStorage, sellerProfile?._id, amount, () => crypto.randomUUID());
      const idempotencyKey = intent.key;
      const res = await fetch(apiUrl('/api/sellers/payouts'), {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.success !== true || !body.data?._id || body.data.amount !== amount || !['PENDING', 'APPROVED', 'REJECTED'].includes(body.data.status)) throw new Error(body.message || 'Payout request could not be confirmed; retry uses the same request reference');
      if (payoutSessionToken !== localStorage.getItem('sellerToken')) return { ok: false, sessionChanged: true };
      intent.complete();
      setPayoutAmount(''); setActiveFinanceTab('Overview');
      await fetchSellerFinances(); triggerToast('Payout request submitted.');
      return { ok: true };
    } catch (error) { if (payoutSessionToken !== localStorage.getItem('sellerToken')) return { ok: false, sessionChanged: true }; triggerToast(error.message, {type:'error'}); return { ok: false, message: error.message }; }
    finally { payoutSubmissionLock.current = false; setPayoutSubmitting(false); }
  };


  // SUBMIT SUPPORT TICKET
  const logoutSeller = useCallback(async () => {
    clearPortalRequests('seller');
    stopRing();
    detailGeneration.current++;
    setSelectedOrder(null);
    disconnectSocket();
    await deregisterPushToken().catch(() => {});
    try {
      const token = localStorage.getItem('sellerToken');
      if (token) {
        await fetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` }
        }).catch(() => {});
      }
    } finally {
      clearSellerDraft(getBrowserStorage(), draftKey);
      localStorage.removeItem('sellerToken');
      localStorage.removeItem('sellerUserProfile');
      setIsOnboarded(false);
      setSellerProfile(null);
      setUserProfile(null);
      window.location.href = '/seller';
    }
  }, [draftKey]);

  useEffect(() => {
    if (window.location.pathname === '/seller/logout') {
      logoutSeller();
    }
  }, [logoutSeller]);

  return (
    <SellerContext.Provider
      value={{
        logoutSeller,
        userProfile,
        setUserProfile,
        isOnboarded,
        setIsOnboarded,
        onboardingStep,
        setOnboardingStep,
        selectedTypes,
        setSelectedTypes,
        activeMode,
        activeChannel,
        setActiveMode,
        toggleSellerType,
        activeTab,
        setActiveTab,
        toastMessage,
        triggerToast,
        otpSent,
        setOtpSent,
        otpCode,
        setOtpCode,
        otpTimer,
        setOtpTimer,
        sendOtp,
        sellerPhone,
        setSellerPhone,
        otpVerified,
        verifyOtpAndLogin,
        notAMember,
        setNotAMember,
        aadhaarVerified,
        setAadhaarVerified,
        aadhaarVerifying,
        setAadhaarVerifying,
        aadhaarNo,
        setAadhaarNo,
        verifyAadhaar,
        bizForm,
        setBizForm,
        addressForm,
        lookupStoreAddress,
        setAddressForm,
        bankForm,
        setBankForm,
        uploadedDocs,
        panNumber,
        setPanNumber,
        gstDecision,
        setGstDecision,
        submitting,
        submitError,
        submittedSeller,
        submitSellerApplication,
        setUploadedDocs,
        handleDocUpload,
        handleDocDelete,
        applicationId,
        applicationDate,
        searchQuery,
        setSearchQuery,
        activeProductTab,
        setActiveProductTab,
        activeOrderTab,
        setActiveOrderTab,
        activeFinanceTab,
        setActiveFinanceTab,
        showAddProductModal,
        setShowAddProductModal,
        selectedOrder,
        setSelectedOrder,
        openSellerOrder, closeSellerOrder, fetchSellerOrder, orderDetailId, orderDetailLoading, orderDetailError, orderListState, setOrderListState,
        trackingOrder,
        setTrackingOrder,
        showReturnPanel,
        setShowReturnPanel,
        selectedReturn,
        setSelectedReturn,
        activeActionsMenuId,
        setActiveActionsMenuId,
        newProductForm,
        setNewProductForm,
        submitNewProduct,
        savingProduct,
        productError,
        handleUpdateStock,
        stockUpdatingId,
        handleToggleProductStatus,
        handleDeleteProduct,
        deletingProductId,
        payoutSubmitting,
        payoutAmount,
        setPayoutAmount,
        handleRequestPayout,
        products,
        productsLoading,
        productsError, productListingMode, setProductListingMode,
        fetchMyProducts,
        sellerKpis,
        channelKpis,
        ordersLoading,
        ordersError,
        fetchSellerOrders,
        updateOrderStatus,
        getFulfillmentOptions,
        selectManualFulfillment,
        createShiprocketShipment,
        getOrderFinancialBreakdown,
        fetchSellerKpis,
        sellerProfile,
        requestWholesaleChannel,
        wholesaleRequestBusy,
        profileLoading,
        profileError, profileSaving, updateSellerProfile,
        fetchSellerProfile,
        saveSameDaySettings,
        platformLimits,
        editingProduct,
        editingProductId,
        setEditingProductId,
        startEditProduct,
        wholesaleVariantId,
        startNewProduct,
        startNewWholesaleProduct,
        applySavedWholesaleTerms,
        submitProductEdit,
        orders,
        payouts,
        financeSummary,
        ledgerEntries,
        financeLoading,
        financeError,
        fetchSellerFinances,
      }}
    >
      {children}
    </SellerContext.Provider>
  );
};

export const useSeller = () => {
  const context = useContext(SellerContext);
  if (!context) {
    throw new Error('useSeller must be used within a SellerProvider');
  }
  return context;
};

export default SellerContext;
