import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pushCacheFixture } from './push-cache-fixture.mjs';

const routing = await readFile(new URL('../public/notification-routing.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../public/firebase-messaging-sw.js', import.meta.url), 'utf8');
function harness(sessions = {}) {
  const fixture = pushCacheFixture(sessions);
  const handlers = {}, shown = [], opened = []; let background;
  const self = {
    location: new URL('https://fixture.invalid/firebase-messaging-sw.js'),
    addEventListener(name, callback) { handlers[name] = callback; },
    registration: { async showNotification(title, options) { shown.push({ title, options }); } },
    clients: { async matchAll() { return []; }, async openWindow(path) { opened.push(path); } },
  };
  const sandbox = vm.createContext({ self, caches: fixture.caches, URL, URLSearchParams,
    firebase: { initializeApp() {}, messaging: () => ({ onBackgroundMessage(callback) { background = callback; } }) },
    importScripts(path) { if (path.startsWith('/')) vm.runInContext(routing, sandbox); },
  });
  vm.runInContext(worker, sandbox);
  return { ...fixture, shown, opened, background, handlers, sandbox,
    async click(data) {
      let pending;
      handlers.notificationclick({ notification: { data, close() {} }, stopImmediatePropagation() {}, waitUntil(promise) { pending = promise; } });
      await pending;
    },
  };
}

for (const [scope, audience, route] of [
  ['customer', 'user', '/orders'], ['seller', 'seller', '/seller/orders'],
  ['delivery', 'rider', '/delivery/dashboard'], ['admin', 'admin', '/admin'],
]) test(`${scope} background notifications and clicks stop after logout, including delayed pushes`, async () => {
  const h = harness({ [scope]: { recipientId: 'account-fixture' } });
  const data = { recipientId: 'account-fixture', audience, event: 'SYSTEM', title: 'Update', body: 'Fixture', route };
  await h.background({ data }); assert.equal(h.shown.length, 1);
  await h.click(data); assert.equal(h.opened.length, 1);
  await h.cache.delete(`/__bulkimart_push_session__/${scope}`);
  await h.background({ data }); await h.background({ data });
  await h.click(data);
  assert.equal(h.shown.length, 1, 'No notifications after local logout even if FCM still delivers');
  assert.equal(h.opened.length, 1, 'An old notification cannot reopen the logged-out account');
});

test('logging out seller leaves a signed-in customer eligible on the same device', async () => {
  const h = harness({ customer: { recipientId: 'account-fixture' }, seller: { recipientId: 'account-fixture' } });
  await h.cache.delete('/__bulkimart_push_session__/seller');
  await h.background({ data: { recipientId: 'account-fixture', audience: 'seller', title: 'Seller' } });
  await h.background({ data: { recipientId: 'account-fixture', audience: 'user', title: 'Customer' } });
  assert.deepEqual(h.shown.map(notification => notification.title), ['Customer']);
});

test('account switching blocks a queued push addressed to the previous account', async () => {
  const h = harness({ delivery: { recipientId: 'new-account' } });
  await h.background({ data: { recipientId: 'old-account', audience: 'rider', title: 'Old' } });
  await h.background({ data: { recipientId: 'new-account', audience: 'rider', title: 'New' } });
  assert.deepEqual(h.shown.map(notification => notification.title), ['New']);
});

test('unavailable storage, missing recipients and unknown audiences deny background display', async () => {
  const h = harness({ seller: { recipientId: 'account-fixture' } });
  await h.background({ data: { audience: 'seller', title: 'Missing recipient' } });
  await h.background({ data: { audience: 'unknown', recipientId: 'account-fixture' } });
  h.sandbox.caches = { async open() { throw new Error('Storage unavailable'); } };
  await h.background({ data: { audience: 'seller', recipientId: 'account-fixture' } });
  assert.equal(h.shown.length, 0);
});

test('legacy Firebase automatic notifications are intercepted before SDK display', () => {
  const h = harness(); let blocked = false;
  h.handlers.push({ data: { json: () => ({ notification: { title: 'Queued legacy notification' } }) }, stopImmediatePropagation() { blocked = true; } });
  assert.equal(blocked, true);
  blocked = false;
  h.handlers.push({ data: { json: () => ({ data: { title: 'Data-only push' } }) }, stopImmediatePropagation() { blocked = true; } });
  assert.equal(blocked, false, 'Data messages are handled by the gated background callback');
});

test('authorized image notifications keep their media in the data-only transport', async () => {
  const h = harness({ customer: { recipientId: 'account-fixture' } });
  await h.background({ data: { audience: 'user', recipientId: 'account-fixture', title: 'Update', image: 'https://fixture.invalid/image.webp' } });
  assert.equal(h.shown[0].options.image, 'https://fixture.invalid/image.webp');
});
