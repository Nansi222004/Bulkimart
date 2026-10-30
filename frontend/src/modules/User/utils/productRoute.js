// Keep existing storefront query links and Wholesale path links compatible.
export function readProductRoute() {
  const params = new URLSearchParams(window.location.search);
  const path = window.location.pathname.match(/^\/wholesale\/([^/]+)\/?$/);
  const pathId = path && path[1] !== 'cart' ? path[1] : null;
  const id = params.has('product') ? params.get('product') : pathId;
  return { id, present: params.has('product') || !!pathId, variant: params.get('variant'), mode: params.get('purchase') === 'wholesale' || (pathId && params.get('purchase') !== 'retail') ? 'wholesale' : 'retail', wholesalePath: !!pathId };
}

export function openWholesaleProduct(id, variantId) {
  const params = new URLSearchParams(window.location.search);
  params.delete('product'); params.set('purchase','wholesale');
  if (variantId) params.set('variant',variantId); else params.delete('variant');
  window.history.pushState({bulkimartWholesaleProduct:true},'',`/wholesale/${id}?${params}`);
  window.dispatchEvent(new Event('app:locationchange'));
}

export function wholesaleDetailProduct(product) {
  return { ...product, fulfillmentType:'physical', detailSource:'wholesale',
    sellerId:{businessName:product.seller?.name},
    variants:(product.variants || []).map(v=>({...v,_id:v.variantId,stock:v.availableStock})),
  };
}

export function rememberWholesaleReturn(id, variantId) {
  sessionStorage.setItem('bulkimart:product-return',JSON.stringify({productId:id,variantId,path:window.location.pathname}));
}
