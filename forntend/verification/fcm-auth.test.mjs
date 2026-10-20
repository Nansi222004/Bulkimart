import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
let vite, push, portal, backend;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  push = await vite.ssrLoadModule('/src/utils/firebaseMessaging.js');
  portal = await vite.ssrLoadModule('/src/utils/portalSession.js');
  backend = await vite.ssrLoadModule('/src/utils/sessionBackend.js');
});
after(async () => vite.close());
function fixture(scope = 'delivery') {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, localStorage: globalThis.localStorage };
  const values = new Map();
  globalThis.window = { location: { pathname: `/${scope}/dashboard`, origin: 'http://localhost:4173' } };
  globalThis.localStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify({ success: true, userType: 'user', sessionRole: scope, profile: { _id: 'fixture-driver' } }), { headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, values, close() { Object.assign(globalThis, previous); } };
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
