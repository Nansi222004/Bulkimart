import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';
let vite, useWallet, socket;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  useWallet = (await vite.ssrLoadModule('/src/modules/User/hooks/useCustomerWallet.js')).default;
  socket = (await vite.ssrLoadModule('/src/utils/socket.js')).socket;
});
after(async () => vite?.close());
const Snapshot = props => React.createElement('wallet-snapshot', useWallet(props));
function setup() {
  const previous = globalThis.document, target = new EventTarget();
  globalThis.document = { visibilityState: 'visible', addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) };
  let token = 'wallet-user'; const balances = [];
  const props = { active: true, userId: 'buyer', onBalance: balance => balances.push(balance) };
  const h = hookHarness(Snapshot, props, '/account?section=wallet', undefined, { localStorage: { getItem: key => key === 'userToken' ? token : null } });
  return { h, props, balances, changeToken: next => { token = next; }, close() { h.close(); globalThis.document = previous; } };
}
async function reply(h, balance, rows = []) {
  h.requests.findLast(r => r.url.endsWith('/api/wallet')).resolve({ success: true, data: { balance } });
  h.requests.findLast(r => r.url.includes('/wallet/transactions')).resolve({ success: true, data: rows });
  await h.settle();
}
test('an open wallet refreshes its balance and parcel history on a refund notification and app resume', async () => {
  const s = setup(), { h } = s;
  try {
    await reply(h, 0);
    socket.emitEvent(['notification_new', { event: 'REFUND_COMPLETED' }]);
    const refund = { transactionId: 'refund-once', type: 'CANCELLATION_REFUND', amount: 20.4, direction: 'credit', description: 'Refund for cancelled parcel #TEST' };
    await reply(h, 20.4, [refund]);
    assert.equal(h.tree.props.data.balance, 20.4); assert.deepEqual(h.tree.props.transactions, [refund]);
    assert.equal(s.balances.at(-1), 20.4);
    const before = h.requests.length;
    window.dispatchEvent(new Event('focus')); assert.equal(h.requests.length, before + 2);
    await reply(h, 20.4, [refund]);
    assert.equal(h.requests.at(-1).options.cache, 'no-store');
  } finally { s.close(); }
});
test('failed wallet reads retain the last balance and surface an error, then retry recovers', async () => {
  const s = setup(), { h } = s;
  try {
    await reply(h, 20.4);
    const retry = h.tree.props.refresh();
    h.requests.findLast(r => r.url.endsWith('/api/wallet')).resolve({ success: false, message: 'Wallet temporarily unavailable' }, 503);
    h.requests.findLast(r => r.url.includes('/wallet/transactions')).resolve({ success: true, data: [] });
    await retry; await h.settle();
    assert.equal(h.tree.props.data.balance, 20.4); assert.match(h.tree.props.error, /temporarily unavailable/);
    void h.tree.props.refresh(); await reply(h, 25);
    assert.equal(h.tree.props.data.balance, 25); assert.equal(h.tree.props.error, '');
  } finally { s.close(); }
});
test('an initial wallet error is not displayed as an empty wallet', async () => {
  const s = setup(), { h } = s;
  try {
    h.requests.find(r => r.url.endsWith('/api/wallet')).resolve({ success: false, message: 'Please retry' }, 503);
    h.requests.find(r => r.url.includes('/wallet/transactions')).resolve({ success: true, data: [] });
    await h.settle(); assert.equal(h.tree.props.data, null); assert.match(h.tree.props.error, /Please retry/);
  } finally { s.close(); }
});
test('older reads, logout and unmount cannot restore a stale wallet balance', async () => {
  const s = setup(), { h } = s;
  try {
    const old = h.requests.slice(); void h.tree.props.refresh();
    await reply(h, 20.4);
    old[0].resolve({ data: { balance: 0 } }); old[1].resolve({ data: [] }); await h.settle();
    assert.equal(h.tree.props.data.balance, 20.4);
    void h.tree.props.refresh(); s.changeToken('different-user'); await reply(h, 999);
    assert.equal(h.tree.props.data.balance, 20.4); assert.deepEqual(s.balances, [20.4]);
    const before = h.requests.length; h.unmount();
    socket.emitEvent(['notification_new', { event: 'PARCEL_UPDATED' }]); window.dispatchEvent(new Event('focus'));
    assert.equal(h.requests.length, before);
  } finally { s.close(); }
});
test('polling recovers missed refunds while the wallet is open and pauses in the background', async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let tick, cleared = false;
  globalThis.setInterval = fn => { tick = fn; return 123; };
  globalThis.clearInterval = id => { if (id === 123) cleared = true; };
  const s = setup(), { h } = s;
  try {
    await reply(h, 0);
    const count = h.requests.length; document.visibilityState = 'hidden'; tick(); assert.equal(h.requests.length, count);
    document.visibilityState = 'visible'; tick(); await reply(h, 20.4); assert.equal(h.tree.props.data.balance, 20.4);
    s.props.active = false; h.rerender(); assert.equal(cleared, true); await reply(h, 20.4);
  } finally { s.close(); globalThis.setInterval = originalSet; globalThis.clearInterval = originalClear; }
});
