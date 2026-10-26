import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { renderToStaticMarkup } from 'react-dom/server';
import { hookHarness } from './componentHarness.mjs';

let vite, Profile, Checkout;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Profile = (await vite.ssrLoadModule('/src/modules/User/pages/ProfilePage.jsx')).default;
  Checkout = (await vite.ssrLoadModule('/src/modules/User/pages/CheckoutPage.jsx')).default;
});
after(async () => { await vite.close(); });

const noop = () => {};
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node)
  : [node.props?.children].flat(Infinity).map(text).join(' ');
const profile = { _id: 'fixture-buyer', name: 'Fixture Buyer', phone: '9876500000' };
const address = { _id: 'fixture-address', label: 'Work', line1: 'Office 42', city: 'Indore', pincode: '452001', lat: 22.7, lng: 75.8 };
function harness(Component, overrides = {}) {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({}), querySelector: () => null };
  const h = hookHarness(Component, {}, '/checkout', {
    currentUser: profile, savedAddresses: [address], selectedAddressId: address._id, setSelectedAddressId: noop,
    addAddress: noop, getDeliveryPoint: () => address, getCartTotal: () => 140, getCartItems: () => [],
    serverCart: { items: [], pricing: { subtotal: 100, totalAmount: 140 } }, cartChannel: 'ecommerce',
    getCouponDiscount: () => 0, availableCoupons: [], fetchAvailableCoupons: noop, fetchWalletBalance: noop,
    tipSetting: { options: [] }, walletBalance: 0, ...overrides,
  }, { localStorage: { getItem: key => key === 'userToken' ? 'fixture-only-token' : null } });
  return { h, close() { h.close(); if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; } };
}

test('profile saves Work with address lines and selects only the returned address ID after success', async () => {
  const submitted = [], selected = [];
  let finish;
  const fixture = harness(Profile, {
    addAddress: data => { submitted.push(data); return new Promise(resolve => { finish = resolve; }); },
    setSelectedAddressId: id => selected.push(id),
  });
  const { h } = fixture;
  try {
    h.find(n => n.props?.className === 'menu-link-row' && text(n).includes('My Addresses')).props.onClick(); h.flush();
    h.find(n => n.type === 'button' && text(n).includes('Add New Delivery Address')).props.onClick(); h.flush();
    h.click('Work');
    for (const [placeholder, value] of [
      ['e.g. Rahul Sharma', profile.name], ['10-digit number', profile.phone], ['Flat 202, Block B', 'Office 42'],
      ['Vikas Nagar, Sector 12', 'Market Road'], ['Lucknow', 'Indore'], ['Uttar Pradesh', 'Madhya Pradesh'], ['226022', '452001'],
    ]) h.find(n => n.type === 'input' && n.props.placeholder === placeholder).props.onChange({ target: { value } });
    h.flush();
    const form = h.find(n => n.type === 'form');
    const saving = form.props.onSubmit({ preventDefault() {} }); h.flush();
    assert.equal(h.find(n => n.type === 'form'), form, 'Form stays open until saving finishes');
    assert.deepEqual(selected, [], 'A pending Promise is never selected as an address');
    assert.deepEqual(submitted[0], {
      label: 'Work', name: profile.name, phone: profile.phone, line1: 'Office 42', line2: 'Market Road',
      city: 'Indore', state: 'Madhya Pradesh', pincode: '452001', landmarkImage: null,
    });
    finish({ ok: false, message: 'Fixture save failed' }); await saving; h.flush();
    assert.match(text(h.tree), /Fixture save failed/);
    assert.equal(h.find(n => n.type === 'input' && n.props.placeholder === 'Flat 202, Block B').props.value, 'Office 42');
    const retry = h.find(n => n.type === 'form').props.onSubmit({ preventDefault() {} });
    finish({ ok: true, addressId: 'saved-work-address' }); await retry; h.flush();
    assert.deepEqual(selected, ['saved-work-address']);
    assert.equal(h.find(n => n.type === 'form'), undefined);
  } finally { fixture.close(); }
});

test('checkout keeps stock counts out of Review your items and retains unavailable-item warnings', async () => {
  const fixture = harness(Checkout), { h } = fixture;
  try {
    const group = { key: 'shop', channel: 'ecommerce', seller: { name: 'Fixture Store' }, items: [
      { itemId: 'available', name: 'Amla', qty: 1, price: 500, stock: 8, available: true },
      { itemId: 'unavailable', name: 'Unavailable item', qty: 1, price: 100, stock: 0, available: false },
    ] };
    h.requests.find(req => req.url.includes('/api/cart/unified')).resolve({ success: true, data: {
      groups: [group], totals: { subtotal: 600, deliveryCharge: 40, totalAmount: 640, itemCount: 2 },
    } });
    await h.settle();
    const items = h.find(n => n.type?.name === 'BasketGroups'); assert.ok(items);
    const html = renderToStaticMarkup(items);
    assert.doesNotMatch(html, /Stock:/);
    assert.match(html, /Amla/); assert.match(html, /Unavailable — review or remove this item/);
    assert.match(html, /500/); assert.match(html, /1 units/);
    const cartHtml = renderToStaticMarkup({ ...items, props: { ...items.props, showStock: true } });
    assert.match(cartHtml, /Stock: 8/, 'The cart can still show availability');
  } finally { fixture.close(); }
});
