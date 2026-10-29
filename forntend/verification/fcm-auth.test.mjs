import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { pushCacheFixture } from './push-cache-fixture.mjs';
let vite, push, portal, backend, pushState;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  push = await vite.ssrLoadModule('/src/utils/firebaseMessaging.js');
  portal = await vite.ssrLoadModule('/src/utils/portalSession.js');
  backend = await vite.ssrLoadModule('/src/utils/sessionBackend.js');
  pushState = await vite.ssrLoadModule('/src/utils/pushSessionState.js');
});
after(async () => vite.close());
function fixture(scope = 'delivery') {
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const device = { unsubscribed: 0, closed: 0, notifications: [] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false, serviceWorker: { async getRegistration() { return {
    getNotifications: async () => device.notifications,
    pushManager: { async getSubscription() { return { async unsubscribe() { device.unsubscribed++; return true; } }; } },
  }; } } } });
  const previous = { fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage, caches: globalThis.caches };
  const cacheFixture = pushCacheFixture(); globalThis.caches = cacheFixture.caches;
  const values = new Map();
  globalThis.window = { location: { pathname: `/${scope}/dashboard`, origin: 'http://localhost:4173' } };
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify({ success: true, userType: 'user', sessionRole: scope === 'customer' ? 'buyer' : scope, profile: { _id: 'fixture-driver' } }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, values, device, ...cacheFixture, close() {
    Object.assign(globalThis, previous);
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor); else delete globalThis.navigator;
  } };
}
test('FCM registers only after server authentication using the delivery credential', async () => {
  const f = fixture();
  try {
    localStorage.setItem('deliveryToken', 'delivery-login-fixture'); localStorage.setItem('userToken', 'different-customer-fixture'); backend.bindSessionBackend('delivery');
    assert.equal(await push.registerTokenWithBackend('fcm-device-fixture'), true);
    assert.equal(f.calls.length, 2); assert.match(f.calls[0].url, /\/api\/auth\/me$/);
    assert.match(f.calls[1].url, /\/api\/notifications\/tokens$/);
    for (const call of f.calls) assert.equal(call.options.headers.Authorization, 'Bearer delivery-login-fixture');
    assert.deepEqual(JSON.parse(f.calls[1].options.body), { token: 'fcm-device-fixture', platform: 'web' });
  } finally { f.close(); }
});
test('missing authentication and a mismatched backend binding send no request', async () => {
  const f = fixture();
  try {
    await push.registerTokenWithBackend('fcm-device-fixture'); assert.equal(f.calls.length, 0);
    localStorage.setItem('deliveryToken', 'fixture'); localStorage.setItem('bulkimart:delivery:session-api-origin', 'https://different-backend.example');
    assert.equal(portal.getPortalToken(), null);
    await push.registerTokenWithBackend('fcm-device-fixture'); assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});
test('expired, invalid or wrong-role sessions never send an FCM token', async () => {
  for (const status of [401, 403, 200]) {
    const f = fixture();
    try {
      localStorage.setItem('deliveryToken', 'fixture');
      globalThis.fetch = async (url, options) => { f.calls.push({ url, options }); return new Response(JSON.stringify({ success: status === 200, userType: 'user', sessionRole: 'buyer', profile: { _id: 'other' } }), { status, headers: { 'Content-Type': 'application/json' } }); };
      assert.equal(await push.registerTokenWithBackend('fcm-device-fixture'), undefined);
      assert.equal(f.calls.length, 1); assert.match(f.calls[0].url, /\/api\/auth\/me$/);
      assert.equal(localStorage.getItem('bulkimart_delivery_fcm_token'), null);
    } finally { f.close(); }
  }
});
test('account changes during authentication discard the pending registration', async () => {
  const f = fixture();
  try {
    localStorage.setItem('deliveryToken', 'first');
    globalThis.fetch = async () => { localStorage.setItem('deliveryToken', 'second'); return new Response(JSON.stringify({ success: true, userType: 'user', sessionRole: 'delivery', profile: { _id: 'first' } })); };
    assert.equal(await push.registerTokenWithBackend('fcm-device-fixture'), undefined);
    assert.equal(localStorage.getItem('bulkimart_delivery_fcm_token'), null);
  } finally { f.close(); }
});

for (const scope of ['customer', 'seller', 'delivery', 'admin']) test(`${scope} logout disables local push even when the backend is offline`, async () => {
  const f = fixture(scope);
  const key = portal.portalTokenKey(scope), deviceKey = portal.pushTokenKey(scope);
  try {
    localStorage.setItem(key, 'login-fixture'); localStorage.setItem(deviceKey, 'device-fixture');
    assert.equal(await pushState.enablePushSession(scope, 'fixture-account', 'device-fixture', () => true), true);
    f.device.notifications.push({ data: { audience: { customer: 'user', seller: 'seller', delivery: 'rider', admin: 'admin' }[scope] }, close() { f.device.closed++; } });
    globalThis.fetch = async (url, options) => { f.calls.push({ url, options }); throw new Error('offline fixture'); };
    const cleanup = push.deregisterPushToken(scope);
    assert.equal(pushState.getPushSession(scope), null, 'Foreground display is disabled synchronously');
    localStorage.removeItem(key);
    await cleanup;
    assert.equal(await f.cache.match(pushState.pushSessionPath(scope)), undefined, 'Background display is disabled without a server response');
    assert.equal(localStorage.getItem(deviceKey), null);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].options.headers.Authorization, 'Bearer login-fixture');
    assert.equal(f.calls[0].options.keepalive, true);
    assert.equal(f.device.unsubscribed, 1, 'The browser subscription is removed even offline');
    assert.equal(f.device.closed, 1, 'Already displayed notifications for this module are dismissed');
  } finally { f.close(); }
});

test('admin scope never uses or removes the customer credential or push state', async () => {
  const f = fixture('admin');
  try {
    localStorage.setItem('adminToken', 'admin-login'); localStorage.setItem('userToken', 'customer-login');
    localStorage.setItem('nhcone_fcm_token', 'customer-device');
    await pushState.enablePushSession('customer', 'customer-account', 'customer-device', () => true);
    assert.equal(portal.portalScope(), 'admin'); assert.equal(portal.getPortalToken(), 'admin-login');
    await push.deregisterPushToken();
    assert.equal(localStorage.getItem('nhcone_fcm_token'), 'customer-device');
    assert.ok(await f.cache.match(pushState.pushSessionPath('customer')));
    assert.equal(f.calls.length, 0);
  } finally { f.close(); }
});

test('logout preserves another signed-in portal sharing this browser token', async () => {
  const f = fixture('seller');
  try {
    localStorage.setItem('sellerToken', 'seller-login'); localStorage.setItem('userToken', 'customer-login');
    localStorage.setItem(portal.pushTokenKey('seller'), 'shared-device');
    await pushState.enablePushSession('seller', 'same-account', 'shared-device', () => true);
    await pushState.enablePushSession('customer', 'same-account', 'shared-device', () => true);
    await push.deregisterPushToken('seller');
    assert.equal(await f.cache.match(pushState.pushSessionPath('seller')), undefined);
    assert.ok(await f.cache.match(pushState.pushSessionPath('customer')));
    assert.equal(f.calls.length, 1, 'The server removes this seller session role while retaining other roles');
    assert.equal(f.calls[0].options.method, 'DELETE');
    assert.equal(f.device.unsubscribed, 0, 'The signed-in customer keeps the shared browser subscription');
  } finally { f.close(); }
});

test('a late token response after logout cannot restore background push', async () => {
  const f = fixture();
  try {
    localStorage.setItem('deliveryToken', 'old-login');
    let finishPost;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (options?.method === 'POST') return new Promise(resolve => { finishPost = resolve; });
      return original(url, options);
    };
    const registration = push.registerTokenWithBackend('late-device');
    while (!finishPost) await new Promise(resolve => setImmediate(resolve));
    await push.deregisterPushToken('delivery'); localStorage.removeItem('deliveryToken');
    finishPost(new Response('{}'));
    assert.equal(await registration, false);
    assert.equal(pushState.getPushSession('delivery'), null);
    assert.equal(await f.cache.match(pushState.pushSessionPath('delivery')), undefined);
    assert.ok(f.calls.some(call => call.options.method === 'DELETE'));
  } finally { f.close(); }
});

test('offline logout also revokes a shared subscription so the logged-out role cannot trigger generic browser alerts', async () => {
  const f = fixture('seller');
  try {
    localStorage.setItem('sellerToken', 'seller-login'); localStorage.setItem('userToken', 'customer-login');
    localStorage.setItem(portal.pushTokenKey('seller'), 'shared-device');
    await pushState.enablePushSession('seller', 'same-account', 'shared-device', () => true);
    await pushState.enablePushSession('customer', 'same-account', 'shared-device', () => true);
    globalThis.fetch = async () => { throw new Error('Offline fixture'); };
    await push.deregisterPushToken('seller');
    assert.equal(pushState.getPushSession('seller'), null);
    assert.equal(f.device.unsubscribed, 1);
    assert.ok(pushState.getPushSession('customer'), 'The customer session remains eligible for restoration when online');
  } finally { f.close(); }
});

test('a new login enables push again after a previous logout', async () => {
  const f = fixture();
  try {
    localStorage.setItem('deliveryToken', 'old-login');
    assert.equal(await push.registerTokenWithBackend('device-fixture'), true);
    await push.deregisterPushToken('delivery');
    localStorage.setItem('deliveryToken', 'new-login');
    assert.equal(await push.registerTokenWithBackend('device-fixture'), true);
    assert.equal(pushState.getPushSession('delivery').recipientId, 'fixture-driver');
    assert.ok(await f.cache.match(pushState.pushSessionPath('delivery')));
  } finally { f.close(); }
});

test('admin push validates an Admin identity and keeps its device session separate from the seller', async()=>{
 const f=fixture('admin');
 try{
  localStorage.setItem('adminToken','admin-session');backend.bindSessionBackend('admin');
  globalThis.fetch=async(url,options)=>{f.calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/api/auth/me')?{success:true,userType:'admin',profile:{_id:'admin-id'}}:{success:true}));};
  assert.equal(await push.registerTokenWithBackend('admin-device'),true);
  assert.equal(pushState.getPushSession('admin').recipientId,'admin-id');assert.equal(pushState.getPushSession('seller'),null);
  assert.equal(f.calls[1].options.headers.Authorization,'Bearer admin-session');
  await push.deregisterPushToken('admin');assert.match(f.calls.at(-1).url,/tokens\/admin-device$/);assert.equal(pushState.getPushSession('admin'),null);
 }finally{f.close();}
});
