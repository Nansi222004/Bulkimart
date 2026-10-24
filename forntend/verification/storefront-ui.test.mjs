import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, policy, Splash, SplashCard, SplashPreview, Media, Hero, HeaderCategories, BottomNav, Card, Section, navigateHook, Provider, Studio, Coupons, catalog;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  policy = await vite.ssrLoadModule('/src/utils/storefront.js');
  Splash = (await vite.ssrLoadModule('/src/modules/User/components/PromotionalSplash.jsx')).default;
  SplashCard = (await vite.ssrLoadModule('/src/modules/User/components/SplashCard.jsx')).default;
  SplashPreview = (await vite.ssrLoadModule('/src/modules/Admin/components/StorefrontSplashPreview.jsx')).default;
  Media = (await vite.ssrLoadModule('/src/modules/User/components/StorefrontMedia.jsx')).default;
  Hero = (await vite.ssrLoadModule('/src/modules/User/components/HeroBanner.jsx')).default;
  HeaderCategories = (await vite.ssrLoadModule('/src/modules/User/components/HeaderCategories.jsx')).default;
  BottomNav = (await vite.ssrLoadModule('/src/modules/User/components/BottomNav.jsx')).default;
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
  const defaults = policy.themeStyle(); assert.equal(defaults['--sf-primary'], '#B50918');
  const next = policy.themeStyle(policy.PRESETS['Eid Celebration']); assert.equal(next['--primary'], '#116b52'); assert.equal(next['--sa-primary'], undefined); assert.equal(defaults['--sf-primary'], '#B50918');
});
test('old cached anonymous defaults migrate while published aqua themes remain intentional', () => {
  const cached = { version: 'old', banners: [], sections: [], theme: { tokens: policy.PRESETS['Classic Aqua'] }, validUntil: new Date(Date.now() + 30000).toISOString() };
  assert.equal(policy.freshExperience(cached), true);
  assert.equal(policy.normalizeExperience(cached).theme.tokens.header, '#79000B');
  assert.equal(policy.normalizeExperience({ ...cached, theme: { ...cached.theme, id: 'published' } }).theme.tokens.primary, '#087ea4');
});
test('legacy published tokens supply component roles without restoring mode-specific overrides', () => {
  const style = policy.themeStyle({ primary: '#116b52', secondary: '#073b78', accent: '#e0bc62' });
  assert.equal(style['--sf-action'], '#116b52'); assert.equal(style['--sf-header'], '#073b78');
  assert.equal(style['--sf-category-frame'], '#e0bc62'); assert.equal(style['--sf-nav-active'], '#116b52');
  assert.equal(style['--brand-aqua-light'], policy.DEFAULT_TOKENS.highlight);
});
test('provider revalidates publication changes on online and retains valid fallback during an outage', async () => {
  const h = browserHarness(Provider, {}, { activeMode: 'quick', activeSubNav: 'grocery--home' });
  const data = { version: 'active', theme: { id: 'published', tokens: policy.PRESETS['Eid Celebration'] }, banners: [], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 30000).toISOString() };
  try {
    h.requests[0].resolve({ data }); await h.settle(); assert.equal(h.tree.props.value.theme.tokens.primary, '#116b52');
    window.dispatchEvent(new Event('online')); await h.settle();
    h.requests.at(-1).resolve({ data: { ...data, version: 'paused', theme: { tokens: policy.DEFAULT_TOKENS } } }); await h.settle();
    assert.equal(h.tree.props.value.theme.tokens.primary, '#B50918');
    window.dispatchEvent(new Event('online')); await h.settle(); h.requests.at(-1).reject(new Error('Offline')); await h.settle();
    assert.equal(h.tree.props.value.theme.tokens.header, '#79000B');
  } finally { h.close(); }
});
test('an active cached campaign expires to red when subsequent configuration requests fail', async () => {
  const h = browserHarness(Provider, {}, { activeMode: 'quick', activeSubNav: 'grocery--home' });
  try {
    h.requests[0].resolve({ data: { version: 'short-campaign', theme: { id: 'published', tokens: policy.PRESETS['Eid Celebration'] }, banners: [banner], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 200).toISOString() } });
    await h.settle(); assert.equal(h.tree.props.value.theme.tokens.primary, '#116b52');
    await new Promise(resolve => setTimeout(resolve, 1150)); h.flush();
    h.requests.at(-1).reject(new Error('Offline')); await h.settle();
    assert.equal(h.tree.props.value.theme.tokens.primary, '#B50918'); assert.deepEqual(h.tree.props.value.banners, []);
  } finally { h.close(); }
});
test('IST scheduling does not depend on the browser workstation timezone', () => {
  assert.equal(Studio.scheduleISO('2030-01-01T05:30'), '2030-01-01T00:00:00.000Z'); assert.equal(Studio.scheduleInput('2030-01-01T00:00:00Z'), '2030-01-01T05:30');
});

test('campaign placement comes first and selecting Splash swaps the homepage mockup for a launch preview', async () => {
  const h = browserHarness(Studio.default, {}, { triggerToast() {}, setActiveTab() {} });
  try {
    h.click('Promotional campaigns');
    h.find(n => n.type === 'button' && n.props.className === 'sa-btn-primary').props.onClick(); h.flush();
    const fields = h.find(n => n.type === 'fieldset').props.children.flat(Infinity).filter(Boolean);
    assert.equal(fields[0].props.label, 'Placement');
    const placement = () => h.find(n => n.props?.label === 'Placement').props.children;
    assert.equal(placement().props.value, 'hero');
    for (const request of h.requests) request.resolve({ data: request.url.includes('/api/banners?') ? [{ ...banner, _id: banner.id, type: 'general', actionType: 'NONE' }] : [] });
    await h.settle();
    placement().props.onChange({ target: { value: 'splash' } }); h.flush();
    assert.ok(h.find(n => n.type === SplashPreview));
    assert.doesNotMatch(text(h.tree), /Shop by category|Published category artwork appears here/);
    const artwork = h.find(n => n.type === 'select' && [n.props.children].flat().some(option => option?.props?.value === banner.id));
    artwork.props.onChange({ target: { value: banner.id } }); h.flush();
    assert.equal(h.find(n => n.type === SplashPreview).props.banner._id, banner.id);
    h.click('Desktop'); assert.equal(h.find(n => n.type === SplashPreview).props.device, 'desktop');
    placement().props.onChange({ target: { value: 'hero' } }); h.flush();
    assert.equal(h.find(n => n.type === SplashPreview), undefined); assert.match(text(h.tree), /Shop by category/);
    assert.equal(h.requests.some(row => row.options.method && row.options.method !== 'GET'), false);
  } finally { h.close(); }
});

async function uploadCampaign(loadSelections = true) {
  const h = browserHarness(Studio.default, {}, { triggerToast() {}, setActiveTab() {} });
  h.click('Promotional campaigns');
  h.find(n => n.type === 'button' && n.props.className === 'sa-btn-primary').props.onClick(); h.flush();
  h.find(n => n.props?.label === 'Name').props.children.props.onChange({ target: { value: 'Diwali' } });
  h.find(n => n.props?.label === 'Placement').props.children.props.onChange({ target: { value: 'splash' } }); h.flush();
  if (loadSelections) {
    for (const request of h.requests) request.resolve({ data: [] });
    await h.settle();
  }
  h.click('+ Upload New Banner');
  h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [new File(['fixture image'], 'diwali.webp', { type: 'image/webp' })] } }); h.flush();
  return h;
}
const postRequests = h => h.requests.filter(r => r.options.method === 'POST');

for (const publish of [false, true]) test(`${publish ? 'Publish schedule' : 'Save draft'} uploads a selected image, attaches the returned ID and never saves a blob URL`, async () => {
  const h = await uploadCampaign();
  try {
    const local = h.find(n => n.type === SplashPreview).props.banner;
    assert.match(local.image, /^blob:/); assert.equal(local.title, 'Diwali');
    assert.match(text(h.tree), /upload and attach it automatically/);
    h.find(n => n.props?.label === 'Start · IST').props.children.props.onChange({ target: { value: '2030-01-01T05:30' } }); h.flush();
    const submit = publish ? h.find(n => n.type === 'button' && n.props.children === 'Publish schedule').props.onClick : () => h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    const pending = submit(); submit(); h.flush();
    assert.equal(postRequests(h).length, 1);
    const upload = postRequests(h)[0];
    assert.match(upload.url, /\/api\/banners$/); assert.ok(upload.options.body instanceof FormData);
    assert.equal(upload.options.body.get('image').name, 'diwali.webp');
    assert.equal(upload.options.body.get('placement'), 'STUDIO');
    assert.equal(upload.options.body.get('startDate'), '2030-01-01T00:00:00.000Z');
    assert.equal(new Headers(upload.options.headers).has('Content-Type'), false);
    assert.equal(h.find(n => n.type === 'fieldset').props.disabled, true);
    upload.resolve({ _id: banner.id, image: banner.image, title: 'Diwali', type: 'general' }, 201); await h.settle();
    const save = postRequests(h)[1], payload = JSON.parse(save.options.body);
    assert.match(save.url, /\/admin\/storefront$/);
    assert.equal(payload.config.bannerId, banner.id); assert.equal(payload.config.placement, 'splash');
    assert.equal(payload.startAt, '2030-01-01T00:00:00.000Z'); assert.doesNotMatch(save.options.body, /blob:/);
    save.resolve({ data: { _id: 'saved-campaign', revision: 1 } }, 201); await h.settle();
    if (publish) {
      const publication = postRequests(h)[2];
      assert.match(publication.url, /saved-campaign\/actions\/publish$/);
      publication.resolve({ data: { _id: 'saved-campaign', revision: 2 } });
    }
    await pending; await h.settle();
    assert.equal(postRequests(h).length, publish ? 3 : 2);
    assert.equal(h.find(n => n.type === SplashPreview), undefined);
  } finally { h.close(); }
});

test('an upload failure keeps the selected image for retry and blocks campaign creation/publication', async () => {
  const h = await uploadCampaign();
  try {
    const pending = h.click('Publish now');
    postRequests(h)[0].resolve({ message: 'Image upload service unavailable. Please try again.' }, 503);
    await pending; await h.settle();
    assert.match(text(h.find(n => n.type === 'footer')), /Image upload service unavailable/);
    assert.equal(postRequests(h).length, 1);
    assert.match(h.find(n => n.type === SplashPreview).props.banner.image, /^blob:/);
    const retry = h.click('Publish now');
    assert.equal(postRequests(h).length, 2);
    postRequests(h)[1].resolve({ message: 'Image upload service unavailable. Please try again.' }, 503);
    await retry; await h.settle();
    assert.equal(postRequests(h).every(r => /\/api\/banners$/.test(r.url)), true);
  } finally { h.close(); }
});

test('Upload & Link remains supported, survives a late banner-list response, and publishing reuses its saved banner', async () => {
  const h = await uploadCampaign(false);
  try {
    const button = h.find(n => n.type === 'button' && text(n) === '✓ Upload & Link to Campaign');
    const pending = button.props.onClick(); h.flush();
    // Clicking Publish during this upload must not create another upload or campaign.
    h.find(n => n.type === 'button' && n.props.children === 'Uploading…' && n.props.className === 'sa-btn-primary').props.onClick();
    assert.equal(postRequests(h).length, 1);
    postRequests(h)[0].resolve({ _id: banner.id, image: banner.image, type: 'general', title: 'Diwali' }); await pending; await h.settle();
    for (const request of h.requests.filter(r => !r.options.method || r.options.method === 'GET')) request.resolve({ data: [] });
    await h.settle();
    assert.equal(h.find(n => n.type === SplashPreview).props.banner._id, banner.id);
    const publication = h.click('Publish now');
    assert.match(postRequests(h)[1].url, /\/admin\/storefront$/);
    assert.equal(JSON.parse(postRequests(h)[1].options.body).config.bannerId, banner.id);
    postRequests(h)[1].resolve({ data: { _id: 'saved-campaign', revision: 1 } }); await h.settle();
    postRequests(h)[2].resolve({ data: { _id: 'saved-campaign', revision: 2 } }); await publication; await h.settle();
    assert.equal(postRequests(h).filter(r => /\/api\/banners$/.test(r.url)).length, 1);
  } finally { h.close(); }
});

test('a malformed upload response cannot be attached or published', async () => {
  const h = await uploadCampaign();
  try {
    const pending = h.click('Publish now'); postRequests(h)[0].resolve({ message: 'Unexpected response' });
    await pending; await h.settle();
    assert.match(text(h.tree), /upload did not return a saved banner/);
    assert.equal(postRequests(h).length, 1);
    assert.match(h.find(n => n.type === SplashPreview).props.banner.image, /^blob:/);
  } finally { h.close(); }
});

test('leaving upload mode discards and releases the local preview; unsupported images cannot be uploaded', async () => {
  const originalRevoke = URL.revokeObjectURL, revoked = [];
  URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url); };
  let h;
  try {
    h = await uploadCampaign();
    const local = h.find(n => n.type === SplashPreview).props.banner.image;
    h.click('Select Existing');
    assert.equal(h.find(n => n.type === SplashPreview).props.banner, undefined); assert.deepEqual(revoked, [local]);
    h.click('+ Upload New Banner');
    h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [new File(['svg'], 'wrong.svg', { type: 'image/svg+xml' })] } }); h.flush();
    assert.match(text(h.tree), /JPEG, PNG or WebP image up to 5 MB/);
    assert.equal(h.find(n => n.type === SplashPreview).props.banner, undefined);
    assert.equal(postRequests(h).length, 0);
  } finally { h?.close(); URL.revokeObjectURL = originalRevoke; }
});

test('splash preview auto-closes, replays and skips without consuming customer frequency or publishing', () => {
  const originalTimer = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = (callback, delay) => { callbacks.push({ callback, delay }); return 999990 + callbacks.length; };
  let h;
  try {
    const props = { banner, config: { frequency: 'session', duration: 2 }, device: 'mobile' };
    h = browserHarness(SplashPreview, props, {});
    assert.equal(h.find(n => n.type === SplashCard).props.device, 'mobile');
    assert.equal(callbacks[0].delay, 2000);
    props.device = 'desktop'; h.rerender(); assert.equal(callbacks.length, 2);
    callbacks[1].callback(); h.flush(); assert.equal(h.find(n => n.type === SplashCard), undefined);
    h.click('Replay splash'); assert.ok(h.find(n => n.type === SplashCard)); assert.equal(callbacks.length, 3);
    h.rerender(); assert.equal(callbacks.length, 3);
    const card = SplashCard(h.find(n => n.type === SplashCard).props);
    h.find(n => n.props?.['aria-label'] === 'Close promotion', card).props.onClick(); h.flush();
    assert.equal(h.find(n => n.type === SplashCard), undefined);
    assert.equal(window.sessionStorage.getItem(policy.frequencyKey(splash('session'))), null);
    assert.equal(window.localStorage.getItem(policy.frequencyKey(splash('daily'))), null);
    assert.equal(h.requests.length, 0);
  } finally { h?.close(); globalThis.setTimeout = originalTimer; }
});

test('splash preview updates artwork, device and duration and keeps Escape inside the editor', () => {
  const props = { banner, config: { duration: 2 }, device: 'mobile' };
  const h = browserHarness(SplashPreview, props, {});
  try {
    h.find(n => n.type === SplashCard).props.onDismiss(); h.flush();
    props.banner = { ...banner, id: 'replacement', mobileImage: 'https://fixture.test/mobile.webp' };
    props.device = 'desktop'; props.config = { duration: 15, countdown: true }; props.endAt = new Date(Date.now() + 60000).toISOString(); h.rerender();
    const card = h.find(n => n.type === SplashCard);
    assert.equal(card.props.banner.id, 'replacement'); assert.equal(card.props.device, 'desktop'); assert.equal(card.props.showCountdown, true);
    assert.match(text(h.tree), /15\s+seconds/);
    let stopped = false;
    h.find(n => n.props?.className === 'studio-splash-stage').props.onKeyDown({ key: 'Escape', stopPropagation() { stopped = true; } }); h.flush();
    assert.equal(stopped, true); assert.equal(h.find(n => n.type === SplashCard), undefined);
    h.click('Replay splash'); const next = SplashCard(h.find(n => n.type === SplashCard).props);
    h.find(n => n.props?.className === 'sf-cta', next).props.onClick(); h.flush();
    assert.equal(h.find(n => n.type === SplashCard), undefined); assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});

test('an empty splash preview asks for artwork and cannot replay', () => {
  const h = browserHarness(SplashPreview, { config: { duration: 5 }, device: 'mobile' }, {});
  try {
    assert.equal(h.find(n => n.type === SplashCard), undefined);
    assert.match(text(h.tree), /Select or upload a banner/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Replay splash').props.disabled, true);
  } finally { h.close(); }
});
test('splash closes with skip and does not reopen after subsequent rerenders', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, device: 'mobile', activeNav: 'home' };
  const h = browserHarness(Splash, {}, context);
  try { const card = SplashCard(h.find(n => n.type === SplashCard).props); assert.ok(h.find(n => n.props?.['aria-label'] === 'Close promotion', card)); h.find(n => n.props?.['aria-label'] === 'Close promotion', card).props.onClick(); h.flush(); assert.equal(h.tree, null); context.now++; h.rerender(); assert.equal(h.tree, null); } finally { h.close(); }
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
  try { const card = SplashCard(h.find(n => n.type === SplashCard).props); h.find(n => n.props?.className === 'sf-cta', card).props.onClick(); h.flush(); assert.equal(target, 'categories'); assert.equal(h.tree, null); } finally { h.close(); }
});
test('reduced motion prevents video creation; image failure produces text fallback', () => {
  const h = browserHarness(Media, { banner: { ...banner, video: 'https://fixture.test/clip.mp4' }, device: 'mobile' }, {}, true);
  try { assert.equal(h.tree.type, 'img'); h.tree.props.onError(); h.flush(); assert.equal(h.tree.props.role, 'img'); assert.match(text(h.tree), /Published banner/); } finally { h.close(); }
});
test('video load failure falls back to its static poster', () => {
  const h = browserHarness(Media, { banner: { ...banner, video: 'https://fixture.test/clip.mp4' } }, {});
  try { assert.equal(h.tree.type, 'video'); assert.equal(h.tree.props.muted, true); h.tree.props.onError(); h.flush(); assert.equal(h.tree.type, 'img'); assert.equal(h.tree.props.src, banner.image); } finally { h.close(); }
});
test('video fallback restores focus before removing focused native controls', () => {
  const h = browserHarness(Media, { banner: { ...banner, video: 'https://fixture.test/clip.mp4' } }, {});
  let focused = false;
  try {
    const element = { closest: () => ({ querySelector: () => ({ focus: () => { focused = true; } }) }), play: () => Promise.resolve(), pause() {}, removeAttribute() {}, load() {} };
    h.tree.props.ref.current = element; document.activeElement = element;
    h.tree.props.onError(); h.flush(); assert.equal(focused, true); assert.equal(h.tree.type, 'img');
  } finally { h.close(); }
});
test('the default banner is replaced by admin banners and restored when none remain', () => {
  let destination;
  const context = { banners: [], device: 'mobile', loading: false, setActiveNav: value => { destination = value; } }, h = browserHarness(Hero, {}, context);
  try {
    assert.equal(h.tree.props['aria-label'], 'Welcome to Bulkimart');
    assert.match(h.find(n => n.type === 'img').props.src, /banner1\.png/);
    h.find(n => n.props?.['aria-label'] === 'Explore products').props.onClick();
    assert.equal(destination, 'categories');
    assert.doesNotMatch(text(h.tree), /\d+%|sale|ends in/i);
    context.banners = [banner, { ...banner, id: 'second' }]; h.rerender();
    assert.equal(h.tree.props['aria-label'], 'Featured promotions');
    assert.doesNotMatch(text(h.tree), /Everyday finds/);
    h.find(n => n.props?.['aria-label'] === 'Next promotion').props.onClick(); h.flush(); assert.match(text(h.tree), /2\s+\/\s+2/);
    context.banners = []; h.rerender(); assert.equal(h.tree.props['aria-label'], 'Welcome to Bulkimart');
  } finally { h.close(); }
});

test('header categories have no fabricated fallback, show every selected category and navigate to the real record', () => {
  let selected;
  const context = { headerCategories: [], activeSubNav: 'grocery--home', setActiveSubNav: slug => { selected = slug; } };
  const h = browserHarness(HeaderCategories, {}, context);
  try {
    assert.equal(h.tree, null);
    context.headerCategories = Array.from({ length: 8 }, (_, i) => ({ _id: `category-${i}`, name: `Admin category ${i}`, slug: `grocery--category-${i}` }));
    h.rerender();
    const buttons = h.tree;
    assert.equal(buttons.length, 8);
    assert.match(buttons[0].props.className, /sub-nav-item-btn header-category-tab/);
    assert.equal(buttons[0].props['data-category-id'], context.headerCategories[0]._id);
    buttons[7].props.onClick(); assert.equal(selected, context.headerCategories[7].slug);
    context.activeSubNav = selected; h.rerender();
    assert.equal(h.tree[7].props['aria-current'], 'page');
    context.headerCategories = []; h.rerender(); assert.equal(h.tree, null);
  } finally { h.close(); }
});
test('bottom navigation replaces Cart with Profile and opens the existing account page', () => {
  let target;
  const context = { activeNav: 'home', setActiveNav: value => { target = value; } };
  const h = browserHarness(BottomNav, {}, context);
  try {
    const buttons = h.tree.props.children;
    assert.deepEqual(buttons.map(button => button.props.children[1].props.children), ['Home', 'Categories', 'Orders', 'Profile']);
    buttons[3].props.onClick(); assert.equal(target, 'account');
    context.activeNav = 'account'; h.rerender();
    assert.equal(h.tree.props.children[3].props['aria-current'], 'page');
  } finally { h.close(); }
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
    h.requests[0].resolve({ data: [{ code: 'REAL', title: 'Published coupon', applicable: false, reason: 'Minimum basket not reached', expiresAt: new Date(context.now + 1000).toISOString() },
      { code: 'UNLISTED', title: 'Unlisted coupon', isPublic: false, applicable: true, savingNow: 100 }] }); await h.settle();
    assert.doesNotMatch(text(h.tree), /UNLISTED|Unlisted coupon/);
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
