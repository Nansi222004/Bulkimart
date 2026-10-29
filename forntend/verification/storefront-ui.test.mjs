import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { createServer } from 'vite';
import { hookHarness, registerFeedback } from './componentHarness.mjs';
import { DEFAULT_EFFECT } from '../../backend/shared/celebration.mjs';
let Celebration, EffectFields, MediaFields, Festive, HeaderFields, LAYER;
let vite, policy, Splash, SplashCard, SplashPreview, Media, Hero, HeaderCategories, BottomNav, Card, Section, navigateHook, Provider, Studio, Coupons, catalog;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  policy = await vite.ssrLoadModule('/src/utils/storefront.js');
  registerFeedback((await vite.ssrLoadModule('/src/utils/feedback.js')).feedback);
  ({ default: Celebration, LAYER_STYLE: LAYER } = await vite.ssrLoadModule('/src/modules/User/components/Celebration.jsx'));
  Festive = await vite.ssrLoadModule('/src/modules/User/components/FestiveHeader.jsx');
  HeaderFields = (await vite.ssrLoadModule('/src/modules/Admin/components/StorefrontHeaderFields.jsx')).default;
  EffectFields = (await vite.ssrLoadModule('/src/modules/Admin/components/StorefrontEffectFields.jsx')).default;
  MediaFields = (await vite.ssrLoadModule('/src/modules/Admin/components/StorefrontMediaFields.jsx')).default;
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
const homeContent = h => h.find(n => n.props?.className === 'sf-launch-content')?.props.children;
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
    h.requests[0].resolve({ data: { version: 'short-campaign', theme: { id: 'published', tokens: policy.PRESETS['Eid Celebration'] }, banners: [banner], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 200).toISOString(), scheduleUntil: new Date(Date.now() + 200).toISOString() } });
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
    assert.equal(h.find(n => n.type === SplashPreview).props.device, 'mobile');
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Desktop'), undefined, 'A splash has no desktop preview');
    assert.match(text(h.tree), /shows only when the app opens on a phone/);
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
test('hero video and effect preview stay local; draft upload is always Studio-only artwork', async () => {
  const h = await uploadCampaign();
  try {
    h.find(n => n.props?.label === 'Placement').props.children.props.onChange({ target: { value: 'hero' } }); h.flush();
    h.find(n => n.type === MediaFields).props.onChange({ mediaType: 'video', video: 'https://fixture.test/wide.mp4', mobileVideo: 'https://fixture.test/mobile.webm', loop: false });
    h.find(n => n.type === EffectFields).props.onChange({ ...DEFAULT_EFFECT, enabled: true, preset: 'petals', scope: 'banner' }); h.flush();
    assert.equal(postRequests(h).length, 0);
    assert.equal(h.find(n => n.type === Media).props.banner.mobileVideo, 'https://fixture.test/mobile.webm');
    assert.equal(h.find(n => n.type === Celebration && n.props.effect).props.effect.preset, 'petals');
    const pending = h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    const upload = postRequests(h)[0]; assert.equal(upload.options.body.get('placement'), 'STUDIO'); assert.equal(upload.options.body.get('mediaType'), 'video'); assert.equal(upload.options.body.get('loop'), 'false');
    upload.resolve({ ...banner, _id: banner.id }); await h.settle();
    const save = postRequests(h)[1]; const payload = JSON.parse(save.options.body);
    assert.equal(payload.config.animation.preset, 'petals');
    save.resolve({ data: { ...payload, _id: 'saved', revision: 1 } }); await pending;
    assert.equal(postRequests(h).length, 2);
  } finally { h.close(); }
});
test('a published effect always plays with no customer opt-out; reduced motion and expiry suppress canvas', () => {
  for (const [effect, reduced] of [[{ ...DEFAULT_EFFECT, enabled: true }, true], [{ ...DEFAULT_EFFECT, enabled: false }, false], [{ ...DEFAULT_EFFECT, enabled: true, endAt: new Date(Date.now() - 1).toISOString() }, false]]) {
    const h = browserHarness(Celebration, { effect }, {}, reduced); try { assert.equal(h.tree, null); } finally { h.close(); }
  }
  const h = browserHarness(Celebration, { effect: { ...DEFAULT_EFFECT, enabled: true } }, {});
  try {
    // An opt-out stored by an earlier version is ignored.
    localStorage.setItem('bulkimart:decorations-disabled', '1'); window.dispatchEvent(new CustomEvent('bulkimart:decorations', { detail: true })); h.rerender();
    assert.equal(h.tree.type, 'canvas'); assert.equal(h.tree.props.style.pointerEvents, 'none');
    assert.equal(h.requests.length, 0);
  } finally { h.close(); }
});
test('responsive video selects the mobile source, honors playback settings, and retains image compatibility', () => {
  const props = { banner: { ...banner, mediaType: 'video', video: 'https://fixture.test/wide.mp4', mobileVideo: 'https://fixture.test/mobile.webm', mobileImage: 'https://fixture.test/mobile.webp', loop: false, autoplay: false }, device: 'mobile' };
  const h = browserHarness(Media, props, {});
  try {
    assert.equal(h.tree.props.src, props.banner.mobileVideo); assert.equal(h.tree.props.poster, props.banner.mobileImage); assert.equal(h.tree.props.loop, false); assert.equal(h.tree.props.autoPlay, false);
    props.device = 'desktop'; h.rerender(); assert.equal(h.tree.props.src, props.banner.video);
    props.banner.mediaType = 'image'; h.rerender(); assert.equal(h.tree.type, 'img'); assert.equal(h.tree.props.src, banner.image);
  } finally { h.close(); }
});
test('autoplay rejection falls back to poster and releases native playback/listeners', async () => {
  const props = { banner: { ...banner, video: 'https://fixture.test/clip.mp4', autoplay: false }, eager: true };
  const h = browserHarness(Media, props, {}); let pauses = 0, releases = 0;
  try {
    const element = new EventTarget(); Object.assign(element, { play: () => Promise.reject(new Error('autoplay blocked')), pause() { pauses++; }, removeAttribute() {}, load() { releases++; }, readyState: 0 });
    h.tree.props.ref.current = element;
    props.banner.autoplay = true; h.rerender(); await h.settle();
    assert.equal(h.tree.type, 'img'); assert.equal(h.tree.props.src, banner.image); assert.equal(pauses, 1); assert.equal(releases, 1);
    document.dispatchEvent(new Event('visibilitychange')); assert.equal(pauses, 1);
  } finally { h.close(); }
});
test('video sources remain unloaded until intersection and release when scrolled away', () => {
  const old = globalThis.IntersectionObserver; let notify, disconnected = 0;
  globalThis.IntersectionObserver = class { constructor(callback) { notify = callback; } observe() {} disconnect() { disconnected++; } };
  const props = { banner: { ...banner, video: 'https://fixture.test/clip.mp4', autoplay: false } };
  const h = browserHarness(Media, props, {}); let pauses = 0;
  try {
    assert.equal(h.tree.props.src, undefined); assert.equal(h.tree.props.preload, 'none');
    const element = new EventTarget(); Object.assign(element, { play: () => Promise.resolve(), pause() { pauses++; }, removeAttribute() {}, load() {}, readyState: 2 });
    h.tree.props.ref.current = element; props.banner.video = 'https://fixture.test/new.mp4'; h.rerender();
    notify([{ isIntersecting: true }]); h.flush(); assert.equal(h.tree.props.src, props.banner.video);
    notify([{ isIntersecting: false }]); h.flush(); assert.equal(h.tree.props.src, undefined); assert.equal(pauses, 1);
    h.unmount(); assert.equal(disconnected, 1);
  } finally { h.close(); if (old) globalThis.IntersectionObserver = old; else delete globalThis.IntersectionObserver; }
});
test('unchanged configuration refresh does not duplicate loops; updates and disable clean up the previous renderer', () => {
  const props = { effect: { ...DEFAULT_EFFECT, enabled: true } }, h = browserHarness(Celebration, props, {});
  const frames = new Map(); let sequence = 0, clears = 0;
  try {
    window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
    window.cancelAnimationFrame = id => frames.delete(id);
    const context = new Proxy({}, { get: (_target, key) => () => { if (key === 'clearRect') clears++; } });
    h.tree.props.ref.current = { ownerDocument: document, getContext: () => context, getBoundingClientRect: () => ({ width: 390, height: 500 }) };
    props.effect = { ...props.effect, speed: 2 }; h.rerender(); assert.equal(frames.size, 1);
    props.effect = { ...props.effect }; h.rerender(); assert.equal(sequence, 1); assert.equal(frames.size, 1);
    props.effect = { ...props.effect, density: 20 }; h.rerender(); assert.equal(sequence, 2); assert.equal(frames.size, 1); assert.equal(clears, 1);
    props.effect = { ...props.effect, enabled: false }; h.rerender(); assert.equal(h.tree, null); assert.equal(frames.size, 0); assert.equal(clears, 2);
    h.unmount(); document.dispatchEvent(new Event('visibilitychange')); assert.equal(frames.size, 0);
  } finally { h.close(); }
});
test('media controls reject executable and oversized uploads, report server errors, and persist only returned URLs', async () => {
  const changes = [], busy = [], h = browserHarness(MediaFields, { value: { mediaType: 'video' }, onChange: patch => changes.push(patch), onBusy: value => busy.push(value) }, {});
  try {
    const input = () => h.find(n => n.type === 'input' && n.props['aria-label'] === 'Upload Desktop video (required)');
    input().props.onChange({ target: { files: [new File(['<script/>'], 'bad.svg', { type: 'image/svg+xml' })] } }); h.flush();
    assert.match(text(h.tree), /MP4 or WebM up to 15 MB/); assert.equal(h.requests.length, 0);
    input().props.onChange({ target: { files: [{ type: 'video/mp4', size: 16 * 1024 * 1024 }] } }); h.flush(); assert.equal(h.requests.length, 0);
    const file = new File(['fixture video'], 'clip.mp4', { type: 'video/mp4' });
    input().props.onChange({ target: { files: [file] } }); h.flush();
    assert.match(h.requests[0].url, /\/api\/admin\/storefront\/media$/); assert.equal(h.requests[0].options.body.get('media').name, 'clip.mp4');
    h.requests[0].resolve({ message: 'Video upload unavailable' }, 503); await h.settle(); assert.match(text(h.tree), /Video upload unavailable/); assert.equal(changes.length, 0);
    input().props.onChange({ target: { files: [file] } }); h.flush();
    h.requests[1].resolve({ data: { type: 'video', url: 'https://cdn.test/clip.mp4' } }); await h.settle();
    assert.deepEqual(changes, [{ video: 'https://cdn.test/clip.mp4' }]); assert.deepEqual(busy, [true, false, true, false]);
  } finally { h.close(); }
});

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
    // Studio artwork follows the campaign schedule, so the banner carries no dates of its own.
    assert.equal(upload.options.body.get('startDate'), null); assert.equal(upload.options.body.get('endDate'), null);
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

test('splash preview auto-closes and replays without consuming customer frequency or publishing', () => {
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
    callbacks[2].callback(); h.flush();
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
    h.find(n => n.props?.className === 'studio-splash-stage').props.onKeyDown({ key: 'Escape', stopPropagation() {} }); h.flush();
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
test('launch artwork has no title panel or Skip button; an informational splash shows only artwork', () => {
  const card = SplashCard({ banner: { ...banner, subtitle: 'Private preview subtitle', destination: { type: 'NONE' } }, device: 'mobile' });
  const h = browserHarness(() => card, {}, {});
  try {
    assert.ok(h.find(n => n.type === Media && n.props.banner.image === banner.image && n.props.eager));
    assert.equal(h.find(n => n.type === 'h2'), undefined);
    assert.equal(h.find(n => n.props?.className === 'sf-splash-actions'), undefined);
    assert.doesNotMatch(text(card), /BULKIMART PICKS|Published banner|Private preview subtitle/);
    assert.equal(h.find(n => n.type === 'button'), undefined);
  } finally { h.close(); }
});

test('optional splash countdown and destination remain accessible over the artwork without a copy panel', () => {
  const now = Date.now(); let target;
  const card = SplashCard({ banner, now, endAt: new Date(now + 61000).toISOString(), showCountdown: true, onNavigate(value) { target = value; } });
  const h = browserHarness(() => card, {}, {});
  try {
    assert.match(text(card), /Ends in.*00:01:01/);
    assert.equal(h.find(n => n.props?.className === 'sf-splash-copy'), undefined);
    const actions = h.find(n => n.props?.className === 'sf-splash-actions');
    h.find(n => n.props?.className === 'sf-cta', actions).props.onClick(); assert.deepEqual(target, banner.destination);
  } finally { h.close(); }
});

test('mobile starts with the splash and prepares inert home content until auto-close', () => {
  const originalTimer = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = (callback, delay) => { callbacks.push({ callback, delay }); return 999990 + callbacks.length; };
  const children = createElement('main', { id: 'deferred-home' });
  const context = { loading: true, splash: null, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  let h;
  try {
    h = browserHarness(Splash, { children }, context);
    assert.equal(h.tree, null, 'Mobile never renders the logo loader');
    assert.equal(h.find(n => n.props?.id === 'deferred-home'), undefined);
    context.loading = false; context.version = 'published'; context.splash = splash('launch'); h.rerender();
    assert.ok(h.find(n => n.type === SplashCard));
    assert.equal(homeContent(h), children, 'Home mounts behind the splash');
    const background = h.find(n => n.props?.className === 'sf-launch-content');
    assert.equal(background.props.inert, true); assert.equal(background.props['aria-hidden'], true);
    assert.equal(background.props.style.display, 'none');
    assert.equal(callbacks[0].delay, 15000); callbacks[0].callback(); h.flush();
    assert.equal(homeContent(h), children);
    assert.equal(h.find(n => n.props?.className === 'sf-launch-content').props.inert, undefined);
    context.now++; context.loading = true; h.rerender(); assert.equal(homeContent(h), children);
  } finally { h?.close(); globalThis.setTimeout = originalTimer; }
});

test('a fresh cached splash opens before background revalidation finishes', () => {
  const children = createElement('main');
  const context = { loading: true, version: 'fresh-cache', splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  const h = browserHarness(Splash, { children }, context);
  try {
    assert.ok(h.renders[0].props.children[1], 'The cached splash is present on the first render');
    assert.ok(h.find(n => n.type === SplashCard)); assert.notEqual(h.tree, children);
    const event = new Event('keydown'); Object.defineProperty(event, 'key', { value: 'Escape' }); document.dispatchEvent(event); h.flush();
    assert.equal(homeContent(h), children);
  } finally { h.close(); }
});

test('a fresh persistent experience is available on the first provider render and is still revalidated', () => {
  const cached = { version: 'persisted', banners: [], sections: [], splash: splash('launch'), serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 30000).toISOString() };
  let seeded = false;
  const CachedProvider = props => {
    if (!seeded) { seeded = true; window.localStorage.setItem('bulkimart:experience:quick:mobile:', JSON.stringify(cached)); }
    return Provider(props);
  };
  const h = browserHarness(CachedProvider, {}, { activeMode: 'quick', activeSubNav: 'grocery--home' }, true);
  try {
    assert.equal(h.renders[0].props.value.version, 'persisted');
    assert.equal(h.renders[0].props.value.splash.id, cached.splash.id);
    assert.equal(h.requests.length, 1, 'The server still checks publication changes');
  } finally { h.close(); }
});

test('persistent startup cache rejects expired, scheduled-out, malformed and inaccessible data', () => {
  const h = browserHarness(() => null, {}, {});
  const key = 'quick:mobile:', cacheKey = `bulkimart:experience:${key}`;
  const data = { version: 'cached', banners: [], sections: [], validUntil: new Date(Date.now() + 30000).toISOString() };
  try {
    policy.rememberExperience(key, data);
    assert.equal(policy.readExperience(key).version, 'cached');
    assert.equal(policy.readExperience('shop-all:mobile:'), null, 'Caches stay scoped to the storefront');
    for (const invalid of [{ ...data, validUntil: new Date(Date.now() - 1).toISOString() }, { ...data, scheduleUntil: new Date(Date.now() - 1).toISOString() }]) {
      policy.rememberExperience(key, invalid); assert.equal(policy.readExperience(key), null);
    }
    window.sessionStorage.setItem(cacheKey, '{broken'); window.localStorage.setItem(cacheKey, '{broken');
    assert.equal(policy.readExperience(key), null);
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new Error('denied'); } });
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('denied'); } });
    assert.doesNotThrow(() => policy.rememberExperience(key, data)); assert.equal(policy.readExperience(key), null);
  } finally { h.close(); }
});

test('mobile never waits for the hero image after the splash closes', () => {
  const previous = globalThis.Image;
  globalThis.Image = class {};
  const children = createElement('main');
  const context = { loading: false, version: 'live', splash: splash('launch'), banners: [banner], now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  let h;
  try {
    h = browserHarness(Splash, { children }, context);
    const event = new Event('keydown'); Object.defineProperty(event, 'key', { value: 'Escape' }); document.dispatchEvent(event); h.flush();
    assert.equal(homeContent(h), children);
    assert.equal(h.find(n => n.type?.name === 'StoreLoading'), undefined);
  } finally { h?.close(); globalThis.Image = previous; }
});

for (const reason of ['no campaign', 'already seen', 'future', 'expired']) test(`${reason} releases home without a splash`, () => {
  const children = createElement('main');
  const context = { loading: true, splash: null, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  const h = browserHarness(Splash, { children }, context);
  try {
    if (reason !== 'no campaign') {
      context.splash = splash('session');
      if (reason === 'already seen') policy.markSplash(context.splash, { session: window.sessionStorage });
      if (reason === 'future') context.splash.startAt = new Date(context.now + 60000).toISOString();
      if (reason === 'expired') context.splash.endAt = new Date(context.now - 1).toISOString();
    }
    context.loading = false; h.rerender(); assert.equal(homeContent(h), children);
  } finally { h.close(); }
});

for (const route of [{ activeNav: 'checkout' }, { activeNav: 'home', productDetailLoading: true }, { activeNav: 'home', selectedCampaignId: 'deal' }, { activeNav: 'home', selectedOrder: {} }]) test(`startup does not block an existing deep link: ${JSON.stringify(route)}`, () => {
  const children = createElement('main');
  const h = browserHarness(Splash, { children }, { loading: true, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, device: 'mobile', ...route });
  try { assert.equal(homeContent(h), children); } finally { h.close(); }
});

test('startup configuration times out after three seconds and late responses cannot restore it', async () => {
  const originalTimer = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 3000) { callbacks.push(callback); return 999990 + callbacks.length; }
    return originalTimer(callback, delay, ...args);
  };
  let h;
  try {
    h = browserHarness(Provider, {}, { activeMode: 'quick', activeSubNav: 'grocery--home' });
    assert.equal(h.tree.props.value.loading, true); assert.equal(callbacks.length, 1);
    assert.equal(h.requests[0].options.priority, 'high');
    callbacks[0](); await h.settle();
    assert.equal(h.tree.props.value.loading, false); assert.equal(h.tree.props.value.splash, null);
    h.requests[0].resolve({ data: { version: 'too-late', splash: splash('launch'), banners: [], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 30000).toISOString() } }); await h.settle();
    assert.equal(h.tree.props.value.splash, null);
  } finally { h?.close(); globalThis.setTimeout = originalTimer; }
});

test('splash artwork requests high image priority while ordinary media remains lazy', () => {
  const h = browserHarness(Media, { banner, device: 'mobile', eager: true }, {});
  try { assert.equal(h.tree.props.loading, 'eager'); assert.equal(h.tree.props.fetchPriority, 'high'); } finally { h.close(); }
  const ordinary = browserHarness(Media, { banner, device: 'mobile' }, {});
  try { assert.equal(ordinary.tree.props.loading, 'lazy'); assert.equal(ordinary.tree.props.fetchPriority, 'auto'); } finally { ordinary.close(); }
});

test('splash auto-closes without Skip and does not reopen after subsequent rerenders', () => {
  const originalTimer = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = (callback, delay) => { callbacks.push({ callback, delay }); return 999990 + callbacks.length; };
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, device: 'mobile', activeNav: 'home' };
  let h;
  try {
    h = browserHarness(Splash, {}, context);
    const card = SplashCard(h.find(n => n.type === SplashCard).props);
    assert.equal(h.find(n => n.props?.['aria-label'] === 'Close promotion', card), undefined);
    assert.equal(callbacks[0].delay, 15000);
    callbacks[0].callback(); h.flush(); assert.equal(h.tree, null);
    context.now++; h.rerender(); assert.equal(h.tree, null);
  } finally { h?.close(); globalThis.setTimeout = originalTimer; }
});
test('Escape and expiry dismiss the actual splash', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' }, h = browserHarness(Splash, {}, context);
  try { const event = new Event('keydown'); Object.defineProperty(event, 'key', { value: 'Escape' }); document.dispatchEvent(event); h.flush(); assert.equal(h.tree, null); } finally { h.close(); }
  const h2 = browserHarness(Splash, {}, context); try { context.now += 120000; h2.rerender(); assert.equal(h2.tree, null); } finally { h2.close(); }
});
test('no splash on product detail or checkout and a pause dismisses the overlay', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'checkout', device: 'mobile' }, h = browserHarness(Splash, {}, context);
  try { assert.equal(h.tree, null); context.activeNav = 'home'; context.selectedProduct = {}; h.rerender(); assert.equal(h.tree, null); context.selectedProduct = null; h.rerender(); assert.ok(h.tree); context.splash = null; h.rerender(); assert.equal(h.tree, null); } finally { h.close(); }
});
test('splash CTA closes and invokes the supported existing destination', () => {
  let target; const h = browserHarness(Splash, {}, { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile', setActiveNav: value => { target = value; } });
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
    assert.match(h.find(n => n.type === 'img').props.src, /banner1\.webp/);
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
test('a launch splash does not return when sign-in remounts the storefront in the same launch', () => {
  const context = { splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  const first = browserHarness(Splash, {}, context); let guard;
  try { assert.ok(first.tree, 'Shown on launch'); guard = window.__bulkimartSplashShown; assert.ok(guard); } finally { first.close(); }
  // CustomerSessionGate remounts the tree after login; the page (window) is the same launch.
  // The harness builds a fresh window per mount; carry the guard into it as the real page would.
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window'); let current = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, get: () => current, set: value => { if (value && typeof value === 'object') value.__bulkimartSplashShown = guard; current = value; } });
  let remount;
  try { remount = browserHarness(Splash, {}, context); assert.equal(remount.find(n => n.props?.className === 'sf-splash'), undefined); assert.notEqual(remount.tree?.props?.className, 'sf-splash'); }
  finally { remount?.close(); Object.defineProperty(globalThis, 'window', descriptor || { configurable: true, writable: true, value: current }); }
  const nextLaunch = browserHarness(Splash, {}, context);
  try { assert.ok(nextLaunch.find(n => n.props?.className === 'sf-splash') || nextLaunch.tree?.props?.className === 'sf-splash', 'A new launch still shows it'); } finally { nextLaunch.close(); }
});

// Festive header: decorative animation is confined to bounded hosts.
const festiveHeader = (patch = {}) => ({ ...policy.DEFAULT_HEADER, enabled: true, title: 'Festive Sale', subtitle: 'Lights, gifts and more', target: 'categories', cta: 'Shop now', ...patch });
const liveEffect = { ...DEFAULT_EFFECT, enabled: true, preset: 'lights', scope: 'homepage', id: 'theme', revision: 1 };
test('boundary: the decorative layer is absolute inside its host, never viewport-fixed, and ignores pointer input', async () => {
  const h = browserHarness(Celebration, { effect: { ...DEFAULT_EFFECT, enabled: true } }, {});
  try { assert.equal(h.tree.props.style.position, 'absolute'); assert.equal(h.tree.props.style.inset, 0); assert.equal(h.tree.props.style.pointerEvents, 'none'); } finally { h.close(); }
  assert.equal(LAYER.position, 'absolute');
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/modules/User/components/Celebration.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"]fixed['"]/, 'Celebration has no viewport-fixed mode');
  const css = await readFile(new URL('../src/modules/User/Storefront.css', import.meta.url), 'utf8');
  assert.match(css, /\.sf-festive\{[^}]*position:relative[^}]*overflow:hidden[^}]*contain:paint/);
  assert.doesNotMatch(css, /\.sf-(celebration|decoration-toggle|festive)[^{]*\{[^}]*position:fixed/, 'No festive selector is viewport-fixed');
  assert.match(css, /\.sf-festive-content\{[^}]*z-index:2/, 'Header copy sits above the decorative layer');
});
test('boundary: the storefront provider exposes the page effect but mounts no overlay of its own', async () => {
  const h = browserHarness(Provider, {}, { activeMode: 'shop-all', activeSubNav: 'ecommerce--smart-buy', activeNav: 'home' });
  try {
    h.requests[0].resolve({ data: { version: 'fx', animations: [liveEffect], theme: { id: 'published', tokens: policy.DEFAULT_TOKENS, header: festiveHeader() }, banners: [], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 30000).toISOString() } });
    await h.settle();
    assert.equal(h.tree.props.value.effect.preset, 'lights');
    assert.equal(h.find(n => n.type === Celebration || n.type === 'canvas'), undefined);
  } finally { h.close(); }
});
test('festive header renders copy, CTA and a bounded animation with no customer opt-out', () => {
  let destination;
  const props = { header: festiveHeader({ height: 220, background: '#123b5c', text: '#ffffff' }), effect: liveEffect, now: Date.now(), onNavigate: d => { destination = d; } };
  const h = browserHarness(Festive.FestiveHeader, props, {});
  try {
    assert.equal(h.tree.type, 'section'); assert.equal(h.tree.props.className, 'sf-festive');
    assert.equal(h.tree.props.style['--sf-festive-height'], '220px'); assert.equal(h.tree.props.style['--sf-festive-bg'], '#123b5c');
    assert.equal(h.find(n => n.type === Celebration).props.effect.preset, 'lights');
    assert.equal(h.find(n => n.type === 'button' && /celebration/i.test(text(n))), undefined, 'No turn-off button');
    assert.match(text(h.tree), /Festive Sale/); assert.match(text(h.tree), /Lights, gifts and more/);
    h.find(n => n.type === 'button' && n.props.className === 'sf-cta').props.onClick(); assert.deepEqual(destination, { type: 'NAV', id: 'categories' });
    props.effect = null; props.header = festiveHeader({ target: 'none', cta: '' }); h.rerender();
    assert.equal(h.find(n => n.props?.className === 'sf-cta'), undefined);
  } finally { h.close(); }
});
test('countdown follows persisted sale dates before, during and after the sale and never goes negative', () => {
  const start = Date.parse('2030-11-01T00:00:00+05:30'), end = Date.parse('2030-11-03T00:00:00+05:30');
  const c = { ...policy.DEFAULT_COUNTDOWN, enabled: true, title: 'Big Sale', startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() };
  assert.deepEqual(policy.countdownState(c, start - 90061000), { phase: 'before', target: start, remaining: 90061000 });
  assert.deepEqual(policy.countdownParts(90061000), { days: 1, hours: 1, minutes: 1, seconds: 1 });
  assert.equal(policy.countdownState(c, start).phase, 'during'); assert.equal(policy.countdownState(c, end - 1).remaining, 1);
  assert.equal(policy.countdownState(c, end).phase, 'after'); assert.equal(policy.countdownState({ ...c, showRemaining: false }, start + 1).phase, 'live');
  assert.equal(policy.countdownState({ ...c, enabled: false }, start).phase, 'off');
  assert.deepEqual(policy.countdownParts(-5000), { days: 0, hours: 0, minutes: 0, seconds: 0 });
  const render = now => { const h = browserHarness(Festive.FestiveCountdown, { countdown: c, now }, {}); try { return h.tree ? text(h.tree) : null; } finally { h.close(); } };
  assert.match(render(start - 3723000), /Big Sale · Starts in.*01.*:.*02.*:.*03/);
  assert.match(render(end - 59000), /Ends in.*00.*:.*00.*:.*59/);
  assert.equal(render(end), null, 'Expired countdown hides by default');
  const h = browserHarness(Festive.FestiveCountdown, { countdown: { ...c, expiredText: 'Sale ended — thank you!' }, now: end + 1 }, {});
  try { assert.match(text(h.tree), /Sale ended/); } finally { h.close(); }
});
test('the page effect is hosted once: by the festive header when published, otherwise inside the top header', () => {
  const context = { banners: [banner], device: 'mobile', loading: false, now: Date.now(), effect: liveEffect, theme: { tokens: policy.DEFAULT_TOKENS } };
  const h = browserHarness(Hero, {}, context);
  try {
    const art = h.find(n => /^sf-hero-art( |$)/.test(n.props?.className || ''));
    assert.equal(art.props.children.find(n => n?.type === Celebration).props.effect, undefined, 'The hero never draws the page effect');
    assert.equal(h.find(n => n.type === 'button' && /celebration/i.test(text(n))), undefined, 'The hero has no turn-off button');
    context.theme = { tokens: policy.DEFAULT_TOKENS, header: festiveHeader() }; h.rerender();
    assert.equal(h.find(n => n.type === Celebration).props.effect, undefined, 'Festive header owns the page effect');
    context.banners = [{ ...banner, animation: { ...liveEffect, preset: 'petals', scope: 'banner' } }]; h.rerender();
    assert.equal(h.find(n => n.type === Celebration).props.effect.preset, 'petals', 'Banner-scoped effects stay on their banner');
  } finally { h.close(); }
  const connected = browserHarness(Festive.default, {}, { theme: { tokens: policy.DEFAULT_TOKENS }, effect: liveEffect, now: Date.now() });
  try { assert.equal(connected.tree, null, 'No festive header without published configuration'); } finally { connected.close(); }
});
const labelText = tree => { const out = []; const walk = n => { if (!n || typeof n !== 'object') return; if (n.type === 'label') out.push(text(n)); [n.props?.children].flat(Infinity).forEach(walk); }; walk(tree); return out.join('|'); };
test('admin effect fields show only settings relevant to the selected animation', () => {
  const props = { value: { ...DEFAULT_EFFECT, enabled: true, preset: 'petals' }, onChange: next => { props.value = next; } }, h = browserHarness(EffectFields, props, {});
  const preset = label => h.find(n => n.type === 'label' && text(n).trim() === label).props.children.find(n => n?.type === 'input');
  try {
    for (const label of [/Drift direction/, /Intensity/, /Particle quantity/, /Particle size/, /Reduced-motion fallback/]) assert.match(labelText(h.tree), label);
    preset('Flower petals').props.onChange(); h.rerender();
    preset('Fireworks').props.onChange(); h.rerender();
    assert.equal(props.value.preset, 'fireworks'); assert.deepEqual(props.value.presets, ['fireworks']); assert.deepEqual(props.value.colors, ['#FFD45A', '#FF6B6B', '#7FDBFF']);
    assert.doesNotMatch(labelText(h.tree), /Drift direction/); assert.match(labelText(h.tree), /Sparks per burst/);
    for (const label of ['Festive lights', 'Snowfall']) { preset(label).props.onChange(); h.rerender(); }
    assert.deepEqual(props.value.presets, ['fireworks', 'lights', 'snowfall'], 'Presets combine in selection order');
    assert.deepEqual(props.value.colors, ['#FFD45A', '#FF6B6B', '#7FDBFF'], 'Colours stay with the first preset');
    assert.match(labelText(h.tree), /Drift direction/); assert.equal(preset('Confetti').props.disabled, true, 'At most three presets');
    for (const label of ['Fireworks', 'Festive lights', 'Snowfall']) { preset(label).props.onChange(); h.rerender(); }
    assert.equal(props.value.enabled, false); assert.doesNotMatch(labelText(h.tree), /Intensity|Speed|Opacity/);
  } finally { h.close(); }
});
test('admin can create, edit, combine, reuse and delete custom animations', () => {
  const saved = { id: 'custom-old', name: 'Lanterns', motion: 'rise', shape: 'emoji', emoji: '🏮', colors: ['#FF4D4D'] };
  const props = { value: { ...DEFAULT_EFFECT, enabled: true, presets: ['lights'], preset: 'lights' }, onChange: next => { props.value = next; }, library: [saved, { ...saved }] };
  const h = browserHarness(EffectFields, props, {});
  const field = (label, type) => h.find(n => n.type === 'label' && text(n).trim().startsWith(label) && [n.props.children].flat().some(c => c?.type === type));
  try {
    h.click('+ Create custom animation'); h.rerender();
    const [mine] = props.value.customs;
    assert.match(mine.id, /^custom-[a-z0-9]+$/); assert.deepEqual(props.value.presets, ['lights', mine.id], 'A new animation is selected straight away');
    field('Shape', 'select').props.children[1].props.onChange({ target: { value: 'emoji' } }); h.rerender();
    field('Emoji or symbol', 'input').props.children[1].props.onChange({ target: { value: '🪔' } }); h.rerender();
    field('Motion', 'select').props.children[1].props.onChange({ target: { value: 'twinkle' } }); h.rerender();
    assert.deepEqual({ ...props.value.customs[0], id: undefined }, { id: undefined, name: 'Custom 1', motion: 'twinkle', shape: 'emoji', emoji: '🪔', colors: ['#FFD700', '#FF8A00'] });
    assert.match(labelText(h.tree), /Custom 1/, 'Custom animations are listed with the built-in types');
    const reuse = h.find(n => n.type === 'select' && n.props.value === '' && text(n).includes('Lanterns'));
    assert.equal(reuse.props.children[1].length, 1, 'Identical saved animations are offered once');
    reuse.props.onChange({ target: { value: '0' } }); h.rerender();
    assert.equal(props.value.customs[1].name, 'Lanterns'); assert.notEqual(props.value.customs[1].id, 'custom-old'); assert.equal(props.value.presets.length, 3);
    assert.equal(h.find(n => n.type === 'select' && text(n).includes('Lanterns')), undefined, 'Reused animations leave the reuse list');
    h.click(`Delete ${props.value.customs[0].name}`); h.rerender();
    assert.equal(props.value.customs.length, 1); assert.deepEqual(props.value.presets, ['lights', props.value.customs[0].id]);
    assert.deepEqual(props.value.colors, DEFAULT_EFFECT.colors, 'Built-in colours are untouched by custom animations');
  } finally { h.close(); }
});
test('admin header fields store IST sale dates and only reveal countdown settings when enabled', () => {
  const props = { value: festiveHeader(), onChange: next => { props.value = next; }, deals: [{ _id: '507f1f77bcf86cd799439099', name: 'Diwali deal' }] }, h = browserHarness(HeaderFields, props, {});
  try {
    assert.doesNotMatch(labelText(h.tree), /Sale start/);
    h.find(n => n.type === 'input' && n.props.type === 'checkbox' && n.props.checked === false).props.onChange({ target: { checked: true } }); h.rerender();
    assert.equal(props.value.countdown.enabled, true); assert.match(labelText(h.tree), /Sale start · IST/);
    h.find(n => n.type === 'input' && n.props.type === 'datetime-local').props.onChange({ target: { value: '2030-11-01T09:30' } }); h.rerender();
    assert.equal(props.value.countdown.startAt, '2030-11-01T04:00:00.000Z');
    h.find(n => n.type === 'select').props.onChange({ target: { value: 'campaign' } }); h.rerender();
    assert.match(labelText(h.tree), /Diwali deal/);
  } finally { h.close(); }
});

// Safe draft editing in Storefront Studio.
const liveTheme = () => {
  const base = { kind: 'theme', name: 'Live theme', description: '', scope: 'global', device: 'all', priority: 0, order: 0, startAt: null, endAt: null, timezone: 'Asia/Kolkata' };
  const config = title => ({ preset: 'Diwali Celebration', application: 'storefront', categoryTiles: [], tokens: policy.PRESETS['Diwali Celebration'], header: festiveHeader({ title }), animation: liveEffect });
  return { ...base, _id: '507f1f77bcf86cd799439031', status: 'published', lifecycle: 'active', revision: 4, canRollback: true, config: config('Live title'),
    draft: { revision: 2, stale: false, savedAt: new Date().toISOString(), values: { ...base, name: 'Live theme (draft)', config: config('Draft title') } } };
};
async function studioWithRows(rows, extra = {}) {
  const toasts = [], h = browserHarness(Studio.default, {}, { triggerToast: m => toasts.push(m), setActiveTab() {}, ...extra });
  await new Promise(r => setTimeout(r, 260)); h.flush();
  h.requests[0].resolve({ data: rows, meta: { pages: 1 } }); await h.settle();
  return { h, toasts };
}
test('studio opens the saved draft of a live theme, previews it with the real festive header and saves with its draft revision', async () => {
  const row = liveTheme(), { h, toasts } = await studioWithRows([row]);
  try {
    assert.match(text(h.tree), /Unpublished draft saved .*Customers still see the live version/);
    h.click('Edit draft & preview');
    for (const request of h.requests.filter(r => !r.settled)) request.resolve({ data: [] }); await h.settle();
    assert.equal(h.find(n => n.type === Festive.FestiveHeader).props.header.title, 'Draft title');
    assert.equal(h.find(n => n.props?.label === 'Name').props.children.props.value, 'Live theme (draft)');
    assert.match(text(h.tree), /Editing the saved draft\.\s+The\s+live\s+version stays unchanged until you publish this draft/);
    const pending = h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); h.flush();
    const patch = h.requests.find(r => r.options.method === 'PATCH'), body = JSON.parse(patch.options.body);
    assert.equal(body.revision, 4); assert.equal(body.draftRevision, 2); assert.equal(body.config.header.title, 'Draft title');
    patch.resolve({ data: { ...row, draft: { ...row.draft, revision: 3 } } }); await pending; await h.settle();
    assert.deepEqual(toasts, ['Draft saved. The live version is unchanged until you publish this draft.']);
    assert.equal(h.requests.some(r => r.options.method === 'POST'), false, 'Saving a draft never publishes');
  } finally { h.close(); }
});
test('studio publishes a live draft with both revisions and discards a draft without publishing', async () => {
  const row = liveTheme();
  let { h } = await studioWithRows([row]);
  try {
    h.click('Publish draft'); await h.settle();
    const publish = h.requests.find(r => r.options.method === 'POST');
    assert.match(publish.url, /\/storefront\/507f1f77bcf86cd799439031\/actions\/publish$/); assert.deepEqual(JSON.parse(publish.options.body), { revision: 4, draftRevision: 2 });
    publish.resolve({ data: { ...row, draft: null, revision: 5 } }); await h.settle();
  } finally { h.close(); }
  ({ h } = await studioWithRows([row]));
  try {
    h.click('Discard draft'); await h.settle();
    const discard = h.requests.find(r => r.options.method === 'POST');
    assert.match(discard.url, /\/actions\/discard$/); assert.deepEqual(JSON.parse(discard.options.body), { revision: 4, draftRevision: 2 });
  } finally { h.close(); }
  const paused = { ...row, status: 'paused', lifecycle: 'paused' };
  ({ h } = await studioWithRows([paused]));
  try { assert.ok(h.find(n => n.type === 'button' && n.props.children === 'Publish draft')); assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Pause'), undefined); } finally { h.close(); }
  const stale = { ...row, draft: { ...row.draft, stale: true } };
  ({ h } = await studioWithRows([stale]));
  try {
    assert.match(text(h.tree), /live version changed since; open, review and save it before publishing/);
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Publish draft').props.disabled, true);
  } finally { h.close(); }
});
test('a late or failed refresh keeps the admin theme briefly, but never past a scheduled change', () => {
  const now = Date.now(), base = { version: 'v', banners: [], sections: [], validUntil: new Date(now).toISOString() };
  assert.equal(policy.showableExperience({ ...base, validUntil: new Date(now + 1).toISOString() }, now), true, 'Fresh content is shown');
  assert.equal(policy.showableExperience(base, now + 1000), true, 'A refresh due a second ago does not drop the theme');
  assert.equal(policy.showableExperience(base, now + policy.EXPERIENCE_GRACE_MS + 1), false, 'Long-stale content falls back');
  assert.equal(policy.showableExperience({ ...base, scheduleUntil: new Date(now + 500).toISOString() }, now + 600), false, 'A scheduled end is honoured exactly');
  assert.equal(policy.showableExperience({ ...base, scheduleUntil: null }, now + 600), true);
  assert.equal(policy.showableExperience({ validUntil: base.validUntil }, now), false, 'Malformed data is never shown');
  assert.equal(policy.freshExperience(base, now + 1), false, 'Freshness itself stays strict');
});
test('the storefront refreshes before its copy expires and keeps the theme through a refresh', async () => {
  const h = browserHarness(Provider, {}, { activeMode: 'shop-all', activeSubNav: 'ecommerce--smart-buy', activeNav: 'home' });
  const realNow = Date.now;
  try {
    const serverTime = new Date(), data = { version: 'live', animations: [], theme: { id: 'published', tokens: policy.PRESETS['Eid Celebration'] }, banners: [], sections: [], serverTime: serverTime.toISOString(), validUntil: new Date(serverTime.getTime() + 30000).toISOString(), scheduleUntil: null };
    h.requests[0].resolve({ data }); await h.settle();
    assert.equal(h.tree.props.value.theme.tokens.primary, '#116b52');
    // 31 seconds later, with the refresh still in flight, the admin theme is still applied.
    Date.now = () => realNow() + 31000; h.rerender(); await h.settle();
    assert.equal(h.tree.props.value.theme.tokens.primary, '#116b52', 'No fallback flash while refreshing');
  } finally { Date.now = realNow; h.close(); }
});

test('media fields explain desktop vs mobile sizes and warn when a tall image is used for desktop', async () => {
  const previous = globalThis.Image, sizes = { '/uploads/tall.webp': [1080, 1920], '/uploads/wide.webp': [1600, 900] };
  globalThis.Image = class { set src(url) { [this.naturalWidth, this.naturalHeight] = sizes[url]; queueMicrotask(() => this.onload?.()); } };
  const props = { value: { mediaType: 'image', image: '/uploads/tall.webp' }, onChange() {} };
  const h = browserHarness(MediaFields, props, {});
  try {
    await h.settle();
    let out = text(h.tree);
    assert.match(out, /e\.g\. 1600 × 900 px/); assert.match(out, /e\.g\. 1080 × 1920 px/);
    assert.match(out, /desktop image is tall \(portrait\)/);
    props.value = { mediaType: 'image', image: '/uploads/wide.webp', mobileImage: '/uploads/tall.webp' }; h.rerender(); await h.settle();
    out = text(h.tree);
    assert.doesNotMatch(out, /is tall \(portrait\)|is wide \(landscape\)|No mobile image yet/, 'Correct artwork raises no warning');
    props.value = { mediaType: 'image', image: '/uploads/wide.webp' }; h.rerender(); await h.settle();
    assert.match(text(h.tree), /No mobile image yet/);
  } finally { h.close(); if (previous) globalThis.Image = previous; else delete globalThis.Image; }
});
test('the splash counts its seconds from when the image has loaded and stays open when a refresh republishes it', () => {
  const originalTimer = globalThis.setTimeout, originalImage = globalThis.Image, callbacks = [], images = [];
  globalThis.setTimeout = (callback, delay) => { callbacks.push({ callback, delay }); return 999990 + callbacks.length; };
  globalThis.Image = class { constructor() { images.push(this); } };
  const context = { loading: false, version: 'cached', splash: { ...splash('launch'), config: { frequency: 'launch', duration: 10 } }, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  let h;
  try {
    h = browserHarness(Splash, { children: createElement('main') }, context);
    assert.ok(h.find(n => n.type === SplashCard));
    // The home banner is preloaded meanwhile (its own 3 s wait); only the splash's timers matter here.
    const splashTimers = () => callbacks.map(c => c.delay).filter(d => d !== 3000);
    // Only the 4 s image-wait fallback is pending; the 10 s close timer waits for the artwork.
    assert.deepEqual(splashTimers(), [4000]);
    images.find(i => i.src === context.splash.banner.image).onload(); h.flush();
    assert.deepEqual(splashTimers(), [4000, 10000]);
    // The fresh response republished the same splash with a new duration: it stays open with the new one.
    context.splash = { ...context.splash, revision: 2, config: { frequency: 'launch', duration: 12 } }; h.rerender(); h.flush();
    assert.ok(h.find(n => n.type === SplashCard), 'A newer revision of the open splash does not close it');
    assert.equal(callbacks.at(-1).delay, 12000);
  } finally { h?.close(); globalThis.setTimeout = originalTimer; globalThis.Image = originalImage; }
});
test('a header category with a custom image shows it in colour; a picked icon is tinted to the header', () => {
  const context = { activeSubNav: '', setActiveSubNav() {}, headerCategories: [
    { _id: 'icon', name: 'Icon tab', slug: 'grocery--icon', icon: 'https://cdn.fixture/icon.png', image: 'https://cdn.fixture/old-photo.jpg' },
    { _id: 'photo', name: 'Photo tab', slug: 'grocery--photo', image: 'https://cdn.fixture/travel.jpg' },
    { _id: 'none', name: 'Plain tab', slug: 'grocery--plain' },
  ] };
  const h = browserHarness(HeaderCategories, {}, context);
  try {
    const holder = button => button.props.children[0];
    assert.equal(holder(h.tree[0]).props.className, 'sub-nav-icon sub-nav-icon--category');
    assert.equal(holder(h.tree[0]).props.children.props.source, 'https://cdn.fixture/icon.png', 'A picked icon wins over an older image');
    assert.equal(holder(h.tree[1]).props.className, 'sub-nav-icon sub-nav-icon--category sub-nav-icon--photo');
    assert.equal(holder(h.tree[1]).props.children.props.source, 'https://cdn.fixture/travel.jpg');
    assert.equal(holder(h.tree[2]).props.className, 'sub-nav-icon sub-nav-icon--category');
  } finally { h.close(); }
});

test('on a computer the loader shows until the storefront content arrives, then the website opens with no splash', () => {
  const children = createElement('main', { id: 'desktop-home' });
  const context = { loading: true, splash: splash('launch'), now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'desktop' };
  const h = browserHarness(Splash, { children }, context);
  try {
    assert.equal(h.tree.type.name, 'StoreLoading', 'Loader instead of the default look while the content loads');
    context.loading = false; context.version = 'published'; h.rerender();
    assert.equal(h.find(n => n.type === SplashCard), undefined); assert.equal(homeContent(h), children);
  } finally { h.close(); }
});
test('a failed storefront answer ends the loader and shows the website', () => {
  const children = createElement('main', { id: 'home' });
  const context = { loading: true, splash: null, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'desktop' };
  const h = browserHarness(Splash, { children }, context);
  try {
    assert.equal(h.tree.type.name, 'StoreLoading');
    context.loading = false; h.rerender(); // no version: the request failed or timed out
    assert.equal(homeContent(h), children);
  } finally { h.close(); }
});
test('the loader has a spinner and keeps the remembered theme colours', async () => {
  const { StoreLoading } = await vite.ssrLoadModule('/src/modules/User/components/PromotionalSplash.jsx');
  const html = (await import('react-dom/server')).renderToStaticMarkup(createElement(StoreLoading));
  assert.match(html, /class="boot-spinner"/); assert.match(html, /role="status"/); assert.match(html, /aria-busy="true"/);
  assert.match(html, /class="boot-logo"/, 'The launch screen shows the logo');
  assert.doesNotMatch(html, /<header|<main/, 'No empty header, search bar or page outline');
});
test('Studio media and preview follow the device: a phone-only campaign asks for one tall image and previews on a phone', async () => {
  const Fields = (await vite.ssrLoadModule('/src/modules/Admin/components/StorefrontMediaFields.jsx')).default;
  const labels = device => { const h = browserHarness(Fields, { value: {}, onChange() {}, device, desktopImage: device !== 'studio' }, {}); try { return text(h.tree); } finally { h.close(); } };
  assert.match(labels('all'), /Desktop image \(required\)/); assert.match(labels('all'), /Mobile image \/ poster/);
  assert.match(labels('mobile'), /Mobile image \(required\)/); assert.doesNotMatch(labels('mobile'), /Desktop image|Mobile image \/ poster/);
  assert.match(labels('mobile'), /Tall \(portrait\) artwork for phones/);
  assert.match(labels('desktop'), /Desktop image \(required\)/); assert.doesNotMatch(labels('desktop'), /Mobile image/);
});
test('the first paint remembers the active theme colours, safely and only until the theme ends', () => {
  const store = new Map(), previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    assert.equal(policy.bootLook(), null);
    policy.rememberBootLook({ header: '#0B2A5B', headerText: '#FFFFFF', background: '#EEF4FF', search: 'url(javascript:alert(1))' }, new Date(Date.now() + 60000).toISOString());
    assert.deepEqual(policy.bootLook(), { header: '#0B2A5B', headerText: '#FFFFFF', background: '#EEF4FF', search: undefined }, 'Only hex colours are kept');
    assert.deepEqual(policy.bootLookStyle(policy.bootLook()), { '--boot-header': '#0B2A5B', '--boot-header-text': '#FFFFFF', '--boot-background': '#EEF4FF' });
    assert.equal(policy.bootLook(Date.now() + 120000), null, 'An ended theme is not shown on the next launch');
    store.set(policy.BOOT_LOOK_KEY, '{not json'); assert.equal(policy.bootLook(), null);
  } finally { globalThis.localStorage = previous; }
});
test('a long splash runs its full time, up to ten minutes, and can be skipped', () => {
  const originalTimer = globalThis.setTimeout, callbacks = [];
  globalThis.setTimeout = (callback, delay) => { callbacks.push({ callback, delay }); return 999990 + callbacks.length; };
  const context = { loading: false, version: 'v', splash: { ...splash('launch'), config: { frequency: 'launch', duration: 300 } }, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  let h;
  try {
    h = browserHarness(Splash, { children: createElement('main') }, context); assert.ok(callbacks.some(c => c.delay === 300000), 'Five minutes');
    h.find(n => n.type === SplashCard).props.onSkip(); h.flush(); assert.equal(h.find(n => n.type === SplashCard), undefined, 'Skip closes it');
  }
  finally { h?.close(); globalThis.setTimeout = originalTimer; }
});
test('short splashes have no Skip button; the Studio enters time in seconds or minutes', async () => {
  const context = { loading: false, version: 'v', splash: { ...splash('launch'), config: { frequency: 'launch', duration: 10 } }, now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'mobile' };
  const h = browserHarness(Splash, { children: createElement('main') }, context);
  try { assert.equal(h.find(n => n.type === SplashCard).props.onSkip, undefined); } finally { h.close(); }
  assert.equal(policy.splashDurationText(10), '10 seconds'); assert.equal(policy.splashDurationText(120), '2 minutes'); assert.equal(policy.splashDurationText(90), '1 min 30 sec');
  const saved = [], field = browserHarness(Studio.SplashDurationField, { value: 120, onChange: v => saved.push(v) }, {});
  try {
    assert.equal(field.find(n => n.type === 'select').props.value, 'minutes'); assert.equal(field.find(n => n.type === 'input').props.value, 2);
    field.find(n => n.type === 'input').props.onChange({ target: { value: '5' } }); assert.deepEqual(saved, [300], 'Minutes are saved as seconds');
  } finally { field.close(); }
});
test('on a phone the storefront uses the request index.html started early, once, instead of asking again', async () => {
  const data = { version: 'early', theme: { id: 'blue', tokens: policy.PRESETS['Eid Celebration'] }, banners: [], sections: [], serverTime: new Date().toISOString(), validUntil: new Date(Date.now() + 30000).toISOString() };
  let placed = false;
  const Early = p => { if (!placed) { placed = true; window.__bulkimartEarlyExperience = { key: 'quick:mobile:', promise: Promise.resolve({ data }) }; } return Provider(p); };
  const h = browserHarness(Early, {}, { activeMode: 'quick', activeSubNav: 'grocery--home' }, true);
  try {
    await h.settle(); await h.settle();
    assert.equal(h.requests.filter(r => r.url.includes('/api/storefront/experience')).length, 0, 'No second request');
    assert.equal(h.tree.props.value.theme.id, 'blue'); assert.equal(window.__bulkimartEarlyExperience, null, 'Used only once');
  } finally { h.close(); }
});
test('an early request for another storefront, or none at all, falls back to the normal request', async () => {
  const Provided = await vite.ssrLoadModule('/src/modules/User/context/StorefrontContext.jsx');
  globalThis.window ||= {}; window.__bulkimartEarlyExperience = { key: 'shop-all:mobile:', promise: Promise.resolve({}) };
  assert.equal(Provided.takeEarlyExperience('quick:mobile:'), null); assert.ok(window.__bulkimartEarlyExperience, 'Kept for its own storefront');
  window.__bulkimartEarlyExperience = { key: 'quick:mobile:', promise: new Promise(() => {}) };
  const realTimeout = globalThis.setTimeout; globalThis.setTimeout = fn => realTimeout(fn, 0);
  try { assert.equal(await Provided.takeEarlyExperience('quick:mobile:'), null, 'A stalled request is given up'); } finally { globalThis.setTimeout = realTimeout; window.__bulkimartEarlyExperience = null; }
});

test('a failed early request releases startup without a second blocking request', async () => {
  let placed = false;
  const Early = props => {
    if (!placed) { placed = true; window.__bulkimartEarlyExperience = { key: 'quick:mobile:', promise: Promise.resolve(null) }; }
    return Provider(props);
  };
  const h = browserHarness(Early, {}, { activeMode: 'quick', activeSubNav: 'grocery--home' }, true);
  try {
    await h.settle();
    assert.equal(h.tree.props.value.loading, false);
    assert.equal(h.tree.props.value.splash, null);
    assert.equal(h.requests.length, 0, 'Retries happen in the background instead');
  } finally { h.close(); }
});
test('a deal page shows its picture and its details, and opens its category in that category\'s storefront', async () => {
  const Deal = (await vite.ssrLoadModule('/src/modules/User/pages/CampaignLandingPage.jsx')).default;
  const calls = [];
  const context = { selectedCampaignId: 'deal', now: Date.now(), setSelectedCampaignId: v => calls.push(['campaign', v]), setActiveMode: v => calls.push(['mode', v]), setSelectedCategoryFilter: v => calls.push(['category', v]) };
  const h = browserHarness(Deal, {}, context);
  try {
    h.requests[0].resolve({ data: { id: 'deal', name: 'Travel week', description: 'Bags and bottles', bannerImage: 'https://cdn.fixture/deal.jpg', discountValue: 15,
      startAt: new Date(Date.now() - 1000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), targetCategory: { id: 'cat', slug: 'grocery--travel', name: 'Travel', type: 'grocery' } } });
    h.requests[1].resolve({ data: { products: [] } }); await h.settle();
    assert.equal(h.find(n => n.type === 'img').props.src, 'https://cdn.fixture/deal.jpg');
    assert.match(text(h.tree), /Bags and bottles/); assert.match(text(h.tree), /15\s*% OFF/, 'Details show even when there is a picture');
    h.find(n => n.type === 'button' && /^Shop\s+Travel/.test(text(n))).props.onClick();
    assert.deepEqual(calls, [['campaign', null], ['mode', 'quick'], ['category', { _id: 'cat', slug: 'grocery--travel', name: 'Travel' }]]);
  } finally { h.close(); }
});
test('tapping a promotion banner picture opens it, like its button', () => {
  let opened;
  const context = { banners: [{ ...banner, destination: { type: 'CAMPAIGN', id: 'deal' } }], device: 'mobile', loading: false, now: Date.now(), setSelectedCampaignId: v => { opened = v; } };
  const realFetch = globalThis.fetch; globalThis.fetch = async () => ({ ok: true });
  const h = browserHarness(Hero, {}, context);
  try {
    const art = h.find(n => n.props?.className?.includes?.('sf-hero-art'));
    assert.match(art.props.className, /sf-hero-art--link/);
    art.props.onClick({ target: { tagName: 'IMG' } }); assert.equal(opened, 'deal');
    opened = undefined; art.props.onClick({ target: { tagName: 'VIDEO' } }); assert.equal(opened, undefined, 'Video controls do not navigate');
  } finally { h.close(); globalThis.fetch = realFetch; }
});
test('the first time, the loader also waits for the main banner picture, then never comes back', () => {
  const originalImage = globalThis.Image, images = [];
  globalThis.Image = class { constructor() { images.push(this); } };
  const children = createElement('main', { id: 'home' });
  const context = { loading: false, version: 'v1', splash: null, banners: [{ ...banner, image: 'https://cdn.fixture/hero.webp' }], now: Date.now(), theme: { tokens: policy.DEFAULT_TOKENS }, activeNav: 'home', device: 'desktop' };
  let h;
  try {
    h = browserHarness(Splash, { children }, context);
    assert.equal(h.tree.type.name, 'StoreLoading', 'Waiting for the banner picture');
    images.find(i => i.src === 'https://cdn.fixture/hero.webp').onload(); h.flush();
    assert.equal(homeContent(h), children, 'The page appears once the banner is ready');
    context.banners = [{ ...banner, image: 'https://cdn.fixture/other.webp' }]; h.rerender();
    assert.equal(homeContent(h), children, 'A later banner change does not bring the loader back');
  } finally { h?.close(); globalThis.Image = originalImage; }
});
