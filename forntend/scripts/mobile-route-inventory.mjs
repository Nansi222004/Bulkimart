import { readFile } from 'node:fs/promises';

// These routers use state and pathname parsing rather than a router library.
// Derive portal tab IDs from the dispatchers and navigation, including aliases.
const source = path => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const cases = text => [...text.matchAll(/case '([^']+)'/g)].map(match => match[1]);
const ids = text => [...text.matchAll(/\bid: '([^']+)'/g)].map(match => match[1]);
const id = '507f1f77bcf86cd799439015';
export const customerPaths = ['/', '/grocery--home', '/ecommerce--smart-buy',
  '/home', '/groceries', '/electronics', '/coupons', '/garments', '/smart-buy', '/hot-deals', '/fashion',
  '/grocery--fixture-category', '/ecommerce--fixture-category', '/categories', '/categories/fixture-category',
  '/search', '/wishlist', '/cart', '/checkout', '/orders', '/ebooks', '/account', '/profile',
  '/wholesale', `/wholesale/${id}`, '/wholesale/cart', `/grocery--home?product=${id}`, `/review/${id}`,
  '/account?guest=1', '/account?guest=register', '/account?guest=otp'];
export const sellerPaths = ['/seller', ...cases(await source('modules/Seller/pages/DashboardPage.jsx')).map(tab => `/seller/${tab}`),
  '/seller/orders/507f1f77bcf86cd799439022', '/seller?guest=1', '/seller/logout'];
export const deliveryPaths = ['/delivery', ...['dashboard', 'earnings', 'history', 'returns', 'profile', 'support'].map(tab => `/delivery/${tab}`), '/delivery?guest=1'];
const adminRoutes = await source('modules/Admin/routes/index.jsx');
const generic = await source('modules/Admin/components/SectionModuleTab.jsx');
export const adminPaths = [...new Set(['/admin', '/admin?guest=1',
  ...[...cases(adminRoutes), ...ids(await source('modules/Admin/components/LeftSidebar.jsx')),
    ...[...generic.matchAll(/^    '([^']+)': \{/gm)].map(match => match[1]),
    'categories-all', 'categories-grocery', 'categories-ecommerce', 'reviews', 'orders', 'privacy']
    .map(tab => `/admin/${tab}`), `/admin/products/${id}`])];
export const mobileRoutes = [...new Set([...customerPaths, ...sellerPaths, ...deliveryPaths, ...adminPaths])];
