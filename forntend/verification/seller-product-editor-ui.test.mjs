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
async function editor(editing = false) {
  let saves = 0;
  const ctx = {
    showAddProductModal: true, activeChannel: 'ecommerce', productListingMode: 'retail', platformLimits: {},
    sellerProfile: { status: 'approved', salesChannels: ['ecommerce', 'wholesale'], wholesaleChannel: { status: 'approved' } },
    newProductForm: { name: 'Product fixture', fulfillmentType: 'physical', returnable: false, variants: [variant(editing ? 'variant-one' : null)] },
    ...(editing ? { editingProductId: 'product-one', editingProduct: { _id: 'product-one', type: 'ecommerce', category, images: ['fixture.jpg'], status: 'approved', isActive: true } } : {}),
    setShowAddProductModal: value => { ctx.showAddProductModal = value; }, setEditingProductId: () => {}, triggerToast: () => {},
    submitNewProduct: async () => { saves++; ctx.showAddProductModal = false; return { ok: true }; },
    submitProductEdit: async () => { saves++; ctx.showAddProductModal = false; return { ok: true }; },
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
    assert.equal(f.saves, 0); assert.equal(h.decisions.length, 1); assert.match(h.decisions[0].message, /Wholesale terms have unsaved changes/);
  } finally { h.close(); }
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
