import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './service-hookHarness.mjs';
let vite, sockets, Notice;
before(async () => {
  vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  sockets = await vite.ssrLoadModule('/src/utils/socket.js');
  Notice = (await vite.ssrLoadModule('/src/components/RealtimeNotice.jsx')).default;
});
after(async () => { sockets.disconnectSocket(); await new Promise(resolve => setTimeout(resolve, 5)); await vite.close(); });
async function stubbed(run) {
  const socket = sockets.socket, original = { connect: socket.connect, disconnect: socket.disconnect, emit: socket.emit };
  let starts = 0, stops = 0, opening = false; const events = [];
  Object.defineProperty(socket, 'active', { configurable: true, get: () => opening });
  socket.connect = () => { starts++; opening = true; return socket; };
  socket.disconnect = () => { stops++; opening = false; socket.connected = false; return socket; };
  socket.emit = (...args) => { events.push(args); return socket; };
  try { await run({ socket, events, starts: () => starts, stops: () => stops }); }
  finally { sockets.disconnectSocket(); await new Promise(resolve => setTimeout(resolve, 5)); Object.assign(socket, original); delete socket.active; }
}
test('socket origin follows the HTTP host and strips the /api suffix', () => {
  assert.equal(sockets.resolveSocketOrigin('https://api.example.invalid/api/'), 'https://api.example.invalid');
});
test('room is joined once on every connection including reconnects', async () => stubbed(async ({ socket, events, starts }) => {
  sockets.connectSocket('fixture-token', 'seller', 'seller'); sockets.connectSocket('fixture-token', 'seller', 'seller');
  assert.equal(starts(), 1); assert.deepEqual(events, []);
  socket.emitReserved('connect'); socket.emitReserved('connect');
  assert.deepEqual(events, [['join_seller', 'seller'], ['join_seller', 'seller']]);
}));
test('effect replay reuses the opening transport while logout closes it and clears buffers', async () => stubbed(async ({ socket, starts, stops }) => {
  sockets.connectSocket('fixture-token', 'buyer', 'buyer'); sockets.disconnectSocket(); sockets.connectSocket('fixture-token', 'buyer', 'buyer');
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(starts(), 1); assert.equal(stops(), 0);
  socket.sendBuffer.push({ data: ['fixture-only'] }); sockets.disconnectSocket();
  await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(stops(), 1); assert.deepEqual(socket.auth, {}); assert.deepEqual(socket.sendBuffer, []);
}));
test('account/role switching closes the old transport before connecting with fresh identity', async () => stubbed(async ({ socket, events, stops }) => {
  sockets.connectSocket('buyer-token', 'buyer', 'buyer'); sockets.disconnectSocket(); sockets.connectSocket('rider-token', 'delivery', 'rider');
  socket.emitReserved('connect'); assert.equal(stops(), 1); assert.deepEqual(events, [['join_rider', 'rider']]); assert.equal(socket.auth.token, 'rider-token');
}));
test('realtime failure has a nonblocking notice which clears on reconnect', () => {
  const h = hookHarness(Notice);
  try {
    assert.equal(h.tree, null); sockets.socket.emitReserved('connect_error', new Error('private transport details')); h.flush();
    assert.equal(h.tree.props.role, 'status'); assert.match(JSON.stringify(h.tree), /still place orders/); assert.doesNotMatch(JSON.stringify(h.tree), /private transport/);
    sockets.socket.emitReserved('connect'); h.flush(); assert.equal(h.tree, null);
  } finally { h.close(); }
});
