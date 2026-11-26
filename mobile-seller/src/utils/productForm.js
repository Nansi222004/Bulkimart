// Physical retail product form, ported from ProductModal.jsx + SellerContext.submitNewProduct/submitProductEdit.
// The server re-validates everything; these checks only give faster feedback.
// Not covered here: e-books (fulfillmentType 'digital') and Wholesale-only listings. Both stay on the web panel.

export const GST_RATES = [0, 5, 12, 18, 28];
export const UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'dozen', 'pack'];
export const MAX_PRODUCT_IMAGES = 5; // 1 cover + 4 more (Product.images cap)

// The backend dashboard counts stock below LOW_STOCK_THRESHOLD (backend/constants/enums.js = 20) as low.
// The app uses the same rule so the counts and the row badges agree.
export const LOW_STOCK_THRESHOLD = 20;
export const stockHealth = (stock) => (stock === 0 ? 'out' : stock > 0 && stock < LOW_STOCK_THRESHOLD ? 'low' : 'ok');

export const isDigital = (raw) => raw?.fulfillmentType === 'digital';
export const isWholesaleOnly = (raw) => Array.isArray(raw?.sellingChannels) && raw.sellingChannels.length === 1 && raw.sellingChannels[0] === 'wholesale';

// Same labels as fetchMyProducts in SellerContext.
export const productStatus = (p) => (p.isDraft ? 'Draft' : p.status === 'approved' ? (p.isActive ? 'Active' : 'Inactive')
  : p.status === 'rejected' ? 'Rejected' : 'Pending Approval');

// Easy Returns (backend services/easyReturns.service.js): No Easy Returns = normal price; Easy Returns = normal price + extra charge.
// It sits inside "Allow Returns": the server uses that return window, and the policy text has a default.
export const defaultEasyReturnsPolicy = (days) => `Return for any reason within ${days} day${days === 1 ? '' : 's'} of delivery. Without Easy Returns, only a wrong, damaged or defective item can be returned.`;
const easyDefaults = { easyReturnsEnabled: false, easyReturnsExtraCharge: '', easyReturnsPolicyText: '', easyReturnsConditions: '' };
const easyFromProduct = (raw) => {
  const cfg = raw?.easyReturns;
  if (!cfg?.enabled) return { ...easyDefaults };
  return {
    easyReturnsEnabled: true,
    easyReturnsExtraCharge: cfg.extraCharge ?? '',
    // A default sentence is left empty so it follows future window changes.
    easyReturnsPolicyText: cfg.policyText && cfg.policyText !== defaultEasyReturnsPolicy(cfg.windowDays) ? cfg.policyText : '',
    easyReturnsConditions: (cfg.conditions || []).join('\n'),
  };
};
const easyConditions = (form) => String(form.easyReturnsConditions || '').split('\n').map((c) => c.trim()).filter(Boolean);
export const easyReturnsPayload = (form) => JSON.stringify(form.easyReturnsEnabled && form.returnable ? {
  enabled: true, extraCharge: Number(form.easyReturnsExtraCharge),
  policyText: String(form.easyReturnsPolicyText || '').trim(), conditions: easyConditions(form),
} : { enabled: false });
export function validateEasyReturns(form) {
  if (!form.easyReturnsEnabled || !form.returnable) return [];
  const errors = [];
  const charge = Number(form.easyReturnsExtraCharge);
  if (blank(form.easyReturnsExtraCharge) || !Number.isFinite(charge) || charge < 0) errors.push('Enter the Easy Returns extra charge (0 or more)');
  else if (Math.round(charge * 100) !== charge * 100) errors.push('Easy Returns extra charge can have at most 2 decimal places');
  if (easyConditions(form).length > 10) errors.push('Add at most 10 return conditions');
  return errors;
}

export const blankVariant = () => ({ name: '', price: '', mrp: '', stock: '', unit: 'piece', weight: '', options: {} });

// Category details (Admin-configured per category): { code: value } on the product, and per variant for
// variant-defining fields such as Size / Colour. Stored values come back as arrays of { code, value }.
const valuesFrom = (list) => Object.fromEntries((list || []).map((x) => [x.code, x.value]));
const commonDefaults = { hsnCode: '', barcode: '', countryOfOrigin: '', dispatchDays: '', pkgLength: '', pkgBreadth: '', pkgHeight: '' };

/**
 * Pre-fills the category's Admin-set default values into fields the seller has left empty (new listings only).
 * Never overwrites what the seller typed; a variant gets defaults for its variant fields (e.g. Size).
 */
export const applyFieldDefaults = (form, fields) => {
  const hasDefault = (f) => f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '' && !(Array.isArray(f.defaultValue) && !f.defaultValue.length);
  const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  const withDefaults = fields.filter(hasDefault);
  if (!withDefaults.length) return form;
  const specs = { ...(form.specs || {}) };
  for (const f of withDefaults.filter((x) => !x.isVariant)) if (isEmpty(specs[f.code])) specs[f.code] = f.defaultValue;
  const variantDefaults = withDefaults.filter((x) => x.isVariant);
  const variants = variantDefaults.length ? (form.variants || []).map((v) => {
    const options = { ...(v.options || {}) };
    for (const f of variantDefaults) if (isEmpty(options[f.code])) options[f.code] = f.defaultValue;
    return { ...v, options };
  }) : form.variants;
  return { ...form, specs, variants };
};

export const emptyForm = () => ({
  name: '', categoryId: '', desc: '', brandName: '', gstRate: 0,
  variants: [{ ...blankVariant(), name: 'Default' }],
  specs: {}, ...commonDefaults, videos: [],
  sameDayEnabled: false, processingMinutes: '', returnable: false, returnWindowDays: '',
  deliveryMethod: 'easy_ship',
  ...easyDefaults,
});

// Same mapping as startEditProduct.
export const formFromProduct = (raw) => ({
  name: raw.name || '',
  categoryId: String(raw.category?._id || raw.category || ''),
  desc: raw.description || '',
  brandName: raw.brandName || '',
  gstRate: raw.gstRate ?? 0,
  variants: raw.variants?.length
    ? raw.variants.map((v) => ({ _id: v._id, name: v.name ?? '', price: v.price ?? '', mrp: v.mrp ?? '', stock: v.stock ?? '', unit: v.unit || 'piece', weight: v.weight ?? '', sku: v.sku, options: valuesFrom(v.options), images: v.images || [] }))
    : [{ name: 'Default', price: raw.price ?? '', mrp: raw.mrp ?? '', stock: raw.stock ?? '', unit: raw.unit || 'piece', weight: raw.weight ?? '', options: {} }],
  specs: valuesFrom(raw.specs),
  hsnCode: raw.hsnCode || '', barcode: raw.barcode || '', countryOfOrigin: raw.countryOfOrigin || '',
  dispatchDays: raw.dispatchDays ?? '',
  // Packed size in cm (PDF §4); used as the starting value when booking a courier.
  pkgLength: raw.dimensions?.length ?? '', pkgBreadth: raw.dimensions?.breadth ?? '', pkgHeight: raw.dimensions?.height ?? '',
  videos: Array.isArray(raw.videos) ? raw.videos : [],
  sameDayEnabled: Boolean(raw.sameDay?.enabled),
  processingMinutes: raw.sameDay?.processingMinutes ?? '',
  returnable: raw.type === 'grocery' ? Boolean(raw.returnable) : raw.returnSettings?.enabled !== false,
  returnWindowDays: raw.returnSettings?.windowDays ?? '',
  // Absent = Easy Ship (every product listed before delivery methods existed).
  deliveryMethod: raw.deliveryMethod || 'easy_ship',
  savedDeliveryMethod: raw.deliveryMethod || 'easy_ship',
  ...easyFromProduct(raw),
});

const blank = (value) => value === '' || value === undefined || value === null;

/**
 * Returns { general:[], category:[], variants:[], photos:[] }. Same messages as the web.
 * ctx: { channel, isEditing, hasCategory, categoryMessage, photoCount, existingPhotoCount, returnPolicy, returnPolicyState, sameDayMax }
 */
export function validateProductForm(form, ctx) {
  const errs = { general: [], category: [], variants: [], photos: [] };
  const name = String(form.name || '').trim();
  if (!name) errs.general.push('Product Title is required');
  else if (name.length < 3) errs.general.push('Product Title must be at least 3 characters');

  if (!GST_RATES.includes(Number(form.gstRate))) errs.general.push('Choose a GST rate');

  if (form.returnable && !blank(form.returnWindowDays)) {
    const days = Number(form.returnWindowDays);
    if (!Number.isSafeInteger(days) || days <= 0) errs.general.push('Return window must be a positive whole number of days');
    else if (ctx.returnPolicyState !== 'ready') errs.general.push('Check the category return policy before saving a product window');
    else if (!ctx.returnPolicy?.eligible) errs.general.push('Admin must enable category or global returns before setting a product window');
    else if (days > ctx.returnPolicy.returnWindowDays) errs.general.push(`Return window cannot exceed ${ctx.returnPolicy.returnWindowDays} days`);
  }

  errs.general.push(...validateEasyReturns(form));

  if (ctx.isEditing && ctx.channel === 'ecommerce' && form.sameDayEnabled) {
    const minutes = Number(form.processingMinutes);
    if (blank(form.processingMinutes) || !Number.isFinite(minutes) || minutes < 0) errs.general.push('Enter the packing time in minutes for same-day delivery');
    else if (Number.isFinite(ctx.sameDayMax) && minutes > ctx.sameDayMax) errs.general.push(`Packing time cannot exceed ${ctx.sameDayMax} minutes`);
  }

  if (!ctx.hasCategory) errs.category.push(ctx.categoryMessage || 'Please select a valid category leaf');

  const variants = Array.isArray(form.variants) ? form.variants : [];
  if (!variants.length) errs.variants.push('Add at least one variant with pricing and stock');
  variants.forEach((v, i) => {
    const label = v.name ? `"${v.name}"` : `Variant ${i + 1}`;
    if (!v.name || !String(v.name).trim()) errs.variants.push(`${label} requires a name`);
    if (blank(v.price) || !(Number(v.price) > 0)) errs.variants.push(`${label} requires a valid selling price (> 0)`);
    if (blank(v.stock) || !Number.isFinite(Number(v.stock)) || Number(v.stock) < 0) errs.variants.push(`${label} stock cannot be negative`);
    else if (!Number.isSafeInteger(Number(v.stock))) errs.variants.push(`${label} stock must be a whole number`);
    if (!blank(v.mrp) && Number(v.price) > Number(v.mrp)) errs.variants.push(`${label} price cannot exceed MRP`);
    if (!blank(v.weight) && !(Number(v.weight) >= 0)) errs.variants.push(`${label} weight must be a number`);
  });

  const hasCover = ctx.photoCount > 0 || (ctx.isEditing && ctx.existingPhotoCount > 0);
  if (!hasCover) errs.photos.push('Main product cover photo is required');
  if (ctx.photoCount > MAX_PRODUCT_IMAGES) errs.photos.push(`Up to ${MAX_PRODUCT_IMAGES} photos`);
  return errs;
}

const variantPayload = (v, withId) => ({
  ...(withId && v._id ? { _id: v._id } : {}),
  name: String(v.name || '').trim(),
  price: Number(v.price),
  mrp: !blank(v.mrp) ? Number(v.mrp) : Number(v.price),
  stock: Number(v.stock),
  unit: v.unit || 'piece',
  ...(!blank(v.weight) ? { weight: Number(v.weight) } : {}),
  ...(v.options && Object.keys(v.options).length ? { options: v.options } : {}),
  ...(Array.isArray(v.images) ? { images: v.images.filter(Boolean) } : {}),
});

// Details and common fields are sent on create and update; the server checks them against the category.
const appendDetails = (fd, form) => {
  fd.append('specs', JSON.stringify(form.specs || {}));
  for (const key of ['hsnCode', 'barcode', 'countryOfOrigin', 'dispatchDays']) fd.append(key, String(form[key] ?? '').trim());
  fd.append('dimensions', JSON.stringify(packageDimensions(form)));
  // Already-uploaded product videos; only sent when the form knows them, so nothing is wiped by accident.
  if (Array.isArray(form.videos)) fd.append('videos', JSON.stringify(form.videos));
};

// All three or none; the server rejects a partial size. An empty object clears a saved size.
export const packageDimensions = (form) => {
  const vals = { length: form.pkgLength, breadth: form.pkgBreadth, height: form.pkgHeight };
  return Object.values(vals).every((v) => blank(v) || String(v).trim() === '') ? {} : Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, Number(v)]));
};

const emptyValue = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

/**
 * The same required / format checks the server makes, so the seller sees them before uploading photos.
 * `fields` come from GET /api/catalog/fields. Returns a list of messages.
 */
export function validateCategoryFields(form, fields) {
  const errs = [];
  for (const f of fields.filter((x) => !x.isVariant)) {
    const v = form.specs?.[f.code];
    if (emptyValue(v)) { if (f.required) errs.push(`${f.label} is required`); continue; }
    if (['number', 'decimal'].includes(f.fieldType) && !Number.isFinite(Number(v))) errs.push(`${f.label} must be a number`);
    if (f.fieldType === 'number' && Number.isFinite(Number(v)) && !Number.isInteger(Number(v))) errs.push(`${f.label} must be a whole number`);
    if (f.fieldType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errs.push(`${f.label} must be a date (YYYY-MM-DD)`);
  }
  const variantFields = fields.filter((x) => x.isVariant);
  const seen = new Set();
  (form.variants || []).forEach((variant, i) => {
    const name = variant.name ? `“${variant.name}”` : `Variant ${i + 1}`;
    for (const f of variantFields) if (f.required && emptyValue(variant.options?.[f.code])) errs.push(`${name}: ${f.label} is required`);
    if (variantFields.length) {
      const key = variantFields.map((f) => String(variant.options?.[f.code] ?? '')).join('|');
      if (key.replace(/\|/g, '') && seen.has(key)) errs.push(`${name} has the same ${variantFields.map((f) => f.label).join(' / ')} as another variant`);
      seen.add(key);
    }
  });
  if (form.hsnCode && !/^\d{4,8}$/.test(String(form.hsnCode).trim())) errs.push('HSN code must be 4 to 8 digits');
  if (form.barcode && !/^\d{8,14}$/.test(String(form.barcode).trim())) errs.push('Barcode must be 8 to 14 digits');
  if (!emptyValue(form.dispatchDays) && !(Number.isInteger(Number(form.dispatchDays)) && Number(form.dispatchDays) >= 0 && Number(form.dispatchDays) <= 30)) errs.push('Dispatch time must be 0 to 30 days');
  const pkg = [form.pkgLength, form.pkgBreadth, form.pkgHeight];
  if (pkg.some((v) => !emptyValue(v))) {
    if (pkg.some((v) => emptyValue(v))) errs.push('Enter all three package measurements (length, breadth, height) or leave them all empty');
    else if (pkg.some((v) => !(Number(v) > 0 && Number(v) <= 500))) errs.push('Package measurements must be more than 0 and at most 500 cm');
  }
  return errs;
}

const appendImages = (fd, images) => images.forEach((image) => fd.append('images', { uri: image.uri, name: image.name, type: image.type }));

// Same fields, order and rules as submitNewProduct (physical retail). A new product's SKU is never sent.
export function buildCreateFormData(form, channel, images) {
  const fd = new FormData();
  fd.append('roleContext', 'seller');
  fd.append('type', channel);
  fd.append('fulfillmentType', 'physical');
  fd.append('name', form.name.trim());
  fd.append('category', form.categoryId);
  if (form.desc) fd.append('description', form.desc);
  if (form.brandName) fd.append('brandName', form.brandName);
  fd.append('gstRate', String(form.gstRate ?? 0));
  fd.append('gstPriceType', 'inclusive'); // Prices always include GST.
  fd.append('variants', JSON.stringify(form.variants.map((v) => variantPayload(v, false))));
  appendDetails(fd, form);
  // The web only offers same-day on edit, so a new listing never carries sameDay.
  // Delivery method (Shop All): Easy Ship is the default and is not sent, as on the web.
  if (channel === 'ecommerce' && form.deliveryMethod && form.deliveryMethod !== 'easy_ship') fd.append('deliveryMethod', form.deliveryMethod);
  // A new FBB listing carries the charge version the seller accepted (the server refuses a stale one).
  if (channel === 'ecommerce' && form.deliveryMethod === 'fbb' && form.fbbChargeVersion) fd.append('fbbChargeVersion', String(form.fbbChargeVersion));
  fd.append('returnable', form.returnable ? 'true' : 'false');
  fd.append('returnWindowDays', form.returnable ? String(form.returnWindowDays ?? '') : '');
  fd.append('easyReturns', easyReturnsPayload(form));
  appendImages(fd, images);
  return fd;
}

// Same as submitProductEdit (physical retail). No images = keep the existing set.
export function buildUpdateFormData(form, channel, images) {
  const fd = new FormData();
  fd.append('name', form.name.trim());
  fd.append('category', form.categoryId);
  if (form.desc) fd.append('description', form.desc);
  fd.append('brandName', form.brandName ?? '');
  fd.append('gstRate', String(form.gstRate ?? 0));
  fd.append('gstPriceType', 'inclusive');
  fd.append('variants', JSON.stringify(form.variants.map((v) => variantPayload(v, true))));
  appendDetails(fd, form);
  // sameDay is always sent on a Shop All edit: leaving it out means "no change", which would make switching it off impossible.
  if (channel === 'ecommerce') {
    fd.append('sameDay', JSON.stringify(form.sameDayEnabled ? { enabled: true, processingMinutes: Number(form.processingMinutes) } : { enabled: false }));
    // Sent only when changed, so an untouched edit is the same request as before.
    if (form.deliveryMethod && form.deliveryMethod !== (form.savedDeliveryMethod || 'easy_ship')) fd.append('deliveryMethod', form.deliveryMethod);
  }
  fd.append('returnable', form.returnable ? 'true' : 'false');
  fd.append('returnWindowDays', form.returnable ? String(form.returnWindowDays ?? '') : '');
  fd.append('easyReturns', easyReturnsPayload(form));
  appendImages(fd, images);
  return fd;
}

// Category cascade helpers (Header L1 → Main L2 → Sub L3). Only the deepest chosen leaf is submitted.
export function effectiveCategory(tree, picks) {
  const l1 = tree.find((c) => String(c._id) === picks.l1) || null;
  const l2List = l1?.children || [];
  const l2 = l2List.find((c) => String(c._id) === picks.l2) || null;
  const l3List = l2?.children || [];
  const l3 = l3List.find((c) => String(c._id) === picks.l3) || null;
  const id = l3 ? String(l3._id) : (l2 && !l3List.length) ? String(l2._id) : (l1 && !l2List.length) ? String(l1._id) : '';
  const message = !picks.l1 ? 'Please select a header category'
    : l2List.length && !picks.l2 ? 'Please select a main category'
      : l3List.length && !picks.l3 ? 'Please select a specific sub-category'
        : !id ? 'Please select a valid category leaf' : '';
  return { l1, l2, l3, l2List, l3List, id, message, breadcrumb: [l1?.name, l2?.name, l3?.name].filter(Boolean).join(' › ') };
}

// Re-select the saved category once the tree has loaded.
export function picksForCategory(tree, savedId) {
  const target = String(savedId || '');
  if (!target) return { l1: '', l2: '', l3: '' };
  for (const l1 of tree) {
    if (String(l1._id) === target) return { l1: target, l2: '', l3: '' };
    for (const l2 of l1.children || []) {
      if (String(l2._id) === target) return { l1: String(l1._id), l2: target, l3: '' };
      for (const l3 of l2.children || []) if (String(l3._id) === target) return { l1: String(l1._id), l2: String(l2._id), l3: target };
    }
  }
  return { l1: '', l2: '', l3: '' };
}
