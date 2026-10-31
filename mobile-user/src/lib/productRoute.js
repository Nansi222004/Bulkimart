// Port of frontend/src/modules/User/utils/productRoute.js. The web keeps product links in the URL
// (`?product=<id>&purchase=wholesale&variant=`); the app opens the `/product` route with the same parameters.
import { session } from './storage';

export function wholesaleDetailProduct(product) {
  return { ...product, fulfillmentType: 'physical', detailSource: 'wholesale',
    sellerId: { businessName: product.seller?.name },
    variants: (product.variants || []).map(v => ({ ...v, _id: v.variantId, stock: v.availableStock })),
  };
}

export function rememberWholesaleReturn(id, variantId, path = '/wholesale') {
  session.setItem('bulkimart:product-return', JSON.stringify({ productId: id, variantId, path }));
}

export const productHref = (id, { purchase, variant } = {}) => {
  const params = new URLSearchParams({ id: String(id) });
  if (purchase) params.set('purchase', purchase);
  if (variant) params.set('variant', String(variant));
  return `/product?${params}`;
};
