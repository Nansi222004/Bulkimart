export const SELLER_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_PREFIX = 'bulkimart:seller-onboarding:v1:';
const ALLOWED_MODES = new Set(['ecommerce', 'quick']);

export const selectedModesToChannels = (modes) => {
  if (!Array.isArray(modes) || modes.length === 0 || modes.some((mode) => !ALLOWED_MODES.has(mode))) {
    throw new Error('Select at least one valid sales channel.');
  }
  const unique = new Set(modes);
  return [
    ...(unique.has('ecommerce') ? ['ecommerce'] : []),
    ...(unique.has('quick') ? ['grocery'] : []),
  ];
};

/** Display the seller's chosen storefront channel(s), not a legacy vendor label. */
export const sellerTypeLabelFromModes = (modes) => {
  let channels;
  try {
    channels = selectedModesToChannels(modes);
  } catch {
    return 'Select a sales channel';
  }

  const hasEcommerce = channels.includes('ecommerce');
  const hasQuick = channels.includes('grocery');
  if (hasEcommerce && hasQuick) return 'Hybrid';
  if (hasQuick) return 'Quick Commerce';
  if (hasEcommerce) return 'E-Commerce';
  return 'Select a sales channel';
};

export const getSellerDraftKey = (userId) => {
  const id = typeof userId === 'string' ? userId.trim() : '';
  return id ? `${DRAFT_PREFIX}${id}` : null;
};

/**
 * Persist only low-sensitivity fields. OTPs, identity/tax numbers, bank data,
 * addresses, uploaded files, and authentication data are intentionally absent.
 */
export const sanitizeSellerDraft = (input, now = Date.now()) => {
  if (!input || typeof input !== 'object' || input.version !== 1) return null;
  const updatedAt = Number(input.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 5 * 60 * 1000 || now - updatedAt > SELLER_DRAFT_TTL_MS) return null;

  const selectedTypes = Array.isArray(input.selectedTypes)
    ? [...new Set(input.selectedTypes.filter((mode) => ALLOWED_MODES.has(mode)))]
    : [];
  const biz = input.bizForm && typeof input.bizForm === 'object' ? input.bizForm : {};
  const step = Number(input.step);

  return {
    version: 1,
    updatedAt,
    step: Number.isInteger(step) ? Math.max(1, Math.min(step, 8)) : 1,
    selectedTypes: selectedTypes.length ? selectedTypes : ['ecommerce'],
    bizForm: {
      storeName: typeof biz.storeName === 'string' ? biz.storeName.slice(0, 120) : '',
      vendorType: typeof biz.vendorType === 'string' ? biz.vendorType.slice(0, 40) : 'General Vendor',
      category: typeof biz.category === 'string' ? biz.category.slice(0, 80) : 'Groceries',
      description: typeof biz.description === 'string' ? biz.description.slice(0, 1000) : '',
    },
  };
};

export const readSellerDraft = (storage, key, now = Date.now()) => {
  if (!storage || !key) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = sanitizeSellerDraft(JSON.parse(raw), now);
    if (!parsed) storage.removeItem(key);
    return parsed;
  } catch {
    try { storage.removeItem(key); } catch { /* unavailable storage */ }
    return null;
  }
};

export const writeSellerDraft = (storage, key, draft, now = Date.now()) => {
  if (!storage || !key) return false;
  const safeDraft = sanitizeSellerDraft({ ...draft, version: 1, updatedAt: now }, now);
  if (!safeDraft) return false;
  try {
    storage.setItem(key, JSON.stringify(safeDraft));
    return true;
  } catch {
    return false;
  }
};

export const clearSellerDraft = (storage, key) => {
  if (!storage || !key) return;
  try { storage.removeItem(key); } catch { /* unavailable storage */ }
};
