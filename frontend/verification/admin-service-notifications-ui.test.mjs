import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from '../tests/service-hookHarness.mjs';
let vite, useNotifications, socket, feedback, opener;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  useNotifications = (await vite.ssrLoadModule('/src/modules/Admin/hooks/useAdminNotifications.js')).default;
  ({ socket } = await vite.ssrLoadModule('/src/utils/socket.js')); socket.connect = () => socket; socket.disconnect = () => socket;
  ({ feedback } = await vite.ssrLoadModule('/src/utils/feedback.js'));
  opener = (await vite.ssrLoadModule('/src/modules/Admin/utils/serviceNotifications.js')).createAdminNotificationOpener;
});
after(async () => { socket.removeAllListeners('notification_new'); await vite.close(); });
const emit = (name, data) => socket.listeners(name).forEach(listener => listener(data));
const notification = { _id: 'notification-1', title: 'New paid service application', message: 'Service fee paid and application submitted', metadata: { applicationId: '507f1f77bcf86cd799439022' }, route: '/admin/services?legalRequest=507f1f77bcf86cd799439022', createdAt: '2026-10-29T00:00:00Z', isRead: false };
async function answer(h, requests, count = 0, rows = []) {
  for (const request of requests) request.resolve({ success: true, data: request.url.includes('unread-count') ? { count } : rows });
  await h.settle();
}
test('a service socket event immediately reloads the open inbox and confirmed unread count and shows one foreground alert', async () => {
  feedback.clear(); const h = hookHarness(useNotifications, {}, '/admin/services');
  try {
    await answer(h, h.requests); emit('notification_new', notification); h.flush();
    assert.equal(h.tree.adminUnreadCount, 0, 'Socket messages cannot fabricate a persisted unread count');
    await answer(h, h.requests.slice(-2), 1, [notification]);
    assert.deepEqual(h.tree.adminNotifications, [notification]); assert.equal(h.tree.adminUnreadCount, 1);
    assert.equal(feedback.getSnapshot().toasts.length, 1);
    emit('notification_new', notification); await answer(h, h.requests.slice(-2), 1, [notification]);
    assert.equal(h.tree.adminUnreadCount, 1); assert.equal(feedback.getSnapshot().toasts.length, 1);
  } finally { h.close(); feedback.clear(); }
});
test('reconnect and window focus recover missed service alerts; a stale read cannot restore an older inbox', async () => {
  const h = hookHarness(useNotifications, {}, '/admin/services');
  try {
    await answer(h, h.requests);
    emit('connect'); const old = h.requests.slice(-2);
    window.dispatchEvent(new Event('focus')); const latest = h.requests.slice(-2);
    await answer(h, latest, 1, [notification]); await answer(h, old);
    assert.equal(h.tree.adminUnreadCount, 1); assert.deepEqual(h.tree.adminNotifications, [notification]);
    const requests = h.requests.length, oldWindow = window; h.unmount();
    emit('notification_new', notification); oldWindow.dispatchEvent(new Event('focus'));
    assert.equal(h.requests.length, requests);
  } finally { h.close(); }
});
test('inbox read errors are visible and retryable instead of silently pretending no requests exist', async () => {
  const h = hookHarness(useNotifications, {}, '/admin/services');
  try {
    const count = h.requests.find(request => request.url.includes('unread-count'));
    count.resolve({ success: true, data: { count: 1 } });
    h.requests.find(request => !request.url.includes('unread-count')).resolve({ message: 'Service inbox unavailable' }, 503); await h.settle();
    assert.equal(h.tree.adminNotifError, 'Service inbox unavailable'); assert.equal(h.tree.adminUnreadCount, 1);
    const retry = h.tree.fetchAdminNotifications(); h.requests.at(-1).resolve({ success: true, data: [notification] }); await retry; await h.settle();
    assert.equal(h.tree.adminNotifError, ''); assert.deepEqual(h.tree.adminNotifications, [notification]);
  } finally { h.close(); }
});
test('both new customer links and older generic paid-service alerts open Customer requests', async () => {
  const h = hookHarness(() => null, {}, '/admin'), calls = [];
  const actions = { markRead: async () => {}, setTab: value => calls.push(value), close() {}, toast: message => { throw Error(message); }, openService: () => { throw Error('Customer request must not open seller applications'); }, resolveServiceType: async () => 'customer' };
  try {
    await opener()({ ...notification, isRead: true }, actions);
    assert.match(window.location.search, /legalRequest=/);
    window.history.replaceState(null, '', '/admin');
    await opener()({ ...notification, isRead: true, route: '/admin/services?application=507f1f77bcf86cd799439022' }, actions);
    assert.match(window.location.search, /legalRequest=/); assert.deepEqual(calls, ['services', 'services']);
  } finally { h.close(); }
});

test('advertising alerts refresh the admin bell and open the campaign; duplicate transports show one alert',async()=>{
 feedback.clear();const h=hookHarness(useNotifications,{},'/admin/advertising');
 const id='507f1f77bcf86cd799439033', n={_id:'ad-notification',eventId:'advertising:'+id+':1:submit',event:'ADVERTISING_SUBMITTED',title:'Campaign awaiting review',message:'Review this campaign',metadata:{campaignId:id},route:'/admin/advertising?campaign='+id};
 try{
  await answer(h,h.requests);emit('notification_new',n);await answer(h,h.requests.slice(-2),1,[n]);
  emit('notification_new',n);await answer(h,h.requests.slice(-2),1,[n]);assert.equal(feedback.getSnapshot().toasts.length,1);
  const calls=[];await opener()(n,{markRead:async()=>calls.push('read'),setTab:tab=>calls.push(tab),close:()=>calls.push('close'),toast:()=>assert.fail('unexpected navigation error')});
  assert.deepEqual(calls,['read','advertising','close']);assert.equal(window.location.search,'?campaign='+id);
  const previousToast=feedback.getSnapshot().toasts[0].id;
  emit('notification_new',{...n,eventId:'advertising:'+id+':2:submit'});await answer(h,h.requests.slice(-2),2,[n]);assert.notEqual(feedback.getSnapshot().toasts[0].id,previousToast,'a later resubmission creates a fresh alert even when its message is unchanged');
 }finally{h.close();feedback.clear();}
});
