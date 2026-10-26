import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

let vite, delivery, session, Gate, customer, DeliveryProvider, socket, portalRequests;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  delivery = await vite.ssrLoadModule('/src/modules/Delivery/utils/deliveryAuth.js');
  session = await vite.ssrLoadModule('/src/utils/deliverySession.js');
  customer = await vite.ssrLoadModule('/src/utils/customerSession.js');
  portalRequests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
  Gate = (await vite.ssrLoadModule('/src/components/CustomerSessionGate.jsx')).default;
  DeliveryProvider = (await vite.ssrLoadModule('/src/modules/Delivery/context/DeliveryContext.jsx')).DeliveryProvider;
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket;
  socket.connect = () => socket;
});
after(async () => vite.close());
const storage = initial => {
  const values = new Map(Object.entries(initial || {}));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key), key: index => [...values.keys()][index], get length() { return values.size; } };
};
const fixture = (Component = () => null, values = {}) => {
  customer.resetCustomerSessions();
  portalRequests.clearPortalRequests('customer'); portalRequests.clearPortalRequests('delivery');
  return hookHarness(Component, {}, '/delivery', undefined, { localStorage: storage(values), sessionStorage: storage() });
};
const response = (status, roles = ['buyer']) => ({ success: true, token: 'delivery-fixture-token', sessionRole: 'delivery',
  user: { _id: 'delivery-fixture-user', roles }, deliveryState: { status, onboardingStep: 2 } });

for (const status of ['incomplete', 'pending', 'under_review', 'rejected', 'suspended', 'approved']) {
  test(`delivery OTP login accepts the server's ${status} application session`, async () => {
    const h = fixture(undefined, { userToken: 'separate-customer-token' });
    try {
      const pending = delivery.completeDeliveryLogin('9876500000', '1234', undefined, 'login');
      assert.match(h.requests[0].url, /\/api\/auth\/delivery\/verify-otp$/);
      const body = response(status, status === 'approved' ? ['buyer', 'delivery'] : ['buyer']);
      h.requests[0].resolve(body);
      const result = await pending;
      assert.equal(result.profile.status, status);
      assert.equal(localStorage.getItem('deliveryToken'), body.token);
      assert.deepEqual(JSON.parse(localStorage.getItem('deliveryUserProfile')).roles, body.user.roles);
      assert.equal(localStorage.getItem('userToken'), 'separate-customer-token');
      assert.equal(window.location.pathname, '/delivery/dashboard');
      assert.equal(h.requests.length, 1);
      assert.equal(localStorage.getItem('delivery_onboarded'), null);
    } finally { h.close(); }
  });
}

test('registration saves an incomplete applicant only after starting onboarding successfully', async () => {
  const h = fixture();
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '1234', 'Applicant', 'register');
    h.requests[0].resolve(response('incomplete')); await h.settle();
    assert.equal(localStorage.getItem('deliveryToken'), null);
    assert.match(h.requests[1].url, /\/api\/delivery\/start$/);
    assert.equal(h.requests[1].options.headers.Authorization, 'Bearer delivery-fixture-token');
    h.requests[1].resolve({ success: true, data: { status: 'incomplete', onboardingStep: 1 } });
    const result = await pending;
    assert.equal(result.profile.onboardingStep, 1); assert.equal(localStorage.getItem('deliveryToken'), 'delivery-fixture-token');
    assert.deepEqual(JSON.parse(localStorage.getItem('deliveryUserProfile')).roles, ['buyer']);
  } finally { h.close(); }
});

test('invalid delivery claims preserve both existing portal sessions', () => {
  const h = fixture(undefined, { deliveryToken: 'existing-delivery-token', userToken: 'existing-customer-token' });
  try {
    for (const body of [response('approved'), response('unknown'), { ...response('pending'), deliveryState: undefined },
      { ...response('pending'), sessionRole: 'buyer' }, { ...response('pending'), token: null },
      response('pending', []), response('pending', ['unsupported'])]) {
      assert.throws(() => session.saveDeliverySession(body), /Invalid Delivery login session/);
      assert.equal(localStorage.getItem('deliveryToken'), 'existing-delivery-token');
      assert.equal(localStorage.getItem('userToken'), 'existing-customer-token');
    }
  } finally { h.close(); }
});

test('invalid OTP never saves an applicant session', async () => {
  const h = fixture();
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '0000', undefined, 'login');
    const rejected = assert.rejects(pending, /Invalid OTP/);
    h.requests[0].resolve({ success: false, message: 'Invalid OTP' }, 400); await rejected;
    assert.equal(localStorage.getItem('deliveryToken'), null); assert.equal(window.location.pathname, '/delivery');
  } finally { h.close(); }
});

test('verified legacy applicant credentials migrate from customer storage without redirecting the shop', async () => {
  const h = fixture(Gate, { userToken: 'legacy-applicant-token' });
  try {
    const body = response('pending');
    h.requests[0].resolve({ success: true, userType: 'user', sessionRole: 'delivery', profile: body.user, deliveryState: body.deliveryState });
    await h.settle();
    assert.equal(localStorage.getItem('deliveryToken'), 'legacy-applicant-token');
    assert.equal(localStorage.getItem('userToken'), null); assert.equal(window.location.pathname, '/delivery');
  } finally { h.close(); }
});

for (const status of ['incomplete', 'pending', 'under_review', 'rejected', 'suspended']) {
  test(`${status} applicants restore their profile without unlocking delivery work`, async () => {
    const h = fixture(DeliveryProvider, { deliveryToken: 'applicant-token' });
    try {
      const body = response(status);
      h.requests.find(req => req.url.endsWith('/api/auth/me')).resolve({
        success: true, userType: 'user', sessionRole: 'delivery', profile: body.user, deliveryState: body.deliveryState,
      });
      await h.settle();
      h.requests.find(req => req.url.endsWith('/api/delivery/me')).resolve({
        success: true, data: { _id: 'partner', name: 'Applicant', phone: '9876500000', status, onboardingStep: 2 },
      });
      await h.settle();
      assert.equal(h.tree.props.value.bootstrapping, false);
      assert.equal(h.tree.props.value.riderAuthed, true);
      assert.equal(h.tree.props.value.riderProfile.status, status);
      assert.equal(h.tree.props.value.isOnboarded, false);
      assert.equal(localStorage.getItem('delivery_onboarded'), null);
    } finally { h.close(); }
  });
}
