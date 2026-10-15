import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, Gate, session, delivery, DeliveryRoutes, UserProvider, DeliveryProvider, socket, customerSession, portal;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  Gate = (await vite.ssrLoadModule('/src/components/CustomerSessionGate.jsx')).default;
  session = await vite.ssrLoadModule('/src/utils/userSession.js');
  portal = await vite.ssrLoadModule('/src/utils/portalSession.js');
  customerSession = await vite.ssrLoadModule('/src/utils/customerSession.js');
  delivery = await vite.ssrLoadModule('/src/modules/Delivery/utils/deliveryAuth.js');
  DeliveryRoutes = (await vite.ssrLoadModule('/src/modules/Delivery/routes/index.jsx')).default;
  UserProvider = (await vite.ssrLoadModule('/src/modules/User/context/UserContext.jsx')).UserProvider;
  DeliveryProvider = (await vite.ssrLoadModule('/src/modules/Delivery/context/DeliveryContext.jsx')).DeliveryProvider;
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket;
  socket.connect = () => socket; // No live socket connections in isolated UI tests.
});
after(async () => { await vite.close(); });
function storage(values = {}) {
  const result = { ...values };
  Object.defineProperties(result, {
    getItem: { value: key => result[key] ?? null },
    setItem: { value: (key, value) => { result[key] = String(value); } },
    removeItem: { value: key => { delete result[key]; } },
  });
  return result;
}
function harness(Component = Gate, values = { userToken: 'old-token', userProfile: '{"_id":"stale"}' }, path = '/account') {
  return hookHarness(Component, { children: React.createElement('main', { id: 'protected-child' }) }, path, undefined,
    { localStorage: storage(values), sessionStorage: storage({ 'bulkimart:checkout:create:previous': 'private-data', unrelated: 'keep' }) });
}
const identity = (role = 'buyer', id = 'current') => ({ success: true, userType: 'user', sessionRole: role, profile: { _id: id, roles: role === 'delivery' ? ['buyer', 'delivery'] : ['buyer'] } });
const loginBody = (role = 'delivery', id = 'rider') => ({ success: true, token: `${id}-token`, sessionRole: role, user: { _id: id, name: 'Fixture', roles: role === 'delivery' ? ['buyer', 'delivery'] : ['buyer'] }, deliveryState: { status: 'approved', onboardingStep: 4 } });

test('seller login cannot overwrite customer session or trigger customer verification in either tab', async () => {
  const h = harness(Gate, { userToken: 'customer-fixture-token' });
  try {
    h.requests[0].resolve(identity('buyer', 'customer-fixture')); await h.settle();
    portal.saveSellerSession({ success: true, token: 'seller-fixture-token', sessionRole: 'seller', user: { _id: 'seller-fixture', roles: ['buyer', 'seller'] } });
    const changed = new Event('storage'); Object.defineProperty(changed, 'key', { value: 'sellerToken' }); window.dispatchEvent(changed); h.flush();
    assert.equal(localStorage.getItem('userToken'), 'customer-fixture-token');
    assert.equal(h.tree.props.value.profile._id, 'customer-fixture'); assert.equal(h.requests.length, 1);
    window.history.pushState(null, '', '/seller/orders');
    assert.equal(portal.getPortalToken(), 'seller-fixture-token');
    window.history.pushState(null, '', '/account'); assert.equal(portal.getPortalToken(), 'customer-fixture-token');
    session.clearUserSession(); assert.equal(localStorage.getItem('sellerToken'), 'seller-fixture-token');
  } finally { h.close(); }
});

test('legacy seller credential in customer storage fails closed rather than showing seller buyer-membership profile', async () => {
  const h = harness();
  try {
    h.requests[0].resolve({ ...identity('seller', 'seller-fixture'), profile: { _id: 'seller-fixture', roles: ['buyer', 'seller'] } });
    await h.settle(); assert.equal(localStorage.getItem('userToken'), null);
    assert.match(h.tree.props.children.flat().filter(x => typeof x === 'string').join(' '), /seller session/);
    assert.equal(h.find(n => n.type === 'main'), undefined);
  } finally { h.close(); }
});

test('malformed seller login cannot replace either authenticated principal', () => {
  const h = harness(() => null, { userToken: 'customer', sellerToken: 'existing-seller' });
  try {
    for (const sessionRole of ['buyer', null, 'Seller']) assert.throws(() => portal.saveSellerSession({ success: true, token: 'new', sessionRole, user: { _id: 'fixture', roles: ['seller'] } }));
    assert.equal(localStorage.getItem('userToken'), 'customer'); assert.equal(localStorage.getItem('sellerToken'), 'existing-seller');
  } finally { h.close(); }
});

test('first visitor sees public content immediately with no verification request', () => {
  const h = harness(Gate, {}, '/');
  try { assert.ok(h.find(n => n.type === 'main')); assert.equal(h.requests.length, 0); }
  finally { h.close(); }
});
test('slow session verification does not block public content or trust cached profile', async () => {
  const h = harness(Gate, undefined, '/');
  try {
    assert.ok(h.find(n => n.type === 'main')); assert.equal(h.tree.props.value.verified, false);
    h.requests[0].resolve(identity()); await h.settle(); assert.equal(h.tree.props.value.verified, true);
  } finally { h.close(); }
});
test('public 500/offline failures keep browsing available and expose recovery', async () => {
  for (const offline of [false, true]) {
    const h = harness(Gate, undefined, '/search');
    try {
      if (offline) h.requests[0].reject(new Error('offline')); else h.requests[0].resolve({}, 500);
      await h.settle(); assert.ok(h.find(n => n.type === 'main')); assert.ok(h.find(n => n.props?.role === 'alert')); assert.equal(h.tree.props.value.verified, false);
    } finally { h.close(); }
  }
});
test('effect replay shares one pending verification without caching completed results', async () => {
  const h = harness(() => null, {}, '/');
  let first, second;
  try {
    first = customerSession.acquireCustomerSession('dedup-fixture'); first.release();
    second = customerSession.acquireCustomerSession('dedup-fixture'); assert.equal(h.requests.length, 1);
    h.requests[0].resolve(identity()); await second.promise;
    second.release(); second = customerSession.acquireCustomerSession('dedup-fixture'); assert.equal(h.requests.length, 2);
    h.requests[1].resolve(identity()); await second.promise;
  } finally { second?.release(); h.close(); }
});
test('hung verification times out even when the transport never settles', async () => {
  const h = harness(() => null, {}, '/');
  const request = customerSession.acquireCustomerSession('timeout-fixture', 15);
  try { await assert.rejects(request.promise, /timed out/); assert.equal(h.requests[0].options.signal.aborted, true); }
  finally { request.release(); h.close(); }
});
test('unverified public provider never reads cached identity or fetches protected startup APIs', () => {
  const h = hookHarness(UserProvider, {}, '/', { verified: false }, { localStorage: storage({ userToken: 'pending-token', userProfile: JSON.stringify(identity().profile) }) });
  try {
    assert.equal(h.tree.props.value.currentUser, null);
    assert.equal(h.requests.filter(r => /\/api\/(users\/profile|wallet|orders|users\/addresses|cart|wishlist)/.test(r.url)).length, 0);
  } finally { h.close(); }
});

test('direct customer protected route waits for trusted buyer session before displaying children', async () => {
  const h = harness();
  try {
    assert.ok(h.find(n => n.props?.role === 'status')); assert.equal(h.find(n => n.type === 'main'), undefined);
    assert.match(h.requests[0].url, /\/api\/auth\/me$/);
    h.requests[0].resolve(identity()); await h.settle();
    assert.ok(h.find(n => n.type === 'main')); assert.equal(JSON.parse(localStorage.getItem('userProfile'))._id, 'current');
    assert.equal(window.location.pathname, '/account');
  } finally { h.close(); }
});
test('Delivery session restored on customer route redirects to actual Delivery dashboard', async () => {
  const h = harness();
  try { h.requests[0].resolve(identity('delivery')); await h.settle(); assert.equal(window.location.pathname, '/delivery/dashboard'); assert.equal(h.find(n => n.type === 'main'), undefined); }
  finally { h.close(); }
});
test('refresh and new-tab restoration derive role from server rather than cached buyer profile', async () => {
  for (const path of ['/', '/account', '/orders']) {
    const h = harness(Gate, { userToken: 'delivery-token', userProfile: '{"roles":["buyer"]}' }, path);
    try { h.requests[0].resolve(identity('delivery')); await h.settle(); assert.equal(window.location.pathname, '/delivery/dashboard'); }
    finally { h.close(); }
  }
});
test('expired and invalid tokens clear cached identity and allow only guest storefront', async () => {
  for (const status of [401, 403]) {
    const h = harness();
    try { h.requests[0].resolve({ success: false }, status); await h.settle(); assert.equal(localStorage.getItem('userToken'), null); assert.equal(localStorage.getItem('userProfile'), null); assert.ok(h.find(n => n.type === 'main')); }
    finally { h.close(); }
  }
});
test('unknown, missing and admin roles do not open customer authenticated content', async () => {
  for (const body of [identity('Delivery'), identity(undefined), { ...identity(), sessionRole: null }, { ...identity(), userType: 'admin' }]) {
    if (body.sessionRole === 'buyer') delete body.sessionRole;
    const h = harness();
    try { h.requests[0].resolve(body); await h.settle(); assert.ok(h.find(n => n.props?.role === 'alert')); assert.equal(h.find(n => n.type === 'main'), undefined); }
    finally { h.close(); }
  }
});
test('network failure offers retry without trusting the cached profile', async () => {
  const h = harness();
  try { h.requests[0].reject(new Error('offline')); await h.settle(); assert.ok(h.find(n => n.props?.role === 'alert')); assert.equal(h.find(n => n.type === 'main'), undefined); h.click('Retry'); h.requests[1].resolve(identity()); await h.settle(); assert.ok(h.find(n => n.type === 'main')); }
  finally { h.close(); }
});
test('late restore cannot overwrite an account switched in this tab', async () => {
  const h = harness();
  try {
    session.saveUserSession(loginBody('buyer', 'second')); h.flush(); assert.equal(h.requests.length, 2);
    h.requests[1].resolve(identity('buyer', 'second')); await h.settle(); h.requests[0].resolve(identity('delivery', 'old')); await h.settle();
    assert.equal(JSON.parse(localStorage.getItem('userProfile'))._id, 'second'); assert.equal(window.location.pathname, '/account');
  } finally { h.close(); }
});
test('cross-tab account changes revalidate and clear the previously displayed account', async () => {
  const h = harness();
  try {
    h.requests[0].resolve(identity()); await h.settle();
    localStorage.setItem('userToken', 'new-delivery-token'); const event = new Event('storage'); Object.defineProperty(event, 'key', { value: 'userToken' }); window.dispatchEvent(event); h.flush();
    assert.equal(h.find(n => n.type === 'main'), undefined); h.requests[1].resolve(identity('delivery')); await h.settle(); assert.equal(window.location.pathname, '/delivery/dashboard');
  } finally { h.close(); }
});
test('unmount invalidates pending session restoration', async () => {
  const h = harness();
  try { h.unmount(); const updates = h.updates; h.requests[0].resolve(identity('delivery')); await h.settle(); assert.equal(h.updates, updates); assert.equal(window.location.pathname, '/account'); }
  finally { h.close(); }
});
test('Delivery sign-in uses explicit endpoint and intent, then navigates without creating another application', async () => {
  const h = harness(() => null, {}, '/delivery/onboarding');
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '1234', undefined, 'login');
    assert.match(h.requests[0].url, /\/api\/auth\/delivery\/verify-otp$/); assert.equal(JSON.parse(h.requests[0].options.body).intent, 'login');
    h.requests[0].resolve(loginBody()); const result = await pending;
    assert.equal(result.profile.status, 'approved'); assert.equal(h.requests.length, 1); assert.equal(window.location.pathname, '/delivery/dashboard'); assert.equal(localStorage.getItem('userToken'), 'rider-token');
  } finally { h.close(); }
});
test('registration saves session only after successful explicit name/onboarding operation', async () => {
  const h = harness(() => null, {});
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '1234', 'New Rider', 'register');
    h.requests[0].resolve({ ...loginBody(), deliveryState: { status: 'incomplete' } }); await h.settle();
    assert.equal(localStorage.getItem('userToken'), null); assert.match(h.requests[1].url, /\/api\/delivery\/start$/); assert.equal(JSON.parse(h.requests[1].options.body).name, 'New Rider');
    h.requests[1].resolve({ success: true, data: { status: 'incomplete', onboardingStep: 1 } }); await pending;
    assert.equal(localStorage.getItem('userToken'), 'rider-token');
  } finally { h.close(); }
});
test('failed registration operation does not claim login success or replace a previous account', async () => {
  const h = harness(() => null);
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '1234', 'New Rider', 'register'); const check = assert.rejects(pending, /Upload unavailable/);
    h.requests[0].resolve(loginBody()); await h.settle(); h.requests[1].resolve({ success: false, message: 'Upload unavailable' }, 500); await check;
    assert.equal(localStorage.getItem('userToken'), 'old-token'); assert.equal(window.location.pathname, '/account');
  } finally { h.close(); }
});
test('invalid OTP or wrong role response never persists a Delivery session', async () => {
  for (const [body, status] of [[{ message: 'Invalid OTP' }, 400], [loginBody('buyer'), 200], [{ ...loginBody(), token: null }, 200]]) {
    const h = harness(() => null, {});
    try { const pending = delivery.completeDeliveryLogin('9876500000', '0000', undefined, 'login'); const check = assert.rejects(pending); h.requests[0].resolve(body, status); await check; assert.equal(localStorage.getItem('userToken'), null); assert.equal(h.requests.length, 1); }
    finally { h.close(); }
  }
});
test('both logout/switch directions clear rider flags, money caches, checkout and old identity', () => {
  const h = harness(() => null, { userToken: 'first-token', userProfile: '{"_id":"first"}', delivery_onboarded: 'true', deliveryDebitWallet: '100', deliveryEarningsDaily: 'private' });
  try {
    for (const role of ['buyer', 'delivery']) {
      session.clearUserSession(); assert.equal(localStorage.getItem('userToken'), null); assert.equal(localStorage.getItem('delivery_onboarded'), null); assert.equal(localStorage.getItem('deliveryDebitWallet'), null); assert.equal(sessionStorage.getItem('bulkimart:checkout:create:previous'), null); assert.equal(sessionStorage.getItem('unrelated'), 'keep');
      session.saveUserSession(loginBody(role, role)); assert.equal(JSON.parse(localStorage.getItem('userProfile'))._id, role);
    }
  } finally { h.close(); }
});
test('malformed login cannot partially replace a valid existing session', () => {
  const h = harness(() => null);
  try { for (const body of [{ ...loginBody(), token: null }, { ...loginBody(), sessionRole: 'Delivery' }, { ...loginBody(), user: null }]) assert.throws(() => session.saveUserSession(body)); assert.equal(localStorage.getItem('userToken'), 'old-token'); }
  finally { h.close(); }
});
test('Delivery provider identity is remounted on account changes and logout', () => {
  const h = harness(DeliveryRoutes, { userToken: 'rider-token' }, '/delivery/dashboard');
  try { const key = h.tree.key; session.clearUserSession(); h.flush(); assert.notEqual(h.tree.key, key); const next = h.tree.key; session.saveUserSession(loginBody('buyer')); h.flush(); assert.notEqual(h.tree.key, next); }
  finally { h.close(); }
});
test('actual User provider parses buyer login response and Delivery redirect without selecting buyer state for Delivery', async () => {
  for (const role of ['buyer', 'delivery']) {
    const h = harness(UserProvider, {});
    try {
      const pending = h.tree.props.value.verifyOtp('9876500000', '1234', true);
      const request = h.requests.find(req => req.url.endsWith('/api/auth/verify-otp'));
      assert.equal(JSON.parse(request.options.body).isLogin, true);
      request.resolve(loginBody(role)); const result = await pending; h.flush();
      assert.equal(result.success, true);
      if (role === 'delivery') { assert.equal(window.location.pathname, '/delivery/dashboard'); assert.equal(h.tree.props.value.currentUser, null); }
      else { assert.equal(h.tree.props.value.currentUser._id, 'rider'); assert.equal(window.location.pathname, '/account'); }
    } finally { h.close(); }
  }
});
test('actual Delivery provider denies buyer-token dashboard restoration', async () => {
  const h = harness(DeliveryProvider, { userToken: 'buyer-token' }, '/delivery/dashboard');
  try {
    const request = h.requests.find(req => req.url.endsWith('/api/auth/me')); request.resolve(identity('buyer')); await h.settle();
    assert.equal(h.tree.props.value.bootstrapping, false); assert.equal(h.tree.props.value.riderAuthed, false); assert.equal(h.tree.props.value.isOnboarded, false);
    assert.equal(h.requests.some(req => req.url.endsWith('/api/delivery/me')), false);
  } finally { h.close(); }
});
test('actual Delivery provider restores approved dashboard only after verified session and profile', async () => {
  const h = harness(DeliveryProvider, { userToken: 'delivery-token' }, '/delivery/dashboard');
  try {
    h.requests.find(req => req.url.endsWith('/api/auth/me')).resolve(identity('delivery')); await h.settle();
    assert.equal(h.tree.props.value.riderAuthed, false);
    h.requests.find(req => req.url.endsWith('/api/delivery/me')).resolve({ success: true, data: { _id: 'partner', name: 'Fixture Rider', phone: '9876500000', status: 'approved', earnings: { pending: 50 } } }); await h.settle();
    assert.equal(h.tree.props.value.bootstrapping, false); assert.equal(h.tree.props.value.riderAuthed, true); assert.equal(h.tree.props.value.isOnboarded, true);
    assert.equal(h.tree.props.value.riderProfile._id, 'partner');
  } finally { h.close(); }
});
test('explicit shopping action uses authenticated server membership check and replaces session before navigation', async () => {
  const h = harness(() => null, { userToken: 'delivery-token' }, '/delivery/profile');
  try {
    const pending = session.enterCustomerSession(); assert.match(h.requests[0].url, /\/api\/auth\/customer-session$/);
    assert.equal(h.requests[0].options.headers.Authorization, 'Bearer delivery-token');
    h.requests[0].resolve(loginBody('buyer', 'same-person')); await pending;
    assert.equal(window.location.pathname, '/'); assert.equal(localStorage.getItem('userToken'), 'same-person-token');
  } finally { h.close(); }
});
test('denied shopping switch retains Delivery session and route', async () => {
  const h = harness(() => null, { userToken: 'delivery-token' }, '/delivery/profile');
  try {
    const pending = session.enterCustomerSession(); const check = assert.rejects(pending, /not authorized/);
    h.requests[0].resolve({ message: 'not authorized' }, 403); await check;
    assert.equal(window.location.pathname, '/delivery/profile'); assert.equal(localStorage.getItem('userToken'), 'delivery-token');
  } finally { h.close(); }
});
test('Delivery login completing after logout cannot restore the old account', async () => {
  const h = harness(() => null, {});
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '1234', undefined, 'login');
    const check = assert.rejects(pending, /session changed/); session.clearUserSession();
    h.requests[0].resolve(loginBody()); await check; assert.equal(localStorage.getItem('userToken'), null);
  } finally { h.close(); }
});
test('Delivery login completing after a newer buyer login cannot replace the buyer', async () => {
  const h = harness(() => null, {});
  try {
    const pending = delivery.completeDeliveryLogin('9876500000', '1234', undefined, 'login');
    const check = assert.rejects(pending, /session changed/); session.saveUserSession(loginBody('buyer', 'new-buyer'));
    h.requests[0].resolve(loginBody()); await check; assert.equal(localStorage.getItem('userToken'), 'new-buyer-token');
  } finally { h.close(); }
});
