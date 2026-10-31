// Maps a web customer path (as used in notification `route` fields and shared links) to the app route.
const ID = '[a-f\\d]{24}';
export function appHrefFromWebPath(input) {
  let url;
  try { url = new URL(String(input || '/'), 'https://bulkimart.in'); } catch { return '/'; }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const product = url.searchParams.get('product');
  if (product && new RegExp(`^${ID}$`, 'i').test(product)) {
    const params = new URLSearchParams({ id: product });
    if (url.searchParams.get('purchase') === 'wholesale') params.set('purchase', 'wholesale');
    if (url.searchParams.get('variant')) params.set('variant', url.searchParams.get('variant'));
    return `/product?${params}`;
  }
  let m;
  if ((m = path.match(new RegExp(`^/orders/(${ID})$`, 'i')))) return `/order/${m[1]}`;
  if ((m = path.match(new RegExp(`^/review/(${ID})$`, 'i')))) return `/review/${m[1]}`;
  if (path === '/wholesale/cart') return '/wholesale-cart';
  if ((m = path.match(new RegExp(`^/wholesale/(${ID})$`, 'i')))) return `/product?id=${m[1]}&purchase=wholesale`;
  if ((m = path.match(new RegExp(`^/legal-services/(${ID})$`, 'i')))) return `/legal-services?id=${m[1]}`;
  if ((m = path.match(/^\/parcel-delivery\/(book|history|track\/[a-f\d]{24})$/i))) return `/parcel-delivery?view=${encodeURIComponent(m[1])}`;
  if (path === '/profile') return '/account';
  const first = path.split('/').filter(Boolean)[0];
  if (['categories', 'orders', 'ebooks', 'account', 'cart', 'checkout', 'wishlist', 'search', 'wholesale', 'services', 'legal-services', 'parcel-delivery'].includes(first)) return `/${first}`;
  return '/';
}
