/**
 * Live chat support: REST + Socket.IO end to end against an isolated
 * in-memory MongoDB, real JWT sessions and a real Socket.IO server.
 * Notifications are captured (and checked to never carry message text).
 */
import { jest } from '@jest/globals';
import http from 'http';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const notifications = [];
const capture = (kind) => jest.fn(async (...args) => { notifications.push({ kind, args }); return { _id: 'n' }; });
jest.unstable_mockModule('../../services/notification.service.js', () => ({
  notifyUser: capture('user'), notifySeller: capture('seller'), notifyRider: capture('rider'),
  notifyAllAdmins: capture('allAdmins'), notifyAdmin: capture('admin'),
  NOTIFICATION_EVENT: new Proxy({}, { get: (_t, key) => String(key) }),
}));

const require = createRequire(import.meta.url);
// The backend has no socket.io client dependency; reuse the web app's (same 4.x line).
const { io: ioClient } = require('../../../frontend/node_modules/socket.io-client');

const [{ default: supportChatRoutes }, { protect, requireAdmin }, controller, { errorHandler }, { initSocket }, { signSessionToken },
  { default: User }, { default: Admin }, { default: Seller }, { default: ChatConversation }, { default: ChatMessage }, { default: Ticket },
  service] = await Promise.all([
  import('../../routes/supportChat.routes.js'), import('../../middlewares/auth.middleware.js'),
  import('../../controllers/supportChat.controller.js'), import('../../middlewares/error.middleware.js'),
  import('../../socket/socket.js'), import('../../config/jwt.js'),
  import('../../models/User.js'), import('../../models/Admin.js'), import('../../models/Seller.js'),
  import('../../models/ChatConversation.js'), import('../../models/ChatMessage.js'), import('../../models/Ticket.js'),
  import('../../services/supportChat.service.js'),
]);

const app = express();
app.use(express.json());
app.use('/api/support-chat', supportChatRoutes);
const admin = express.Router();
admin.use(protect, requireAdmin);
admin.get('/support-chat/agents', controller.adminGetAgents);
admin.patch('/support-chat/agents/me', controller.adminSetMyStatus);
admin.get('/support-chat/conversations', controller.adminListChats);
admin.get('/support-chat/conversations/:id', controller.adminGetChat);
admin.get('/support-chat/conversations/:id/messages', controller.adminGetMessages);
admin.post('/support-chat/conversations/:id/messages', controller.adminPostMessage);
admin.post('/support-chat/conversations/:id/read', controller.adminReadChat);
admin.post('/support-chat/conversations/:id/accept', controller.adminAcceptChat);
admin.post('/support-chat/conversations/:id/assign', controller.adminAssignChat);
admin.post('/support-chat/conversations/:id/resolve', controller.adminResolveChat);
admin.post('/support-chat/conversations/:id/close', controller.adminCloseChat);
admin.post('/support-chat/conversations/:id/reopen', controller.adminReopenChat);
admin.post('/support-chat/conversations/:id/ticket', controller.adminCreateTicket);
admin.post('/support-chat/conversations/:id/link-ticket', controller.adminLinkTicket);
app.use('/api/admin', admin);
app.use(errorHandler);

let db; let server; let url; const sockets = [];
let customer; let otherCustomer; let sellerUser; let agentA; let agentB;
const tokens = {};

beforeAll(async () => {
  db = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(db.getUri('isolated_support_chat'));
  await Promise.all([ChatConversation.syncIndexes(), ChatMessage.syncIndexes()]);
  server = http.createServer(app);
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await db?.stop();
});

beforeEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  service.__resetPresence();
  notifications.length = 0;
  for (const c of Object.values(mongoose.connection.collections)) await c.deleteMany({});
  customer = await User.create({ name: 'Asha Customer', phone: '9800000101', roles: ['buyer'] });
  otherCustomer = await User.create({ name: 'Other Customer', phone: '9800000102', roles: ['buyer'] });
  sellerUser = await User.create({ name: 'Ravi Seller', phone: '9800000103', roles: ['buyer', 'seller'] });
  await Seller.create({ userId: sellerUser._id, businessName: 'Ravi Stores', status: 'pending' });
  agentA = await Admin.create({ name: 'Agent A', email: 'a@support.test', password: 'pw-a-123456', role: 'admin' });
  agentB = await Admin.create({ name: 'Agent B', email: 'b@support.test', password: 'pw-b-123456', role: 'admin' });
  Object.assign(tokens, {
    customer: signSessionToken({ id: String(customer._id), type: 'user', role: 'buyer' }),
    other: signSessionToken({ id: String(otherCustomer._id), type: 'user', role: 'buyer' }),
    seller: signSessionToken({ id: String(sellerUser._id), type: 'user', role: 'seller' }),
    sellerAsCustomer: signSessionToken({ id: String(sellerUser._id), type: 'user', role: 'buyer' }),
    customerAsDelivery: signSessionToken({ id: String(customer._id), type: 'user', role: 'delivery' }),
    agentA: signSessionToken({ id: String(agentA._id), type: 'admin' }),
    agentB: signSessionToken({ id: String(agentB._id), type: 'admin' }),
  });
});

const auth = (t) => ({ Authorization: `Bearer ${tokens[t]}` });
const start = (t = 'customer', body = {}) => request(app).post('/api/support-chat/conversations').set(auth(t))
  .send({ supportCategory: t === 'seller' ? 'Orders' : 'Order', message: 'My order is late', ...body });

const connect = (token) => new Promise((resolve, reject) => {
  const s = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(s);
  s.on('connect', () => resolve(s));
  s.on('connect_error', reject);
});
const emitAck = (s, event, payload = {}) => new Promise((resolve) => s.emit(event, payload, resolve));
const nextEvent = (s, event, timeout = 3000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
  s.once(event, (payload) => { clearTimeout(t); resolve(payload); });
});
const noEvent = (s, event, wait = 400) => new Promise((resolve, reject) => {
  const handler = () => reject(new Error(`unexpected ${event}`));
  s.once(event, handler);
  setTimeout(() => { s.off(event, handler); resolve(); }, wait);
});

describe('starting and resuming', () => {
  test('creates a WAITING chat, then resumes the same one instead of duplicating', async () => {
    const first = await start().expect(201);
    expect(first.body.data.conversation).toMatchObject({ status: 'WAITING', supportCategory: 'Order', userRole: 'CUSTOMER', canSend: true });
    expect(first.body.data.conversation.conversationNumber).toMatch(/^CHAT-\d{6}$/);
    const again = await start('customer', { message: 'Any update?' }).expect(200);
    expect(again.body.data.resumed).toBe(true);
    expect(again.body.data.conversation._id).toBe(first.body.data.conversation._id);
    expect(await ChatConversation.countDocuments()).toBe(1);
    expect(await ChatMessage.countDocuments()).toBe(2);
  });

  test('concurrent starts still produce one open chat', async () => {
    const results = await Promise.all([start(), start(), start()]);
    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(await ChatConversation.countDocuments({ isOpen: true })).toBe(1);
  });

  test('rejects an unknown topic and an empty message', async () => {
    await start('customer', { supportCategory: 'Hacking' }).expect(400);
    await start('customer', { message: '   ' }).expect(400);
  });

  test('seller topics differ from customer topics', async () => {
    const res = await request(app).get('/api/support-chat/categories').set(auth('seller')).expect(200);
    expect(res.body.data.role).toBe('SELLER');
    expect(res.body.data.categories).toContain('KYC / Verification');
    await start('seller', { supportCategory: 'Order' }).expect(400);
  });

  test('a stray related order is refused', async () => {
    await start('customer', { relatedOrderId: String(new mongoose.Types.ObjectId()) }).expect(404);
  });
});

describe('isolation and authorization', () => {
  test('another user cannot read or post to my chat', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    await request(app).get(`/api/support-chat/conversations/${id}`).set(auth('other')).expect(404);
    await request(app).get(`/api/support-chat/conversations/${id}/messages`).set(auth('other')).expect(404);
    await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('other')).send({ message: 'hi' }).expect(404);
  });

  test('a seller chat is invisible to the same person signed in as a customer', async () => {
    const id = (await start('seller').expect(201)).body.data.conversation._id;
    await request(app).get(`/api/support-chat/conversations/${id}`).set(auth('sellerAsCustomer')).expect(404);
    const list = await request(app).get('/api/support-chat/conversations').set(auth('sellerAsCustomer')).expect(200);
    expect(list.body.data).toHaveLength(0);
    // and starting a customer chat is a separate conversation
    await start('sellerAsCustomer').expect(201);
    expect(await ChatConversation.countDocuments({ userId: sellerUser._id })).toBe(2);
  });

  test('a delivery-role token without a delivery profile is refused', async () => {
    await request(app).get('/api/support-chat/categories').set(auth('customerAsDelivery')).expect(403);
  });

  test('role and ids in the body are ignored', async () => {
    const res = await start('customer', { userRole: 'SELLER', userId: String(otherCustomer._id) }).expect(201);
    expect(res.body.data.conversation.userRole).toBe('CUSTOMER');
    expect(String((await ChatConversation.findOne()).userId)).toBe(String(customer._id));
  });

  test('admins cannot use the requester API and users cannot use the agent API', async () => {
    await request(app).get('/api/support-chat/conversations').set(auth('agentA')).expect(403);
    await request(app).get('/api/admin/support-chat/conversations').set(auth('customer')).expect(403);
    await request(app).get('/api/support-chat/conversations').set({ Authorization: 'Bearer not-a-jwt' }).expect(401);
  });

  test('invalid JWT sockets are rejected', async () => {
    await expect(connect('forged.token.value')).rejects.toThrow();
  });
});

describe('agent workflow', () => {
  test('availability is real: offline with nobody connected, available once an agent joins', async () => {
    const before = await request(app).get('/api/support-chat/availability').set(auth('customer')).expect(200);
    expect(before.body.data).toMatchObject({ status: 'OFFLINE', availableAgents: 0 });
    expect(before.body.data.message).toBe('All support agents are currently busy. Please wait or create a support ticket.');
    const agent = await connect(tokens.agentA);
    expect(await emitAck(agent, 'support:join')).toMatchObject({ ok: true, role: 'AGENT' });
    const after = await request(app).get('/api/support-chat/availability').set(auth('customer')).expect(200);
    expect(after.body.data).toMatchObject({ status: 'AVAILABLE', availableAgents: 1 });
    await request(app).patch('/api/admin/support-chat/agents/me').set(auth('agentA')).send({ status: 'BUSY' }).expect(200);
    expect((await request(app).get('/api/support-chat/availability').set(auth('customer'))).body.data.status).toBe('BUSY');
    agent.close();
    await new Promise((r) => setTimeout(r, 200));
    expect((await request(app).get('/api/support-chat/availability').set(auth('customer'))).body.data.status).toBe('OFFLINE');
  });

  test('accept is exclusive; only the assignee replies; transfer hands it over', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    const queue = await request(app).get('/api/admin/support-chat/conversations?status=WAITING').set(auth('agentA')).expect(200);
    expect(queue.body.data.map((c) => c._id)).toEqual([id]);
    expect(queue.body.meta.counts.WAITING).toBe(1);

    await request(app).post(`/api/admin/support-chat/conversations/${id}/accept`).set(auth('agentA')).expect(200);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/accept`).set(auth('agentB')).expect(409);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentB')).send({ message: 'hi' }).expect(403);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/assign`).set(auth('agentB')).send({ adminId: String(agentB._id) }).expect(403);

    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'Checking now' }).expect(201);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/assign`).set(auth('agentA')).send({ adminId: String(agentB._id) }).expect(200);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentB')).send({ message: 'Taking over' }).expect(201);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/assign`).set(auth('agentB')).send({ adminId: String(new mongoose.Types.ObjectId()) }).expect(404);

    const detail = await request(app).get(`/api/support-chat/conversations/${id}`).set(auth('customer')).expect(200);
    expect(detail.body.data.conversation).toMatchObject({ status: 'ACTIVE', agentName: 'Agent B' });
    expect(detail.body.data.conversation.assignedAdminId).toBeUndefined(); // requesters never see agent ids
    const texts = (await ChatMessage.find().sort({ createdAt: 1 })).map((m) => `${m.senderRole}:${m.messageText}`);
    expect(texts).toEqual(['CUSTOMER:My order is late', 'SYSTEM:Agent A joined the chat.', 'AGENT:Checking now', 'SYSTEM:Chat transferred to Agent B.', 'AGENT:Taking over']);
  });

  test('replying to a waiting chat accepts it', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'Hello' }).expect(201);
    expect((await ChatConversation.findById(id)).status).toBe('ACTIVE');
  });

  test('resolve stops sending; reopen re-queues; close is final for messages', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    await request(app).post(`/api/admin/support-chat/conversations/${id}/accept`).set(auth('agentA')).expect(200);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/resolve`).set(auth('agentA')).expect(200);
    await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: 'still broken' }).expect(409);
    const reopened = await request(app).post(`/api/support-chat/conversations/${id}/reopen`).set(auth('customer')).expect(200);
    expect(reopened.body.data).toMatchObject({ status: 'WAITING', agentName: null });
    await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: 'still broken' }).expect(201);
    await request(app).post(`/api/support-chat/conversations/${id}/close`).set(auth('customer')).expect(200);
    await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: 'x' }).expect(409);
    expect(await ChatMessage.countDocuments({ conversationId: id })).toBeGreaterThan(4); // history kept
  });

  test('reopen is refused while another chat is open, and after the window', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    await request(app).post(`/api/support-chat/conversations/${id}/close`).set(auth('customer')).expect(200);
    await start('customer', { message: 'new issue' }).expect(201);
    await request(app).post(`/api/support-chat/conversations/${id}/reopen`).set(auth('customer')).expect(409);
    await ChatConversation.updateOne({ _id: id }, { $set: { closedAt: new Date(Date.now() - 8 * 86400000) } });
    const old = await request(app).post(`/api/support-chat/conversations/${id}/reopen`).set(auth('customer')).expect(409);
    expect(old.body.meta.code).toBe('CHAT_REOPEN_EXPIRED');
  });

  test('admin search, role and status filters', async () => {
    await start();
    await start('seller');
    const sellers = await request(app).get('/api/admin/support-chat/conversations?role=SELLER').set(auth('agentA')).expect(200);
    expect(sellers.body.data).toHaveLength(1);
    const byName = await request(app).get('/api/admin/support-chat/conversations?q=asha').set(auth('agentA')).expect(200);
    expect(byName.body.data.map((c) => c.userName)).toEqual(['Asha Customer']);
    const context = await request(app).get(`/api/admin/support-chat/conversations/${sellers.body.data[0]._id}`).set(auth('agentA')).expect(200);
    expect(context.body.data.seller).toMatchObject({ businessName: 'Ravi Stores', status: 'pending' });
  });
});

describe('messages', () => {
  test('a retried send with the same clientMessageId is stored once', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    const send = () => request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: 'retry me', clientMessageId: 'client-abc-123' });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await ChatMessage.countDocuments({ messageText: 'retry me' })).toBe(1);
  });

  test('text is stored as plain text, control characters removed, length capped', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: '<script>x</script>\u0007' }).expect(201);
    expect((await ChatMessage.findOne({ messageText: /script/ })).messageText).toBe('<script>x</script>');
    await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: 'a'.repeat(2001) }).expect(400);
  });

  test('pagination returns older pages oldest-first', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await request(app).post(`/api/support-chat/conversations/${id}/messages`).set(auth('customer')).send({ message: `m${i}` });
    }
    const page1 = await request(app).get(`/api/support-chat/conversations/${id}/messages?limit=3`).set(auth('customer')).expect(200);
    expect(page1.body.data.messages.map((m) => m.messageText)).toEqual(['m2', 'm3', 'm4']);
    expect(page1.body.data.hasMore).toBe(true);
    const page2 = await request(app).get(`/api/support-chat/conversations/${id}/messages?limit=3&before=${page1.body.data.messages[0]._id}`).set(auth('customer')).expect(200);
    expect(page2.body.data.messages.map((m) => m.messageText)).toEqual(['My order is late', 'm0', 'm1']);
    expect(page2.body.data.hasMore).toBe(false);
  });

  test('unread counts and read receipts', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    expect((await ChatConversation.findById(id)).unreadForAgent).toBe(1);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/read`).set(auth('agentA')).expect(200);
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'one' });
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'two' });
    let c = await ChatConversation.findById(id);
    expect([c.unreadForAgent, c.unreadForUser]).toEqual([0, 2]);
    await request(app).post(`/api/support-chat/conversations/${id}/read`).set(auth('customer')).expect(200);
    c = await ChatConversation.findById(id);
    expect(c.unreadForUser).toBe(0);
    expect(await ChatMessage.countDocuments({ senderRole: 'AGENT', readAt: null })).toBe(0);
    expect(await ChatMessage.countDocuments({ senderRole: 'CUSTOMER', readAt: { $ne: null } })).toBe(1);
  });

  test('notifications never contain message text and fire once per unread burst', async () => {
    const id = (await start('customer', { message: 'SECRET-START-TEXT' }).expect(201)).body.data.conversation._id;
    await request(app).post(`/api/admin/support-chat/conversations/${id}/accept`).set(auth('agentA')).expect(200);
    notifications.length = 0;
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'SECRET-REPLY-1' });
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'SECRET-REPLY-2' });
    const replies = notifications.filter((n) => n.args[1]?.event === 'SUPPORT_CHAT_MESSAGE');
    expect(replies).toHaveLength(1);
    expect(JSON.stringify(notifications)).not.toMatch(/SECRET/);
  });

  test('unsupported attachment types are refused before upload', () => {
    expect(() => service.assertChatAttachments([{ mimetype: 'image/svg+xml' }])).toThrow(/JPEG, PNG, WEBP/);
    expect(() => service.assertChatAttachments([1, 2, 3, 4].map(() => ({ mimetype: 'image/png' })))).toThrow(/at most 3/);
    expect(() => service.assertChatAttachments([{ mimetype: 'application/pdf' }])).not.toThrow();
  });
});

describe('real-time', () => {
  test('agent replies reach only the owner; user messages reach agents; typing is relayed', async () => {
    const owner = await connect(tokens.customer);
    const stranger = await connect(tokens.other);
    const agent = await connect(tokens.agentA);
    expect(await emitAck(owner, 'support:join')).toMatchObject({ ok: true, role: 'CUSTOMER' });
    await emitAck(stranger, 'support:join');
    await emitAck(agent, 'support:join');

    const created = nextEvent(agent, 'support:conversation:created');
    const id = (await start().expect(201)).body.data.conversation._id;
    expect((await created).conversation._id).toBe(id);

    const ownerGets = nextEvent(owner, 'support:message:new');
    const strangerSilent = noEvent(stranger, 'support:message:new');
    await request(app).post(`/api/admin/support-chat/conversations/${id}/messages`).set(auth('agentA')).send({ message: 'Hi Asha' }).expect(201);
    const evt = await ownerGets; // the "joined" system message arrives first
    expect(evt.conversationId).toBe(id);
    await strangerSilent;

    const agentGets = nextEvent(agent, 'support:message:new');
    const ack = await emitAck(owner, 'support:message:send', { conversationId: id, text: 'Thanks', clientMessageId: 'sock-msg-1' });
    expect(ack).toMatchObject({ ok: true, duplicate: false });
    expect((await agentGets).message).toMatchObject({ messageText: 'Thanks', senderRole: 'CUSTOMER' });
    expect(await emitAck(owner, 'support:message:send', { conversationId: id, text: 'Thanks', clientMessageId: 'sock-msg-1' })).toMatchObject({ ok: true, duplicate: true });

    const typing = nextEvent(agent, 'support:typing');
    owner.emit('support:typing:start', { conversationId: id });
    expect(await typing).toMatchObject({ conversationId: id, side: 'USER', typing: true });

    const read = nextEvent(agent, 'support:message:read');
    await emitAck(owner, 'support:message:read', { conversationId: id });
    expect((await read).reader).toBe('USER');
  });

  test('a socket cannot act on someone else\'s conversation', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    const stranger = await connect(tokens.other);
    await emitAck(stranger, 'support:join');
    expect(await emitAck(stranger, 'support:message:send', { conversationId: id, text: 'injected' })).toMatchObject({ ok: false, message: 'Conversation not found' });
    expect(await emitAck(stranger, 'support:agent:status', { status: 'AVAILABLE' })).toMatchObject({ ok: false });
    expect(await ChatMessage.countDocuments({ messageText: 'injected' })).toBe(0);
  });
});

describe('ticket integration', () => {
  test('creates one ticket with the transcript, links it, and shows the chat in ticket detail', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    await request(app).post(`/api/admin/support-chat/conversations/${id}/accept`).set(auth('agentA')).expect(200);
    const first = await request(app).post(`/api/admin/support-chat/conversations/${id}/ticket`).set(auth('agentA')).send({}).expect(201);
    const again = await request(app).post(`/api/admin/support-chat/conversations/${id}/ticket`).set(auth('agentA')).send({}).expect(200);
    expect(again.body.data._id).toBe(first.body.data._id);
    expect(await Ticket.countDocuments()).toBe(1);
    const ticket = await Ticket.findOne();
    expect(ticket).toMatchObject({ requesterRole: 'customer', category: 'Order' });
    expect(ticket.description).toMatch(/My order is late/);
    const conv = await request(app).get(`/api/support-chat/conversations/${id}`).set(auth('customer')).expect(200);
    expect(conv.body.data.conversation.relatedTicketNumber).toBe(ticket.ticketNumber);
    expect((await service.chatsForTicket(ticket._id)).map((c) => String(c._id))).toEqual([id]);
  });

  test('only tickets of the same person can be linked', async () => {
    const id = (await start().expect(201)).body.data.conversation._id;
    const foreign = await Ticket.create({ userId: otherCustomer._id, userName: 'Other', subject: 's', description: 'd', ticketNumber: 'NHC-1' });
    await request(app).post(`/api/admin/support-chat/conversations/${id}/link-ticket`).set(auth('agentA')).send({ ticketId: String(foreign._id) }).expect(404);
    const own = await Ticket.create({ userId: customer._id, userName: 'Asha', subject: 's', description: 'd', ticketNumber: 'NHC-2' });
    await request(app).post(`/api/admin/support-chat/conversations/${id}/link-ticket`).set(auth('agentA')).send({ ticketId: String(own._id) }).expect(200);
  });
});
