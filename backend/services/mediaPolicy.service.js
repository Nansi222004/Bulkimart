// Category policy table for every audited upload workflow (docs/PLATFORM_STORAGE_AUDIT.md).
// Visibility, directory, accepted content and processing are decided here, never by callers.
//
// visibility: public       → stable URL, cacheable, anyone may read
//             private      → signed URL issued only inside an authorised API response
//             private-kyc  → identity / licence / bank documents: owner or admin only, audited
// output:     how accepted images are re-encoded ('webp' | 'jpeg' | 'png')

const MB = 1024 * 1024;
const IMAGES = ['jpeg', 'png', 'webp'];

export const MEDIA_CATEGORIES = Object.freeze({
  'customer.avatar':   { visibility: 'public',      dir: 'profiles',           accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 1024, output: 'webp' },
  'customer.landmark': { visibility: 'private',     dir: 'addresses',          accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 2048, output: 'webp' },
  'customer.review':   { visibility: 'public',      dir: 'reviews',            accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 2048, output: 'webp' },
  'customer.return':   { visibility: 'private',     dir: 'returns',            accept: [...IMAGES, 'pdf'],        maxBytes: 5 * MB, maxSide: 2560, output: 'webp' },
  'shared.ticket':     { visibility: 'private',     dir: 'support',            accept: [...IMAGES, 'pdf'],        maxBytes: 5 * MB, maxSide: 2560, output: 'webp' },
  'seller.product':    { visibility: 'public',      dir: 'products',           accept: [...IMAGES, 'svg'],        maxBytes: 5 * MB, maxSide: 2048, output: 'webp' },
  'seller.branding':   { visibility: 'public',      dir: 'stores',             accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 2560, output: 'webp' },
  'seller.kyc':        { visibility: 'private-kyc', dir: 'seller-documents',   accept: [...IMAGES, 'pdf'],        maxBytes: 5 * MB, maxSide: 3000, output: 'jpeg' },
  'seller.bank':       { visibility: 'private-kyc', dir: 'seller-bank',        accept: [...IMAGES, 'pdf'],        maxBytes: 5 * MB, maxSide: 3000, output: 'jpeg' },
  'delivery.kyc':      { visibility: 'private-kyc', dir: 'delivery-documents', accept: [...IMAGES, 'pdf'],        maxBytes: 5 * MB, maxSide: 3000, output: 'jpeg' },
  'delivery.bank':     { visibility: 'private-kyc', dir: 'delivery-bank',      accept: [...IMAGES, 'pdf'],        maxBytes: 5 * MB, maxSide: 3000, output: 'jpeg' },
  'admin.banner':      { visibility: 'public',      dir: 'banners',            accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 3000, output: 'webp' },
  'admin.storefront':  { visibility: 'public',      dir: 'storefront',         accept: [...IMAGES, 'mp4'],        maxBytes: 15 * MB, maxSide: 3000, output: 'webp' },
  'admin.category':    { visibility: 'public',      dir: 'categories',         accept: [...IMAGES, 'svg'],        maxBytes: 5 * MB, maxSide: 1024, output: 'webp' },
  'admin.campaign':    { visibility: 'public',      dir: 'campaigns',          accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 3000, output: 'webp' },
  // FCM renders JPEG/PNG reliably on every platform; keep broadcast images as JPEG.
  'admin.broadcast':   { visibility: 'public',      dir: 'notifications',      accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 2048, output: 'jpeg' },
  // Upload route retired (audit X1); kept so legacy packaging images can be migrated.
  'admin.packaging':   { visibility: 'public',      dir: 'packaging',          accept: IMAGES,                    maxBytes: 5 * MB, maxSide: 2048, output: 'webp' },
});

// Existing upload folders (the strings controllers already pass) → category.
// Order matters: the first matching prefix wins.
const FOLDER_PREFIXES = [
  ['avatars', 'customer.avatar'],
  ['landmark-images', 'customer.landmark'],
  ['reviews', 'customer.review'],
  ['returns', 'customer.return'],
  ['support-tickets', 'shared.ticket'],
  ['products', 'seller.product'],
  ['seller-branding', 'seller.branding'],
  ['seller-kyc', 'seller.kyc'],
  ['seller-docs', 'seller.kyc'],
  ['seller-bank', 'seller.bank'],
  ['delivery-kyc', 'delivery.kyc'],
  ['driver-', 'delivery.kyc'],
  ['delivery-bank', 'delivery.bank'],
  ['banners', 'admin.banner'],
  ['storefront', 'admin.storefront'],
  ['category-icons', 'admin.category'],
  ['categories', 'admin.category'],
  ['campaigns', 'admin.campaign'],
  ['notifications', 'admin.broadcast'],
  ['packaging-', 'admin.packaging'],
];

export const categoryForFolder = (folder) => {
  const value = String(folder || '');
  // `name` matches "name" and "name/<sub>"; a prefix ending in "-" matches "name-anything".
  const matches = (prefix) => (prefix.endsWith('-') ? value.startsWith(prefix) : value === prefix || value.startsWith(`${prefix}/`));
  return FOLDER_PREFIXES.find(([prefix]) => matches(prefix))?.[1] ?? null;
};

export const getCategoryPolicy = (category) => {
  const policy = MEDIA_CATEGORIES[category];
  if (!policy) throw Object.assign(new Error(`Unknown media category: ${category}`), { status: 500, code: 'MEDIA_CATEGORY_UNKNOWN' });
  return policy;
};

export const isSensitiveCategory = (category) => MEDIA_CATEGORIES[category]?.visibility === 'private-kyc';

export const PUBLIC_DIRECTORIES = new Set(Object.values(MEDIA_CATEGORIES).filter((p) => p.visibility === 'public').map((p) => p.dir));
