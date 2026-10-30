// Old bookmarks and navigation calls must not reopen retired seller ad tools.
export const isRetiredAdminTab = tab => [
  'seller-promotions',
  'promotion-packages',
  'vendor-ad-requests',
  'vendor-featured-seller',
  'vendor-sponsored-products',
].includes(tab);
