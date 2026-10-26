import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Auth, SellerAuth, DeliveryAuth, Terms, Logo;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Auth = (await vite.ssrLoadModule('/src/modules/User/pages/AuthPage.jsx')).default;
  SellerAuth = (await vite.ssrLoadModule('/src/modules/Seller/pages/SellerLoginPage.jsx')).default;
  DeliveryAuth = (await vite.ssrLoadModule('/src/modules/Delivery/pages/DeliveryAuthPage.jsx')).default;
  Terms = (await vite.ssrLoadModule('/src/components/RegistrationTerms.jsx')).default;
  Logo = (await vite.ssrLoadModule('/src/components/BrandLogo.jsx')).default;
});
after(async () => vite.close());
const preventDefault = () => {};
const fill = (h, id, value) => { h.find(n => n.type === 'input' && n.props.id === id).props.onChange({ target: { value } }); h.flush(); };
function userFixture() {
  const calls = [];
  const ctx = { sendOtp: (...args) => new Promise(resolve => calls.push({ args, resolve })), verifyOtp: async () => ({ success: false }), setActiveNav() {} };
  const h = hookHarness(Auth, {}, '/account', ctx);
  h.click('Register'); fill(h, 'name', 'Fixture Customer'); fill(h, 'email', 'fixture@example.test'); fill(h, 'phone', '9876500000');
  h.find(n => n.props?.id === 'customer-registration-terms').props.onChange({ target: { checked: true } }); h.flush();
  return { h, calls };
}

test('customer registration waits 30 seconds before resend, prevents duplicate requests and restarts after success', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const { h, calls } = userFixture();
  try {
    const first = h.find(n => n.type === 'form').props.onSubmit({ preventDefault }); h.flush();
    calls[0].resolve({ success: true }); await first; h.flush();
    assert.deepEqual(calls[0].args, ['9876500000', false]);
    let resend = h.find(n => n.type === 'button' && String(n.props.children).startsWith('Resend OTP'));
    assert.equal(resend.props.children, 'Resend OTP in 30s'); assert.equal(resend.props.disabled, true);
    await resend.props.onClick(); assert.equal(calls.length, 1);
    t.mock.timers.tick(29000); h.flush();
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Resend OTP in 1s').props.disabled, true);
    t.mock.timers.tick(1000); h.flush();
    resend = h.find(n => n.type === 'button' && n.props.children === 'Resend OTP'); assert.equal(resend.props.disabled, false);
    const second = resend.props.onClick(); await resend.props.onClick(); assert.equal(calls.length, 2);
    calls[1].resolve({ success: true }); await second; h.flush();
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Resend OTP in 30s').props.disabled, true);
  } finally { h.close(); t.mock.timers.reset(); }
});

test('a failed resend keeps the entered number and allows retry without starting another countdown', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000 });
  const { h, calls } = userFixture();
  try {
    const first = h.find(n => n.type === 'form').props.onSubmit({ preventDefault });
    calls[0].resolve({ success: true }); await first; h.flush(); t.mock.timers.tick(30000); h.flush();
    const resend = h.click('Resend OTP'); calls[1].resolve({ success: false, message: 'Please retry sending' }); await resend; h.flush();
    assert.equal(h.find(n => n.type === 'button' && n.props.children === 'Resend OTP').props.disabled, false);
    assert.deepEqual(calls[1].args, ['9876500000', false]);
    h.click('← Back to Phone'); assert.equal(h.find(n => n.props?.id === 'phone').props.value, '9876500000');
    assert.equal(h.find(n => n.props?.id === 'customer-registration-terms').props.checked, true);
  } finally { h.close(); t.mock.timers.reset(); }
});

for (const audience of ['user', 'seller', 'delivery']) test(`${audience} registration opens its existing policy without submitting the form`, async () => {
  const h = hookHarness(Terms, { audience }, '/account');
  try {
    assert.equal(h.requests.length, 0);
    const button = h.find(n => n.type === 'button'); assert.equal(button.props.type, 'button'); button.props.onClick(); h.flush();
    assert.ok(h.find(n => n.props?.role === 'dialog')); assert.match(h.requests[0].url, new RegExp('/privacy-policy/' + audience + '-policy$'));
    h.requests[0].resolve({ success: true, data: { roleTitle: audience + ' existing policy', version: '2', sections: [{ title: 'Saved heading', content: 'Saved content', points: ['Saved bullet'] }] } });
    await h.settle();
    assert.ok(h.find(n => n.type === 'h3' && n.props.children === audience + ' existing policy'));
    assert.ok(h.find(n => n.type === 'p' && n.props.children === 'Saved content'));
    h.click('Back to registration'); assert.equal(h.find(n => n.props?.role === 'dialog'), undefined);
  } finally { h.close(); }
});

test('policy loading errors offer retry and late responses cannot restore a closed dialog', async () => {
  const h = hookHarness(Terms, { audience: 'seller' }, '/seller');
  try {
    h.click('Terms & Conditions'); h.requests[0].resolve({ success: false }, 503); await h.settle();
    assert.ok(h.find(n => n.props?.role === 'alert')); h.click('Retry loading policy');
    h.click('Back to registration'); h.requests[1].resolve({ success: true, data: { roleTitle: 'Late policy' } }); await h.settle();
    assert.equal(h.find(n => n.props?.role === 'dialog'), undefined);
  } finally { h.close(); }
});

test('all registration pages expose the correct policy and seller/delivery artwork stays scoped to its portal', () => {
  const customer = userFixture();
  try { assert.equal(customer.h.find(n => n.type === Terms).props.audience, 'user'); assert.equal(customer.h.find(n => n.type === Logo).props.audience, undefined); } finally { customer.h.close(); }
  const seller = hookHarness(SellerAuth, { mode: 'register' }, '/seller', { sellerPhone: '', setSellerPhone() {} });
  try { assert.equal(seller.find(n => n.type === Terms).props.audience, 'seller'); assert.equal(seller.find(n => n.type === Logo).props.audience, 'seller'); } finally { seller.close(); }
  const delivery = hookHarness(DeliveryAuth, {}, '/delivery', {});
  try { delivery.click('Register'); assert.equal(delivery.find(n => n.type === Terms).props.audience, 'delivery'); assert.equal(delivery.find(n => n.type === Logo).props.audience, 'delivery'); } finally { delivery.close(); }
  const src = props => Logo(props).props.children[0].props.src;
  assert.match(src({ audience: 'seller' }), /seller(?:%20| )logo\.jpeg/);
  assert.match(src({ audience: 'delivery' }), /delievry(?:%20| )logo\.jpg/);
  assert.match(src({ variant: 'icon' }), /logo-icon-transparent/);
  assert.match(src({ transparent: true }), /Bulkimart-logo-transparent/);
});
