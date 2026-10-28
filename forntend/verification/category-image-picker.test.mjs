import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';

let vite, Picker;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Picker = (await vite.ssrLoadModule('/src/modules/Admin/components/CategoriesTab.jsx')).CategoryImagePicker;
});
after(async () => { await vite?.close(); });
const text = n => n == null ? '' : typeof n !== 'object' ? String(n) : [n.props?.children].flat(Infinity).map(text).join(' ');
const input = h => h.find(n => n.type === 'input' && n.props.type === 'file');

test('main and sub categories open a real file chooser and keep only valid pictures', () => {
  const picked = [], h = hookHarness(Picker, { file: null, onPick: f => picked.push(f) });
  try {
    assert.match(text(h.tree), /Upload/); assert.equal(input(h).props.accept, 'image/jpeg,image/png,image/webp');
    input(h).props.onChange({ target: { files: [new File(['x'], 'notes.pdf', { type: 'application/pdf' })], value: 'x' } }); h.flush();
    assert.deepEqual(picked, []); assert.match(text(h.tree), /JPEG, PNG or WebP image up to 5 MB/);
    const photo = new File(['x'], 'bags.png', { type: 'image/png' });
    input(h).props.onChange({ target: { files: [photo], value: 'x' } }); h.flush();
    assert.deepEqual(picked, [photo]); assert.doesNotMatch(text(h.tree), /up to 5 MB\./);
  } finally { h.close(); }
});

test('editing shows the saved picture, and a chosen file can be removed again', () => {
  const picked = [], h = hookHarness(Picker, { file: null, existingUrl: 'https://cdn.fixture/bags.jpg', onPick: f => picked.push(f) });
  try {
    assert.equal(h.find(n => n.type === 'img').props.src, 'https://cdn.fixture/bags.jpg');
    assert.match(text(h.tree), /Tap the picture to change it/);
  } finally { h.close(); }
  const chosen = hookHarness(Picker, { file: new File(['x'], 'new.webp', { type: 'image/webp' }), onPick: f => picked.push(f) });
  try {
    chosen.find(n => n.type === 'button' && text(n) === 'Remove selected image').props.onClick(); assert.deepEqual(picked, [null]);
  } finally { chosen.close(); }
});
