import { jest } from '@jest/globals';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import jwt from 'jsonwebtoken';
import { once } from 'node:events';
const { io: client } = createRequire(new URL('../../../forntend/package.json', import.meta.url))('socket.io-client');
jest.unstable_mockModule('../../models/Seller.js', () => ({ default: { findOne: () => ({ select: async () => ({ _id: 'seller-fixture', status: 'approved' }) }) } }));
jest.unstable_mockModule('../../models/DeliveryPartner.js', () => ({ default: { findOne: () => ({ select: async () => ({ _id: 'rider-fixture', status: 'approved' }) }) } }));
const { initSocket } = await import('../../socket/socket.js');
const { JWT_SECRET } = await import('../../config/jwt.js');
let http, io, url;
const token = jwt.sign({ id: 'buyer-fixture', type: 'user', role: 'buyer' }, JWT_SECRET);
const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Socket condition did not become true'); };
beforeAll(async () => { http = createServer(); io = initSocket(http); http.listen(0, '127.0.0.1'); await once(http, 'listening'); url = `http://127.0.0.1:${http.address().port}`; });
afterAll(async () => { await new Promise(resolve => io.close(resolve)); });
test.each([['polling'], ['websocket'], ['polling', 'websocket']])('connects and authorizes room using transports %j', async (...values) => {
  const transports = values.filter(value => typeof value === 'string');
  const socket = client(url, { transports, auth: { token }, forceNew: true, reconnection: false });
  try {
    await once(socket, 'connect'); socket.emit('join_user', 'another-users-id');
    await waitFor(() => io.sockets.sockets.get(socket.id)?.rooms.has('user:buyer-fixture'));
    expect(io.sockets.sockets.get(socket.id).rooms.has('user:another-users-id')).toBe(false);
    if (transports.length > 1) await waitFor(() => socket.io.engine.transport.name === 'websocket');
    expect(io.sockets.sockets.size).toBe(1);
  } finally { socket.disconnect(); await waitFor(() => io.sockets.sockets.size === 0); }
});
test('transport disconnect reconnects with fresh room membership and valid auth', async () => {
  const socket = client(url, { auth: { token }, forceNew: true, reconnectionDelay: 30, reconnectionDelayMax: 50 });
  socket.on('connect', () => socket.emit('join_user'));
  try {
    await once(socket, 'connect'); await waitFor(() => io.sockets.sockets.get(socket.id)?.rooms.has('user:buyer-fixture'));
    const firstId = socket.id; const reconnected = once(socket, 'connect'); io.sockets.sockets.get(firstId).conn.close();
    await reconnected; expect(socket.id).not.toBe(firstId);
    await waitFor(() => io.sockets.sockets.get(socket.id)?.rooms.has('user:buyer-fixture'));
  } finally { socket.disconnect(); await waitFor(() => io.sockets.sockets.size === 0); }
});
test.each([undefined, 'invalid-token'])('denies missing or invalid authentication (%s)', async token => {
  const socket = client(url, { auth: { token }, forceNew: true, reconnection: false });
  try { const [error] = await once(socket, 'connect_error'); expect(error.message).toMatch(/Authentication required|Invalid or expired/); expect(socket.connected).toBe(false); }
  finally { socket.disconnect(); }
});
