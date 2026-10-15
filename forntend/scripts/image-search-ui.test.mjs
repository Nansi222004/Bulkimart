import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';

let vite, sheet, SearchPage, api;
const oldDocument = globalThis.document;
before(async () => {
  const events = new EventTarget();
  globalThis.document = { activeElement: null, body: { style: { overflow: '' } }, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) };
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  sheet = await vite.ssrLoadModule('/src/modules/User/components/ImageSearchSheet.jsx');
  api = await vite.ssrLoadModule('/src/modules/User/utils/imageSearch.js');
  SearchPage = (await vite.ssrLoadModule('/src/modules/User/pages/SearchPage.jsx')).default;
});
after(async () => { await vite.close(); if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; delete globalThis.__imageSearchUser; });
const photo = (name = 'fixture.png', type = 'image/png', size = 40) => new File([new Uint8Array(size)], name, { type });
function userFixture(extra = {}) {
  const fixture = { activeMode: 'quick', pendingVoiceQuery: '', imageSearchRequest: 0, setActiveNav() {}, setSelectedProduct() {}, setSelectedPromotionId() {}, openVoiceSearch() {}, setPendingVoiceQuery(value) { fixture.pendingVoiceQuery = value; }, setImageSearchRequest(value) { fixture.imageSearchRequest = value; }, ...extra };
  globalThis.__imageSearchUser = fixture; return fixture;
}
const choose = (h, capture, file) => { const input = h.find(n => n.type === 'input' && !!n.props.capture === capture); input.props.onChange({ target: { files: [file], value: 'chosen' } }); h.flush(); };
const searchHarness = () => hookHarness(SearchPage, {}, '/search', globalThis.__imageSearchUser);

test('camera and gallery controls use separate device-appropriate inputs', () => {
  const h = hookHarness(sheet.default, { open: true, loading: false, onClose() {}, onSearch: async () => true });
  try {
    let camera = 0, gallery = 0;
    h.find(n => n.type === 'input' && n.props.capture === 'environment').props.ref.current = { click: () => camera++ };
    h.find(n => n.type === 'input' && !n.props.capture).props.ref.current = { click: () => gallery++ };
    h.click('Take Photo'); h.click('Upload Image'); assert.deepEqual([camera, gallery], [1, 1]);
    assert.equal(h.find(n => n.type === 'section').props['aria-modal'], 'true');
  } finally { h.close(); }
});
test('gallery/desktop selection previews the image and removal clears it', () => {
  const h = hookHarness(sheet.default, { open: true, onClose() {}, onSearch() {} });
  try { choose(h, false, photo()); assert.match(h.find(n => n.type === 'img').props.src, /^blob:/); h.click('Remove image'); assert.equal(h.find(n => n.type === 'img'), undefined); assert.equal(h.find(n => n.props?.className === 'image-search-submit').props.disabled, true); }
  finally { h.close(); }
});
test('camera selection searches the selected file; failed submissions remain retryable', async () => {
  let calls = 0, closed = 0; const file = photo('photo.jpg', 'image/jpeg');
  const h = hookHarness(sheet.default, { open: true, onClose() { closed++; }, onSearch: async received => { assert.equal(received, file); if (++calls === 1) throw new Error('Network unavailable'); return true; } });
  try { choose(h, true, file); await h.click('Search image'); h.flush(); assert.ok(h.find(n => n.props?.role === 'alert')); assert.equal(closed, 0); await h.click('Search image'); assert.equal(closed, 1); }
  finally { h.close(); }
});
test('unsupported, empty and oversized images are rejected before upload', () => {
  for (const file of [photo('file.svg', 'image/svg+xml'), photo('file.png', 'image/png', 0), photo('file.png', 'image/png', 1025)]) assert.throws(() => api.validateSearchImage(file, 1024));
  for (const [name, type] of [['p.jpg', 'image/jpeg'], ['p.jpeg', 'image/jpeg'], ['p.png', 'image/png'], ['p.webp', 'image/webp']]) assert.doesNotThrow(() => api.validateSearchImage(photo(name, type), 1024));
});
test('loading disables upload actions and announces progress', () => {
  const h = hookHarness(sheet.default, { open: true, loading: true, onClose() {}, onSearch() {} });
  try { assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Take Photo').props.disabled, true); assert.ok(h.find(n => n.props?.role === 'status')); }
  finally { h.close(); }
});
test('image API uses multipart, storefront and existing bearer conventions without setting a boundary', async () => {
  userFixture(); const h = hookHarness(() => null);
  try {
    const pending = api.searchProductsByImage(photo(), { type: 'ecommerce' });
    const call = h.requests[0]; assert.match(call.url, /search-by-image\?type=ecommerce/); assert.ok(call.options.body instanceof FormData); assert.equal(call.options.headers['Content-Type'], undefined); assert.match(call.options.headers.Authorization, /^Bearer /);
    call.resolve({ data: [], meta: {} }); await pending;
  } finally { h.close(); }
});
test('image results use existing product-card navigation and text input can leave image search', async () => {
  let opened; userFixture({ setSelectedProduct: value => { opened = value; } });
  const h = searchHarness();
  try {
    const imageSheet = h.find(n => n.type === sheet.default);
    const pending = imageSheet.props.onSearch(photo()); h.flush();
    assert.ok(h.find(n => n.type === sheet.default).props.loading);
    const call = h.requests.find(r => r.options.method === 'POST');
    const product = { _id: '507f1f77bcf86cd799439011', name: 'Fixture product', images: ['https://example.test/product.png'], price: 20, stock: 1, type: 'grocery' };
    call.resolve({ data: [product], meta: { page: 1, total: 1, limit: 20 } }); await pending; await h.settle();
    h.find(n => n.props?.className === 'search-page-result-card').props.onClick(); assert.equal(opened._id, product._id);
    h.find(n => n.type === 'input' && n.props['aria-label'] === 'Search').props.onChange({ target: { value: 'milk' } }); h.flush();
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.ok(h.requests.some(r => r.url.includes('/products/search?q=milk')));
  } finally { h.close(); }
});
test('empty image matches and server errors have distinct visible states', async () => {
  userFixture(); const h = searchHarness();
  try {
    let pending = h.find(n => n.type === sheet.default).props.onSearch(photo()); h.flush();
    h.requests.find(r => r.options.method === 'POST').resolve({ data: [], meta: { page: 1, limit: 20, total: 0 } }); await pending; await h.settle();
    assert.ok(h.find(n => n.type === 'p' && String(n.props.children).includes('No similar product photos')));
    pending = h.find(n => n.type === sheet.default).props.onSearch(photo()); h.flush();
    h.requests.filter(r => r.options.method === 'POST').at(-1).resolve({ message: 'Image catalogue is not ready' }, 503);
    await assert.rejects(pending, /not available/); await h.settle(); assert.ok(h.find(n => n.props?.role === 'alert'));
  } finally { h.close(); }
});
test('voice search still invokes the existing voice flow', async () => {
  let voiceCalls = 0; userFixture({ openVoiceSearch: () => voiceCalls++ }); const h = searchHarness();
  try { h.find(n => n.type === 'button' && n.props['aria-label'] === 'Voice search').props.onClick(); assert.equal(voiceCalls, 1); }
  finally { h.close(); }
});
test('header camera request opens the image sheet in the existing search page', () => {
  const user = userFixture({ imageSearchRequest: 1 }); const h = searchHarness();
  try { assert.equal(h.find(n => n.type === sheet.default).props.open, true); assert.equal(user.imageSearchRequest, 0); }
  finally { h.close(); }
});
test('late image responses cannot overwrite a newer text query', async () => {
  userFixture(); const h = searchHarness();
  try {
    const pending = h.find(n => n.type === sheet.default).props.onSearch(photo()); h.flush();
    const imageRequest = h.requests.find(r => r.options.method === 'POST');
    h.find(n => n.type === 'input' && n.props['aria-label'] === 'Search').props.onChange({ target: { value: 'milk' } }); h.flush();
    await new Promise(resolve => setTimeout(resolve, 320));
    h.requests.find(r => r.url.includes('/products/search?q=milk')).resolve([]); await h.settle();
    imageRequest.resolve({ data: [{ _id: 'old-image-result', name: 'Old result' }], meta: {} }); assert.equal(await pending, false); await h.settle();
    assert.equal(h.find(n => n.props?.className === 'search-page-result-card'), undefined);
    assert.equal(h.find(n => n.type === 'input' && n.props['aria-label'] === 'Search').props.value, 'milk');
  } finally { h.close(); }
});
test('incoming voice queries still use the existing text search endpoint', async () => {
  userFixture({ pendingVoiceQuery: 'fresh milk' }); const h = searchHarness();
  try { await new Promise(resolve => setTimeout(resolve, 320)); assert.ok(h.requests.some(r => r.url.includes('/products/search?q=fresh%20milk'))); }
  finally { h.close(); }
});
