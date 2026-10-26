import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness, registerFeedback } from './componentHarness.mjs';

let vite, Modal, VariantFields;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Modal = (await vite.ssrLoadModule('/src/modules/Seller/components/ProductModal.jsx')).default;
  VariantFields = (await vite.ssrLoadModule('/src/modules/Seller/components/VariantWholesaleFields.jsx')).default;
  registerFeedback((await vite.ssrLoadModule('/src/utils/feedback.js')).feedback);
});
after(async () => vite.close());
const category = '507f1f77bcf86cd799439021';
const text = node => node == null ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const variant = (id, name = 'Default') => ({ ...(id ? { _id: id } : {}), name, price: 100, mrp: 120, stock: 10, unit: 'piece', weight: 100 });
async function editor(editing = false, overrides = {}) {
  let saves = 0;
  const ctx = {
    showAddProductModal: true, activeChannel: 'ecommerce', productListingMode: 'retail', platformLimits: {},
    sellerProfile: { status: 'approved', salesChannels: ['ecommerce', 'wholesale'], wholesaleChannel: { status: 'approved' } },
    newProductForm: { name: 'Product fixture', fulfillmentType: 'physical', returnable: false, variants: [variant(editing ? 'variant-one' : null)] },
    ...(editing ? { editingProductId: 'product-one', editingProduct: { _id: 'product-one', type: 'ecommerce', category, images: ['fixture.jpg'], status: 'approved', isActive: true } } : {}),
    setShowAddProductModal: value => { ctx.showAddProductModal = value; }, setEditingProductId: () => {}, triggerToast: () => {},
    submitNewProduct: async () => { saves++; ctx.showAddProductModal = false; return { ok: true }; },
    submitProductEdit: async () => { saves++; ctx.showAddProductModal = false; return { ok: true }; },
    ...overrides,
  };
  ctx.setNewProductForm = update => { ctx.newProductForm = typeof update === 'function' ? update(ctx.newProductForm) : update; };
  const h = hookHarness(Modal, {}, '/seller/products', ctx);
  h.requests.find(req => req.url.includes('/categories/tree')).resolve({ data: [{ _id: category, name: 'Fixture category', children: [] }] });
  await h.settle(); h.rerender();
  if (!editing) {
    h.find(n => n.type === 'button' && text(n).startsWith('Category & Groups')).props.onClick(); h.flush();
    h.find(n => n.type === 'select' && n.props.required).props.onChange({ target: { value: category } }); h.flush(); h.rerender();
    h.find(n => n.type === 'button' && text(n).startsWith('Photos')).props.onClick(); h.flush();
    h.find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } }); h.flush();
  }
  return { h, ctx, get saves() { return saves; } };
}

test('adding retail variants saves the new product once without a discard prompt', async () => {
  const f = await editor(); const { h, ctx } = f;
  try {
    ctx.newProductForm.variants.push(variant(null, 'Pack of two')); h.rerender();
    await h.click('Save & Submit Listing'); h.rerender();
    assert.equal(f.saves, 1); assert.equal(ctx.showAddProductModal, false); assert.equal(h.decisions.length, 0);
  } finally { h.close(); }
});

test('removing a retail variant does not claim Wholesale terms were edited', async () => {
  const f = await editor(true); const { h, ctx } = f;
  try {
    ctx.newProductForm.variants = [variant(null, 'Replacement')]; h.rerender();
    await h.click('Save Changes');
    assert.equal(f.saves, 1); assert.equal(h.decisions.length, 0);
  } finally { h.close(); }
});

test('actual unsaved Wholesale edits still require a decision before retail save', async () => {
  const f = await editor(true); const { h } = f;
  try {
    h.find(n => n.type === 'button' && text(n).startsWith('Item Variants')).props.onClick(); h.flush();
    h.find(n => n.type === VariantFields).props.onChange(0, () => ({ enabled: true, minimumQuantity: 5, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 5, unitPrice: 80 }] })); h.rerender();
    h.setDecision(false); await h.click('Save Changes');
    assert.equal(f.saves, 0); assert.equal(h.decisions.length, 1); assert.match(h.decisions[0].message, /edited Wholesale terms but did not save them/);
    // Confirming saves, so the dialog must not present itself as a discard.
    assert.equal(h.decisions[0].confirmLabel, 'Save product'); assert.doesNotMatch(h.decisions[0].title, /discard/i); assert.equal(h.decisions[0].destructive, false);
    h.setDecision(true); await h.click('Save Changes'); assert.equal(f.saves, 1);
  } finally { h.close(); }
});

test('new E-commerce, Quick and Wholesale products save without any confirmation', async () => {
  const offer = { enabled: true, minimumQuantity: 1, quantityIncrement: 1, priceTiers: [{ minimumQuantity: 1, unitPrice: 90 }] };
  for (const [activeChannel, mode] of [['ecommerce', 'retail'], ['grocery', 'retail'], ['ecommerce', 'wholesale']]) {
    const wholesale = mode === 'wholesale';
    const variants = [variant(null), variant(null, 'Pack of two')].map(v => wholesale ? { ...v, wholesalePricing: { ...offer } } : v);
    const f = await editor(false, { activeChannel, productListingMode: mode,
      newProductForm: { name: 'Product fixture', fulfillmentType: 'physical', returnable: false, ...(wholesale ? { sellingChannels: ['wholesale'] } : {}), variants } });
    const { h } = f;
    try {
      const save = h.find(n => n.type === 'button' && /Save & Submit Listing|Save Wholesale Product/.test(text(n)));
      await save.props.onClick(); h.flush(); await h.settle();
      assert.equal(h.decisions.length, 0, `${activeChannel}/${mode} must not ask anything`); assert.equal(f.saves, 1);
    } finally { h.close(); }
  }
});

test('Close still protects a changed product draft when the seller cancels', async () => {
  const f = await editor(); const { h, ctx } = f;
  try {
    h.setDecision(false); await h.click('Close');
    assert.equal(ctx.showAddProductModal, true); assert.equal(f.saves, 0);
    assert.match(h.decisions[0].message, /Discard unsaved product changes/);
  } finally { h.close(); }
});

test('Same Day Delivery is absent from Add Product while existing product settings remain editable', async () => {
  for (const editing of [false, true]) {
    const { h } = await editor(editing);
    try {
      h.find(n => n.type === 'button' && text(n).startsWith('General Info')).props.onClick(); h.flush();
      assert.equal(text(h.tree).includes('Offer same-day delivery'), editing);
    } finally { h.close(); }
  }
});

test('an e-book saved as a draft whose PDF failed explains itself instead of asking to discard', async () => {
  let refreshed = 0, edits = 0;
  const ctx = {
    showAddProductModal: true, activeChannel: 'ecommerce', productListingMode: 'retail', platformLimits: {}, sellerProfile: { status: 'approved', salesChannels: ['ecommerce'] },
    // State SellerContext leaves after creating the listing when the PDF upload failed.
    editingProductId: 'ebook-draft', editingProduct: { _id: 'ebook-draft', type: 'ecommerce', fulfillmentType: 'digital', category, images: ['cover.jpg'], status: 'pending' },
    newProductForm: { name: 'Draft e-book', fulfillmentType: 'digital', ebookPrice: '99', author: 'Author', language: 'English', categoryId: category, variants: [] },
    productError: 'Your e-book was saved as a draft, but the PDF did not upload.',
    setShowAddProductModal: value => { ctx.showAddProductModal = value; }, setEditingProductId: () => {}, triggerToast: () => {},
    fetchMyProducts: async () => { refreshed++; }, submitNewProduct: async () => { throw new Error('must not create a second listing'); },
    submitProductEdit: async () => { edits++; return { ok: true }; },
  };
  ctx.setNewProductForm = update => { ctx.newProductForm = typeof update === 'function' ? update(ctx.newProductForm) : update; };
  const h = hookHarness(Modal, {}, '/seller/products', ctx);
  try {
    h.requests.filter(req => req.url.includes('/categories/tree')).forEach(req => req.resolve({ data: [{ _id: category, name: 'Fixture category', children: [] }] }));
    await h.settle(); h.rerender();
    assert.match(text(h.find(n => n.type === 'h3')), /E-book Draft — PDF Needed/);
    assert.ok(h.find(n => n.type === 'button' && text(n).trim() === 'Retry PDF Upload'), 'retry button replaces Save Changes');
    h.setDecision(false); await h.click('Close');
    assert.equal(ctx.showAddProductModal, true);
    assert.match(h.decisions.at(-1).message, /already saved as a draft/);
    assert.doesNotMatch(h.decisions.at(-1).message, /Discard/);
    h.setDecision(true); await h.click('Close'); await h.settle();
    assert.equal(ctx.showAddProductModal, false); assert.equal(refreshed, 1); assert.equal(edits, 0);
  } finally { h.close(); }
});
