import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, policy, Splash, Media, Hero, Card, Section, navigateHook, Provider, Studio, Coupons, catalog;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  policy = await vite.ssrLoadModule('/src/utils/storefront.js');
  Splash = (await vite.ssrLoadModule('/src/modules/User/components/PromotionalSplash.jsx')).default;
  Media = (await vite.ssrLoadModule('/src/modules/User/components/StorefrontMedia.jsx')).default;
  Hero = (await vite.ssrLoadModule('/src/modules/User/components/HeroBanner.jsx')).default;
  Card = (await vite.ssrLoadModule('/src/modules/User/components/StorefrontSections.jsx')).MerchandisingCard;
  Section = (await vite.ssrLoadModule('/src/modules/User/components/StorefrontSections.jsx')).StorefrontSection;
  navigateHook = (await vite.ssrLoadModule('/src/modules/User/hooks/usePromotionNavigation.js')).default;
  Provider = (await vite.ssrLoadModule('/src/modules/User/context/StorefrontContext.jsx')).StorefrontProvider;
  Studio = await vite.ssrLoadModule('/src/modules/Admin/components/StorefrontStudio.jsx');
  Coupons = (await vite.ssrLoadModule('/src/modules/User/components/CouponsSection.jsx')).default;
  catalog = await vite.ssrLoadModule('/src/modules/User/hooks/useProducts.js');
});
after(async () => vite?.close());
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) }; };
const banner = { id: '507f1f77bcf86cd799439011', title: 'Published banner', image: 'https://fixture.test/poster.webp', destination: { type: 'NAV', id: 'categories' }, cta: 'Shop collection' };
const splash = frequency => ({ id: '507f1f77bcf86cd799439012', revision: 1, banner, config: { frequency, duration: 15 }, endAt: new Date(Date.now() + 60000).toISOString() });
const text = node => !node ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
function browserHarness(Component, props, context, reduced = false) {
  const session = storage(), local = storage(), doc = new EventTarget();
  doc.querySelector = () => null; doc.visibilityState = 'visible';
  return hookHarness(p => {
    globalThis.document = doc;
    window.matchMedia = () => ({ matches: reduced, addEventListener() {}, removeEventListener() {} });
    window.sessionStorage = session; window.localStorage = local;
    return Component(p);
  }, props || {}, '/', context, { sessionStorage: session, localStorage: local });
}
for (const frequency of ['session', 'daily', 'version']) test(`${frequency} frequency persists and new publication is eligible`, () => {
  const c = splash(frequency), session = storage(), local = storage(), opts = { session, local };
  assert.equal(policy.eligibleSplash(c, opts), true); policy.markSplash(c, opts); assert.equal(policy.eligibleSplash(c, opts), false);
  assert.equal(policy.eligibleSplash({ ...c, revision: 2 }, opts), true);
});
test('launch frequency is per application launch, never a render or internal navigation', () => {
  assert.equal(policy.eligibleSplash(splash('launch'), { consumed: false }), true);
  assert.equal(policy.eligibleSplash(splash('launch'), { consumed: true }), false);
});
test('daily frequency uses business midnight in IST', () => {
  const c = splash('daily'); assert.notEqual(policy.frequencyKey(c, Date.parse('2030-01-01T18:29:59Z')), policy.frequencyKey(c, Date.parse('2030-01-01T18:30:00Z')));
});
test('expired, future and absent splash never appears', () => {
  assert.equal(policy.eligibleSplash(null), false); assert.equal(policy.eligibleSplash({ ...splash('launch'), endAt: new Date(Date.now() - 1).toISOString() }), false);
  assert.equal(policy.eligibleSplash({ ...splash('launch'), startAt: new Date(Date.now() + 5000).toISOString() }), false);
});
test('storage denial does not throw or block shopping', () => {
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  assert.equal(policy.eligibleSplash(splash('daily'), { local: denied }), true); assert.doesNotThrow(() => policy.markSplash(splash('daily'), { local: denied }));
});
test('configuration cache expires strictly and countdown cannot run negative', () => {
  const now = Date.now(), c = { version: 'v', banners: [], sections: [], validUntil: new Date(now + 1).toISOString() };
  assert.equal(policy.freshExperience(c, now), true); assert.equal(policy.freshExperience(c, now + 1), false); assert.equal(policy.freshExperience({}), false);
  assert.equal(policy.countdown(new Date(now - 1), now), ''); assert.equal(policy.countdown(new Date(now + 61000), now), '00:01:01');
});
test('default and refreshed themes map only to customer CSS tokens', () => {
  const defaults = policy.themeStyle(); assert.equal(defaults['--sf-primary'], '#087ea4');
  const next = policy.themeStyle(policy.PRESETS['Eid Celebration']); assert.equal(next['--primary'], '#116b52'); assert.equal(next['--sa-primary'], undefined); assert.equal(defaults['--sf-primary'], '#087ea4');
});
test('IST scheduling does not depend on the browser workstation timezone', () => {
  assert.equal(Studio.scheduleISO('2030-01-01T05:30'), '2030-01-01T00:00:00.000Z'); assert.equal(Studio.scheduleInput('2030-01-01T00:00:00Z'), '2030-01-01T05:30');
});
test('splash closes with skip and does not reopen after subsequent rerenders', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, device: 'mobile', activeNav: 'home' };
  const h = browserHarness(Splash, {}, context);
  try { assert.ok(h.find(n => n.props?.['aria-label'] === 'Close promotion')); h.find(n => n.props?.['aria-label'] === 'Close promotion').props.onClick(); h.flush(); assert.equal(h.tree, null); context.now++; h.rerender(); assert.equal(h.tree, null); } finally { h.close(); }
});
test('Escape and expiry dismiss the actual splash', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home' }, h = browserHarness(Splash, {}, context);
  try { const event = new Event('keydown'); Object.defineProperty(event, 'key', { value: 'Escape' }); document.dispatchEvent(event); h.flush(); assert.equal(h.tree, null); } finally { h.close(); }
  const h2 = browserHarness(Splash, {}, context); try { context.now += 120000; h2.rerender(); assert.equal(h2.tree, null); } finally { h2.close(); }
});
test('no splash on product detail or checkout and a pause dismisses the overlay', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'checkout' }, h = browserHarness(Splash, {}, context);
  try { assert.equal(h.tree, null); context.activeNav = 'home'; context.selectedProduct = {}; h.rerender(); assert.equal(h.tree, null); context.selectedProduct = null; h.rerender(); assert.ok(h.tree); context.splash = null; h.rerender(); assert.equal(h.tree, null); } finally { h.close(); }
});
test('splash CTA closes and invokes the supported existing destination', () => {
  let target; const h = browserHarness(Splash, {}, { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', setActiveNav: value => { target = value; } });
  try { h.find(n => n.props?.className === 'sf-cta').props.onClick(); h.flush(); assert.equal(target, 'categories'); assert.equal(h.tree, null); } finally { h.close(); }
});
test('reduced motion prevents video creation; image failure produces text fallback', () => {
  const h = browserHarness(Media, { banner: { ...banner, video: 'https://fixture.test/clip.mp4' }, device: 'mobile' }, {}, true);
  try { assert.equal(h.tree.type, 'img'); h.tree.props.onError(); h.flush(); assert.equal(h.tree.props.role, 'img'); assert.match(text(h.tree), /Published banner/); } finally { h.close(); }
});
test('video load failure falls back to its static poster', () => {
  const h = browserHarness(Media, { banner: { ...banner, video: 'https://fixture.test/clip.mp4' } }, {});
  try { assert.equal(h.tree.type, 'video'); assert.equal(h.tree.props.muted, true); h.tree.props.onError(); h.flush(); assert.equal(h.tree.type, 'img'); assert.equal(h.tree.props.src, banner.image); } finally { h.close(); }
});
test('hero renders no hardcoded sale when configuration is empty and has keyboard buttons', () => {
  const context = { banners: [], device: 'mobile', loading: false }, h = browserHarness(Hero, {}, context);
  try { assert.equal(h.tree, null); context.banners = [banner, { ...banner, id: 'second' }]; h.rerender(); assert.ok(h.find(n => n.props?.['aria-label'] === 'Next promotion')); h.find(n => n.props?.['aria-label'] === 'Next promotion').props.onClick(); h.flush(); assert.match(text(h.tree), /2\s+\/\s+2/); } finally { h.close(); }
});
test('product cards omit invented ratings and discounts; stock and variants govern add action', async () => {
  let added = 0, opened = 0;
  const context = { addToCart: async () => { added++; return { ok: true }; }, setSelectedProduct: () => opened++ };
  const props = { product: { id: banner.id, name: 'Real product', price: 50, mrp: 50, rating: 0, stock: 0 } }, h = browserHarness(Card, props, context);
  try { assert.equal(h.find(n => n.props?.className === 'sf-rating'), undefined); assert.equal(h.find(n => n.type === 'del'), undefined); assert.equal(h.find(n => n.props?.className === 'sf-add').props.disabled, true);
    props.product.stock = 5; props.product.variants = [{ stock: 5 }]; h.rerender(); await h.find(n => n.props?.className === 'sf-add').props.onClick(); assert.equal(opened, 1); assert.equal(added, 0);
    props.product.variants = []; h.rerender(); await h.find(n => n.props?.className === 'sf-add').props.onClick(); h.flush(); assert.equal(added, 1); assert.match(text(h.tree), /Added to cart/);
  } finally { h.close(); }
});
test('navigation rejects executable URLs and uses existing category navigation', () => {
  const actions = []; let nav;
  const h = browserHarness(() => { nav = navigateHook(); return null; }, {}, { setSelectedCategoryFilter: v => actions.push(v), setActiveNav: v => actions.push(v) });
  try { window.open = url => actions.push(url); nav({ type: 'EXTERNAL_URL', url: 'javascript:alert(1)' }); nav({ type: 'EXTERNAL_URL', url: 'https://user:password@example.test' }); assert.deepEqual(actions, []);
    nav({ type: 'CATEGORY', id: 'cat', slug: 'grocery--fruit', name: 'Fruit' }); assert.deepEqual(actions, [{ _id: 'cat', slug: 'grocery--fruit', name: 'Fruit' }]);
  } finally { h.close(); }
});
test('provider ignores stale scope response and recovers from API failure with brand defaults', async () => {
  const context = { activeMode: 'quick', activeSubNav: 'grocery--home' }, h = browserHarness(Provider, {}, context);
  const response = token => ({ success: true, data: { version: token, theme: { tokens: policy.PRESETS['Eid Celebration'] }, banners: [banner], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 30000).toISOString() } });
  try { const first = h.requests[0]; context.activeMode = 'shop-all'; h.rerender(); const second = h.requests[1]; second.resolve(response('new')); await h.settle(); first.resolve(response('old')); await h.settle(); assert.equal(h.tree.props.value.version, 'new');
    context.activeMode = 'quick'; h.rerender(); h.requests.at(-1).reject(new Error('Offline')); await h.settle(); assert.equal(h.tree.props.value.theme.tokens.primary, policy.DEFAULT_TOKENS.primary); assert.equal(h.tree.props.value.loading, false);
  } finally { h.close(); }
});
test('guest offers request sign-in and never invent coupon codes', () => {
  const h = browserHarness(Coupons, {}, { activeMode: 'quick', currentUser: null, now: Date.now() });
  try { assert.equal(h.requests.length, 0); assert.match(text(h.tree), /Sign in/); assert.doesNotMatch(text(h.tree), /GROCERY20|TECH100|FREEDEL/); } finally { h.close(); }
});
test('coupon UI uses signed-in server eligibility and removes expired codes', async () => {
  const context = { activeMode: 'quick', currentUser: { _id: 'customer' }, now: Date.now() }, h = browserHarness(Coupons, {}, context);
  try {
    localStorage.setItem('userToken', 'fixture'); context.currentUser._id = 'customer-2'; h.rerender();
    assert.match(h.requests[0].url, /coupons\/available\?channel=grocery/);
    h.requests[0].resolve({ data: [{ code: 'REAL', title: 'Published coupon', applicable: false, reason: 'Minimum basket not reached', expiresAt: new Date(context.now + 1000).toISOString() }] }); await h.settle();
    assert.match(text(h.tree), /Minimum basket not reached/); assert.match(text(h.tree), /REAL/); context.now += 2000; h.rerender(); assert.doesNotMatch(text(h.tree), /REAL/);
  } finally { h.close(); }
});
test('identical catalog reads share one request; a failed request can be retried', async () => {
  const h = browserHarness(() => null, {}, {});
  try {
    const a = catalog.readCatalog('/api/products?fixture=dedup'), b = catalog.readCatalog('/api/products?fixture=dedup'); assert.equal(h.requests.length, 1);
    h.requests[0].resolve({ products: [{ _id: banner.id, name: 'Catalog', price: 20 }] }); const [first, second] = await Promise.all([a, b]); assert.equal(first[0].id, banner.id); assert.equal(first, second);
    const failed = catalog.readCatalog('/api/products?fixture=retry'); h.requests[1].resolve({ message: 'Unavailable' }, 503); await assert.rejects(failed);
    const retry = catalog.readCatalog('/api/products?fixture=retry'); h.requests[2].resolve({ products: [] }); assert.deepEqual(await retry, []);
  } finally { h.close(); }
});

test('wholesale cards use available tier prices and preserve variant purchase navigation', async () => {
  const product = { _id: banner.id, name: 'Bulk soap', images: [], variants: [
    { variantId: 'available', available: true, minimumQuantity: 12, priceTiers: [{ unitPrice: 18.5 }, { unitPrice: 16.25 }] },
    { variantId: 'unavailable', available: false, minimumQuantity: 1, priceTiers: [{ unitPrice: 1 }] },
  ] };
  const h = browserHarness(Card, { product, wholesale: true }, {});
  try {
    assert.match(text(h.tree), /From ₹16.25/); assert.match(text(h.tree), /Minimum\s+12\s+units/); assert.doesNotMatch(text(h.tree), /% off/);
    await h.find(n => n.props?.className === 'sf-add').props.onClick();
    assert.equal(window.location.pathname, `/wholesale/${banner.id}`); assert.equal(new URLSearchParams(window.location.search).get('variant'), 'available');
  } finally { h.close(); }
});

test('wholesale section reads real catalog, supports retry, and hides an empty collection', async () => {
  const section = { id: 'collection', config: { source: 'wholesale', title: 'Business picks', limit: 4, variant: 'accent' } };
  const h = browserHarness(Section, { section }, { activeMode: 'shop-all', now: Date.now(), device: 'mobile' });
  try {
    assert.equal(h.requests.length, 1); assert.match(h.requests[0].url, /products\/wholesale\/catalog\?limit=4/);
    h.requests[0].resolve({ message: 'Unavailable' }, 503); await h.settle(); assert.match(text(h.tree), /could not be loaded/);
    h.find(n => n.type === 'button' && text(n) === 'Retry').props.onClick(); h.flush();
    h.requests[1].resolve({ data: [{ _id: banner.id, name: 'Real wholesale product', variants: [] }] }); await h.settle();
    assert.ok(h.find(n => n.type === Card && n.props.wholesale && n.props.product._id === banner.id));
  } finally { h.close(); }
  const empty = browserHarness(Section, { section }, { activeMode: 'shop-all', now: Date.now() });
  try { empty.requests[0].resolve({ data: [] }); await empty.settle(); assert.equal(empty.tree, null); } finally { empty.close(); }
});
