import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness, registerFeedback } from './componentHarness.mjs';
let vite, Page, feedback;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Page = (await vite.ssrLoadModule('/src/modules/User/pages/WriteReviewPage.jsx')).default;
  feedback = (await vite.ssrLoadModule('/src/utils/feedback.js')).feedback; registerFeedback(feedback);
});
after(async () => vite.close());
async function fixture() {
  let backs = 0;
  const h = hookHarness(Page, { productId: 'product-fixture', onBack: () => backs++ }, '/review/product-fixture');
  h.requests[0].resolve({ _id: 'product-fixture', name: 'Food product', images: ['fixture.jpg'] }); await h.settle();
  h.find(n => n.type === 'textarea').props.onChange({ target: { value: 'food product' } }); h.flush();
  return { h, get backs() { return backs; } };
}
const addPhotos = (h, files) => { h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files, value: 'fixture' } }); h.flush(); };
const photo = (name = 'photo.jpg', bytes = 256 * 1024, type = 'image/jpeg') => new File([new Uint8Array(bytes)], name, { type });

test('a short text-only review sends a compact multipart body and explains where it is visible', async () => {
  const f = await fixture(); const { h } = f;
  try {
    const pending = h.click('Submit →'); const req = h.requests[1];
    assert.ok(req.options.body instanceof FormData); assert.equal(req.options.body.get('comment'), 'food product');
    assert.equal(req.options.body.get('rating'), '5'); assert.equal(req.options.body.getAll('images').length, 0);
    assert.equal(req.options.headers['Content-Type'], undefined); assert.ok(req.options.headers.Authorization);
    req.resolve({ success: true, message: 'Review published successfully!' }, 201); await pending;
    assert.equal(f.backs, 1); assert.match(feedback.getSnapshot().toasts[0].message, /Ratings & Reviews on the product page/);
  } finally { h.close(); }
});

test('review photos are sent as original binary files rather than base64 JSON', async () => {
  const { h } = await fixture();
  try {
    const files = [photo(), photo('second.webp', 200 * 1024, 'image/webp')]; addPhotos(h, files);
    const pending = h.click('Submit →'); const req = h.requests[1], uploaded = req.options.body.getAll('images');
    assert.equal(uploaded.length, 2); assert.equal(uploaded[0].name, files[0].name); assert.equal(uploaded[0].size, files[0].size);
    assert.ok(h.find(n => n.type === 'img' && n.props.alt === 'Review photo 1 preview').props.src.startsWith('blob:'));
    req.resolve({ success: true }, 201); await pending;
  } finally { h.close(); }
});

test('invalid photos show local field errors and do not enter the submission', async () => {
  const { h } = await fixture();
  try {
    for (const [files, error] of [[[photo('huge.jpg', 5 * 1024 * 1024 + 1)], /5 MB/],
      [[photo('bad.pdf', 10, 'application/pdf')], /JPG, PNG or WEBP/], [Array.from({ length: 5 }, () => photo()), /4 review photos/]]) {
      addPhotos(h, files); assert.match(h.find(n => n.props?.role === 'alert').props.children, error);
      assert.equal(h.find(n => n.type === 'img' && n.props.alt === 'Review photo 1 preview'), undefined);
    }
    assert.equal(h.requests.length, 1);
  } finally { h.close(); }
});

test('removing a photo and leaving the editor release image previews', async () => {
  const { h } = await fixture(), previous = URL.revokeObjectURL, revoked = [];
  URL.revokeObjectURL = url => { revoked.push(url); previous(url); };
  try {
    addPhotos(h, [photo(), photo('second.png', 10, 'image/png')]);
    h.find(n => n.props?.['aria-label'] === 'Remove review photo 1').props.onClick(); h.flush();
    assert.equal(revoked.length, 1); h.unmount(); assert.equal(revoked.length, 2);
  } finally { h.close(); URL.revokeObjectURL = previous; }
});

test('a size rejection retains the short comment and photos for retry and prevents duplicate sends', async () => {
  const f = await fixture(); const { h } = f;
  try {
    addPhotos(h, [photo()]); const pending = h.click('Submit →');
    await h.find(n => n.type === 'button' && n.props.children === 'Submitting...').props.onClick();
    assert.equal(h.requests.length, 2);
    h.requests[1].resolve({}, 413); await pending; h.flush();
    assert.equal(f.backs, 0); assert.match(h.find(n => n.props?.role === 'alert').props.children, /photos are too large/);
    assert.equal(h.find(n => n.type === 'textarea').props.value, 'food product');
    assert.ok(h.find(n => n.props?.alt === 'Review photo 1 preview'));
    const retry = h.click('Submit →'); h.requests[2].resolve({ success: true }, 201); await retry;
    assert.equal(f.backs, 1);
  } finally { h.close(); }
});
