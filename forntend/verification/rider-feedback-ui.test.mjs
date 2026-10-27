import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, Profile, Dashboard, Popup, Inbox, Provider, sockets, requests, socket;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  Profile = (await vite.ssrLoadModule('/src/modules/Delivery/pages/DeliveryProfilePage.jsx')).default;
  Dashboard = (await vite.ssrLoadModule('/src/modules/Delivery/pages/DeliveryDashboardPage.jsx')).default;
  Popup = (await vite.ssrLoadModule('/src/components/NotificationPopup.jsx')).default;
  Inbox = (await vite.ssrLoadModule('/src/modules/Delivery/components/DeliveryNotifications.jsx')).default;
  Provider = (await vite.ssrLoadModule('/src/modules/Delivery/context/DeliveryContext.jsx')).DeliveryProvider;
  sockets = await vite.ssrLoadModule('/src/utils/socket.js'); socket = sockets.socket;
  requests = await vite.ssrLoadModule('/src/utils/portalRequests.js');
});
after(async () => vite.close());
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join(' ');
const fixture = profile => ({ riderName: 'Fixture Rider', riderProfile: profile, onboardingForm: {}, earningsData: { daily: { total: 0, trips: 0 }, lifetime: { total: 0, trips: 0 } }, debitWallet: 0, payoutBalance: 0 });
const emit = notification => socket.listeners('notification_new').forEach(listener => listener(notification));

test('off-duty riders stay connected and settlement and rating events refresh their authoritative profile', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = Object.assign(new EventTarget(), { querySelector: () => null, visibilityState: 'visible' });
  const entries = { deliveryToken: 'rider-feedback-token' };
  const storage = { getItem: key => entries[key] ?? null, setItem: (key, value) => { entries[key] = String(value); }, removeItem: key => { delete entries[key]; } };
  const connect = socket.connect, disconnect = socket.disconnect;
  socket.connect = () => socket; socket.disconnect = () => socket;
  requests.clearPortalRequests('delivery');
  const h = hookHarness(Provider, {}, '/delivery/dashboard', undefined, { localStorage: storage, sessionStorage: storage });
  const profile = { _id: 'rider-feedback', name: 'Fixture Rider', status: 'approved', isAvailable: false, rating: 0, ratingCount: 0, finance: { reportedCodOutstanding: 2000 } };
  try {
    h.requests.find(row => row.url.endsWith('/api/auth/me')).resolve({ userType: 'user', sessionRole: 'delivery' }); await h.settle();
    h.requests.find(row => row.url.endsWith('/api/delivery/me')).resolve({ data: profile }); await h.settle();
    assert.equal(h.tree.props.value.isOnline, false); assert.equal(socket.auth.token, 'rider-feedback-token');
    assert.equal(h.tree.props.value.debitWallet, 2000);
    const before = h.requests.length;
    emit({ event: 'COD_CASH_SETTLED' }); await h.settle();
    const refresh = h.requests.slice(before).find(row => row.url.endsWith('/api/delivery/me')); assert.ok(refresh);
    refresh.resolve({ data: { ...profile, finance: { reportedCodOutstanding: 0 } } }); await h.settle();
    assert.equal(h.tree.props.value.debitWallet, 0);
    const next = h.requests.length;
    socket.listeners('rider_rating_updated').forEach(listener => listener({ partnerId: profile._id })); await h.settle();
    h.requests.slice(next).find(row => row.url.endsWith('/api/delivery/me')).resolve({ data: { ...profile, rating: 4, ratingCount: 1 } }); await h.settle();
    assert.equal(h.tree.props.value.riderProfile.rating, 4);
    h.requests.filter(row => !row.url.endsWith('/api/delivery/me') && !row.url.endsWith('/api/auth/me')).forEach(row => row.resolve({ data: [] }));
  } finally {
    h.close(); sockets.disconnectSocket(); await new Promise(resolve => setTimeout(resolve, 5));
    socket.connect = connect; socket.disconnect = disconnect;
    requests.clearPortalRequests('delivery'); globalThis.document = previousDocument;
  }
});

test('dashboard and profile display the customer average and count with an honest unrated state', () => {
  for (const Component of [Profile, Dashboard]) {
    const context = fixture({ rating: 4.33333, ratingCount: 3 });
    const h = hookHarness(Component, {}, '/delivery/profile', context);
    try {
      assert.match(text(h.tree), /4\.3 \/ 5/); assert.match(text(h.tree), /3 customer ratings/);
      context.riderProfile = { rating: 0, ratingCount: 0 }; h.rerender();
      assert.match(text(h.tree), /Not rated yet/); assert.doesNotMatch(text(h.tree), /5\.0/);
    } finally { h.close(); }
  }
});

test('rider popup receives cash settlement over socket and foreground push once, and ignores order pings', async () => {
  let push;
  const h = hookHarness(Popup, { audience: 'rider', subscribePush: async callback => { push = callback; return () => {}; } }, '/delivery/dashboard');
  try {
    await h.settle();
    const notification = { _id: 'settled', event: 'COD_CASH_SETTLED', title: 'COD cash settled', message: 'Bulkimart confirmed receipt.', route: '/delivery/earnings' };
    emit(notification); h.flush(); assert.match(text(h.tree), /COD cash settled/);
    push({ data: { audience: 'rider', notificationId: 'settled', event: 'COD_CASH_SETTLED', title: 'COD cash settled' } }); h.flush();
    assert.equal((text(h.tree).match(/COD cash settled/g) || []).length, 1);
    emit({ _id: 'ping', event: 'RIDER_PING', title: 'Hidden order ping' }); h.flush();
    push({ data: { audience: 'seller', notificationId: 'seller', event: 'COD_CASH_SETTLED', title: 'Wrong audience' } }); h.flush();
    assert.doesNotMatch(text(h.tree), /Hidden order ping|Wrong audience/);
  } finally { h.close(); }
});

test('rider inbox restores a missed cash settlement and opens earnings using the delivery session', async () => {
  const navigated = [];
  const h = hookHarness(Inbox, { onNavigate: route => navigated.push(route) }, '/delivery/dashboard');
  try {
    h.find(node => node.props['aria-label'] === 'Delivery notifications').props.onClick(); h.flush();
    const request = h.requests.find(row => row.url.includes('/api/notifications?page='));
    assert.equal(request.options.headers.Authorization, 'Bearer fixture-only-token');
    request.resolve({ data: [{ _id: 'settled', title: 'COD cash settled', message: 'Your cash has been received.', route: '/delivery/earnings', isRead: true, createdAt: '2026-10-27T08:00:00Z' }] });
    h.requests.filter(row => row !== request).forEach(row => row.resolve({ data: { count: 1 } }));
    await h.settle(); assert.match(text(h.tree), /Your cash has been received/);
    await h.find(node => node.props.className === 'delivery-notification-item').props.onClick();
    assert.deepEqual(navigated, ['/delivery/earnings']);
  } finally { h.close(); }
});
