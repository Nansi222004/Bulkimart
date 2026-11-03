/**
 * Live chat support — the single implementation behind the requester REST API
 * (routes/supportChat.routes.js), the admin REST API (routes/admin.routes.js,
 * /support-chat) and the Socket.IO handlers (socket/supportChat.socket.js).
 *
 * Rules that every entry point inherits from here:
 *  - The requester's chat role (CUSTOMER / SELLER / DELIVERY) comes from the
 *    signed session (`role` claim) plus a live profile lookup, never from
 *    request data. A conversation is visible only to its own userId + role.
 *  - Agents are active Admin documents. Replying needs the chat to be assigned
 *    to you (a WAITING chat is accepted on first reply); superAdmins may act on
 *    any chat.
 *  - Messages are persisted before anything is emitted. A client-supplied
 *    `clientMessageId` makes a retried send return the stored message.
 *  - Notifications and pushes never contain message text.
 *
 * Real-time fan-out uses two kinds of room, both joined only via the server:
 *   support:req:<ROLE>:<userId> — every socket of that requester in that app
 *   support:agents              — every connected support agent (admin)
 */
import crypto from 'crypto';
import mongoose from 'mongoose';
import ChatConversation from '../models/ChatConversation.js';
import ChatMessage from '../models/ChatMessage.js';
import SupportAgent from '../models/SupportAgent.js';
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import Seller from '../models/Seller.js';
import DeliveryPartner from '../models/DeliveryPartner.js';
import Order from '../models/Order.js';
import Ticket from '../models/Ticket.js';
import TicketMessage from '../models/TicketMessage.js';
import { httpError } from '../utils/response.js';
import { assertRelatedEntitiesOwned, generateTicketNumber } from './ticket.service.js';
import { resolveResponseText } from './mediaUrl.service.js';
// Namespace import: test suites that mock notification.service with a subset of
// exports still link (a missing named export is a link-time SyntaxError in ESM).
import * as notifications from './notification.service.js';
import {
  CHAT_USER_ROLE, CHAT_USER_ROLES, CHAT_STATUS, CHAT_OPEN_STATUSES, AGENT_STATUS, AGENT_STATUSES,
  CHAT_CATEGORIES_BY_ROLE, CHAT_ROLE_TO_TICKET_ROLE, CHAT_MESSAGE_MAX_LENGTH, CHAT_MAX_ATTACHMENTS,
  CHAT_REOPEN_WINDOW_DAYS, CHAT_AGENT_MAX_ACTIVE, TICKET_ATTACHMENT_MIME_TYPES, TICKET_STATUS,
} from '../constants/enums.js';

const EVT = new Proxy({}, { get: (_t, key) => notifications.NOTIFICATION_EVENT?.[key] || String(key) });
/** Calls a notification helper if it exists; always resolves (notifications are best effort). */
const notify = (name, ...args) => Promise.resolve(typeof notifications[name] === 'function' ? notifications[name](...args) : null);

// ---------------------------------------------------------------- rooms & emit

export const SUPPORT_ROOM = {
  requester: (role, userId) => `support:req:${role}:${userId}`,
  agents: 'support:agents',
};

let ioProvider = null;
/** Socket layer registers itself here (avoids an import cycle; tests leave it unset). */
export const setSupportIo = (provider) => { ioProvider = provider; };

const emitRoom = (room, event, payload) => {
  try { ioProvider?.()?.to(room).emit(event, payload); } catch (err) { console.error('[SUPPORT_CHAT] emit failed:', err.message); }
};

/**
 * Private attachments are stored as `media:<id>`; the HTTP layer swaps them
 * for short-lived signed URLs per viewer. Socket payloads get the same
 * treatment here so a live message shows its image straight away.
 */
const signFor = async (payload, viewer) => {
  try {
    const text = JSON.stringify(payload);
    if (!text.includes('media:')) return payload;
    const req = { user: { _id: viewer.id }, userType: viewer.isAdmin ? 'admin' : 'user' };
    return JSON.parse(await resolveResponseText(text, req));
  } catch {
    return payload;
  }
};

const emitToRequester = async (conversation, event, payload) => {
  const signed = await signFor(payload, { id: String(conversation.userId), isAdmin: false });
  emitRoom(SUPPORT_ROOM.requester(conversation.userRole, conversation.userId), event, signed);
};

const emitToAgents = async (event, payload, viewerAdminId) => {
  const signed = await signFor(payload, { id: String(viewerAdminId || payload?.conversation?.userId || '000000000000000000000000'), isAdmin: true });
  emitRoom(SUPPORT_ROOM.agents, event, signed);
};

// ---------------------------------------------------------------- presence (per process)

const presence = new Map(); // adminId -> Set<socketId>

/** Returns true when this connection brought the agent online. */
export const agentSocketConnected = (adminId, socketId) => {
  const key = String(adminId);
  const set = presence.get(key) || new Set();
  const wasOnline = set.size > 0;
  set.add(socketId);
  presence.set(key, set);
  return !wasOnline;
};

/** Returns true when this disconnect took the agent offline. */
export const agentSocketDisconnected = (adminId, socketId) => {
  const key = String(adminId);
  const set = presence.get(key);
  if (!set || !set.delete(socketId)) return false;
  if (set.size) return false;
  presence.delete(key);
  return true;
};

export const isAgentOnline = (adminId) => (presence.get(String(adminId))?.size || 0) > 0;

/** Test helper. */
export const __resetPresence = () => presence.clear();

// ---------------------------------------------------------------- helpers

const oid = (value, label = 'id') => {
  if (!mongoose.isValidObjectId(value)) throw httpError(400, `Invalid ${label}`);
  return new mongoose.Types.ObjectId(String(value));
};

/** Plain text only: control characters stripped, length capped. Rendered as text (never HTML) by every client. */
export const cleanText = (value) => String(value ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/\r\n?/g, '\n')
  .trim();

const preview = (text, attachments) => (text ? text.slice(0, 120) : attachments?.length ? 'Attachment' : '');

export const isSuperAdmin = (admin) => admin?.role === 'superAdmin';

const newConversationNumber = () => `CHAT-${crypto.randomInt(100000, 1000000)}`;

// ---------------------------------------------------------------- requester identity

/** Session role claim → chat role. Older tokens without a role are customer sessions. */
export const chatRoleFromToken = (tokenRole) => (
  tokenRole === 'seller' ? CHAT_USER_ROLE.SELLER
    : tokenRole === 'delivery' ? CHAT_USER_ROLE.DELIVERY
      : CHAT_USER_ROLE.CUSTOMER
);

/**
 * Who is chatting, from the signed session only. Sellers and delivery partners
 * may chat in any account status (pending KYC or a suspension is exactly when
 * people need support); chat grants no seller or delivery capabilities.
 */
export const resolveChatRequester = async (user, tokenRole) => {
  const role = chatRoleFromToken(tokenRole);
  if (role === CHAT_USER_ROLE.SELLER) {
    const seller = await Seller.findOne({ userId: user._id }).select('_id businessName status').lean();
    if (!seller) throw httpError(403, 'No seller profile is linked to this account.', { code: 'NO_SELLER_PROFILE' });
    return { role, vendorId: seller._id, name: user.name || seller.businessName || 'Seller' };
  }
  if (role === CHAT_USER_ROLE.DELIVERY) {
    const partner = await DeliveryPartner.findOne({ userId: user._id }).select('_id status').lean();
    if (!partner) throw httpError(403, 'No delivery partner profile is linked to this account.', { code: 'NO_DELIVERY_PROFILE' });
    return { role, vendorId: partner._id, name: user.name || 'Delivery Partner' };
  }
  if (tokenRole === undefined && !user.roles?.includes('buyer')) {
    throw httpError(403, 'A customer session is required.', { code: 'AUTH_ROLE_REQUIRED' });
  }
  return { role, vendorId: null, name: user.name || 'Customer' };
};

export const categoriesFor = (role) => CHAT_CATEGORIES_BY_ROLE[role] || [];

// ---------------------------------------------------------------- serialisers

const canRequesterReopen = (c) => {
  if (![CHAT_STATUS.RESOLVED, CHAT_STATUS.CLOSED].includes(c.status)) return false;
  const endedAt = c.closedAt || c.resolvedAt || c.updatedAt;
  return Date.now() - new Date(endedAt).getTime() <= CHAT_REOPEN_WINDOW_DAYS * 86400000;
};

/** What a requester may see: the agent's name, never internal ids. */
export const requesterView = (c) => ({
  _id: c._id,
  conversationId: c._id,
  conversationNumber: c.conversationNumber,
  userRole: c.userRole,
  status: c.status,
  supportCategory: c.supportCategory,
  relatedOrderId: c.relatedOrderId || null,
  relatedTicketId: c.relatedTicketId || null,
  relatedTicketNumber: c.relatedTicketNumber || null,
  agentName: c.assignedAdminName || null,
  agentOnline: c.assignedAdminId ? isAgentOnline(c.assignedAdminId) : false,
  lastMessageAt: c.lastMessageAt,
  lastMessagePreview: c.lastMessagePreview,
  unreadCount: c.unreadForUser || 0,
  queuedAt: c.queuedAt || c.createdAt,
  createdAt: c.createdAt,
  acceptedAt: c.acceptedAt || null,
  resolvedAt: c.resolvedAt || null,
  closedAt: c.closedAt || null,
  canReopen: canRequesterReopen(c),
  canSend: CHAT_OPEN_STATUSES.includes(c.status),
});

export const agentView = (c) => ({
  ...requesterView(c),
  userId: c.userId,
  userName: c.userName,
  vendorId: c.vendorId || null,
  assignedAdminId: c.assignedAdminId || null,
  assignedAdminName: c.assignedAdminName || null,
  unreadCount: c.unreadForAgent || 0,
  unreadForUser: c.unreadForUser || 0,
  relatedDeliveryId: c.relatedDeliveryId || null,
  closedBy: c.closedBy || null,
  reopenCount: c.reopenCount || 0,
  updatedAt: c.updatedAt,
});

export const messageView = (m) => ({
  _id: m._id,
  conversationId: m.conversationId,
  senderRole: m.senderRole,
  senderName: m.senderName,
  messageType: m.messageType,
  messageText: m.messageText,
  attachments: m.attachments || [],
  clientMessageId: m.clientMessageId || null,
  createdAt: m.createdAt,
  deliveredAt: m.deliveredAt || null,
  readAt: m.readAt || null,
});

const withTicketNumber = async (conversation) => {
  const c = conversation.toObject ? conversation.toObject() : { ...conversation };
  if (c.relatedTicketId && !c.relatedTicketNumber) {
    const t = await Ticket.findById(c.relatedTicketId).select('ticketNumber').lean();
    c.relatedTicketNumber = t?.ticketNumber || null;
  }
  return c;
};

const broadcastConversation = async (conversation, change) => {
  const c = await withTicketNumber(conversation);
  await Promise.all([
    emitToRequester(c, 'support:conversation:updated', { change, conversation: requesterView(c) }),
    emitToAgents('support:conversation:updated', { change, conversation: agentView(c) }),
  ]);
  // Named events from the spec, alongside the generic one.
  const named = { accepted: 'support:conversation:accepted', assigned: 'support:conversation:assigned', closed: 'support:conversation:close', reopened: 'support:conversation:reopen' }[change];
  if (named) {
    await emitToRequester(c, named, { conversation: requesterView(c) });
    await emitToAgents(named, { conversation: agentView(c) });
  }
  return c;
};

// ---------------------------------------------------------------- loading with ownership

export const loadOwnedConversation = async (conversationId, requester, userId) => {
  const conversation = await ChatConversation.findOne({ _id: oid(conversationId, 'conversation id'), userId, userRole: requester.role });
  if (!conversation) throw httpError(404, 'Conversation not found');
  return conversation;
};

export const loadConversation = async (conversationId) => {
  const conversation = await ChatConversation.findById(oid(conversationId, 'conversation id'));
  if (!conversation) throw httpError(404, 'Conversation not found');
  return conversation;
};

// ---------------------------------------------------------------- notifications (no message text)

// Each portal's existing support page, with ?chat=1 opening the live chat view.
const requesterRoute = (c) => (c.userRole === CHAT_USER_ROLE.SELLER ? '/seller/support?chat=1'
  : c.userRole === CHAT_USER_ROLE.DELIVERY ? '/delivery/support?chat=1' : '/support/chat');

const notifyRequester = (c, { event, title, message }) => {
  const opts = { event, title, message, route: requesterRoute(c), metadata: { conversationId: String(c._id), supportChat: true } };
  const send = c.userRole === CHAT_USER_ROLE.SELLER && c.vendorId ? notify("notifySeller", c.vendorId, opts)
    : c.userRole === CHAT_USER_ROLE.DELIVERY && c.vendorId ? notify("notifyRider", c.vendorId, opts)
      : notify("notifyUser", c.userId, opts);
  return Promise.resolve(send).catch((e) => console.error('[SUPPORT_CHAT] notify requester failed:', e.message));
};

const ROLE_LABEL = { CUSTOMER: 'Customer', SELLER: 'Seller', DELIVERY: 'Delivery partner' };

// ---------------------------------------------------------------- attachments

export const assertChatAttachments = (files = []) => {
  if (files.length > CHAT_MAX_ATTACHMENTS) throw httpError(400, `You can attach at most ${CHAT_MAX_ATTACHMENTS} files per message`);
  for (const file of files) {
    if (!TICKET_ATTACHMENT_MIME_TYPES.includes(file.mimetype)) {
      throw httpError(400, 'Only JPEG, PNG, WEBP images and PDF documents can be attached.');
    }
  }
};

// ---------------------------------------------------------------- messages

const otherSideRoles = (side) => (side === 'AGENT' ? CHAT_USER_ROLES : ['AGENT']);

/**
 * Persist one message and update the conversation. Returns
 * { message, conversation, duplicate }.
 */
const persistMessage = async (conversation, { senderId, senderRole, senderName, messageType, text, attachments = [], clientMessageId }) => {
  const clientId = typeof clientMessageId === 'string' && /^[\w-]{6,64}$/.test(clientMessageId) ? clientMessageId : undefined;
  if (clientId && senderId) {
    const existing = await ChatMessage.findOne({ conversationId: conversation._id, senderId, clientMessageId: clientId }).lean();
    if (existing) return { message: existing, conversation, duplicate: true };
  }

  let message;
  try {
    message = (await ChatMessage.create({
      conversationId: conversation._id, senderId, senderRole, senderName, messageType,
      messageText: text, attachments, ...(clientId ? { clientMessageId: clientId } : {}),
    })).toObject();
  } catch (err) {
    if (err.code === 11000 && clientId) {
      const existing = await ChatMessage.findOne({ conversationId: conversation._id, senderId, clientMessageId: clientId }).lean();
      if (existing) return { message: existing, conversation, duplicate: true };
    }
    throw err;
  }

  const update = { $set: { lastMessageAt: message.createdAt, lastMessagePreview: preview(text, attachments), lastMessageSenderRole: senderRole } };
  if (senderRole === 'AGENT') update.$inc = { unreadForUser: 1 };
  else if (senderRole !== 'SYSTEM') update.$inc = { unreadForAgent: 1 };
  const updated = await ChatConversation.findByIdAndUpdate(conversation._id, update, { new: true });
  return { message, conversation: updated || conversation, duplicate: false };
};

const fanOutMessage = async (conversation, message) => {
  const c = await withTicketNumber(conversation);
  const payload = { conversationId: String(c._id), message: messageView(message) };
  await Promise.all([
    emitToRequester(c, 'support:message:new', { ...payload, conversation: requesterView(c) }),
    emitToAgents('support:message:new', { ...payload, conversation: agentView(c) }, c.assignedAdminId),
  ]);
};

const systemMessage = async (conversation, text) => {
  const { message, conversation: updated } = await persistMessage(conversation, { senderRole: 'SYSTEM', senderName: 'Bulkimart Support', messageType: 'SYSTEM', text });
  await fanOutMessage(updated, message);
  return updated;
};

/** Requester sends a message (REST or socket). */
export const sendRequesterMessage = async ({ conversation, requester, user, text, attachments = [], clientMessageId }) => {
  const body = cleanText(text);
  if (!body && !attachments.length) throw httpError(400, 'Message is required');
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw httpError(400, `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`);
  if (!CHAT_OPEN_STATUSES.includes(conversation.status)) {
    throw httpError(409, 'This chat has ended. Reopen it or start a new chat.', { code: 'CHAT_CLOSED' });
  }
  const result = await persistMessage(conversation, {
    senderId: user._id, senderRole: requester.role, senderName: requester.name,
    messageType: attachments.length && !body ? 'ATTACHMENT' : 'TEXT', text: body, attachments, clientMessageId,
  });
  if (!result.duplicate) {
    await fanOutMessage(result.conversation, result.message);
    const c = result.conversation;
    // Only the first unread message after the agent last read pings them.
    if (c.assignedAdminId && c.unreadForAgent === 1) {
      notify("notifyAdmin", c.assignedAdminId, {
        event: EVT.SUPPORT_CHAT_MESSAGE,
        title: 'New live chat message',
        message: `${ROLE_LABEL[c.userRole]} ${c.userName} sent a message in ${c.conversationNumber}.`,
        metadata: { conversationId: String(c._id) },
        route: `/admin/live-chat/${c._id}`,
      }).catch(() => {});
    }
  }
  return result;
};

/** Agent sends a message. A WAITING chat is accepted by the replying agent first. */
export const sendAgentMessage = async ({ conversation, admin, text, attachments = [], clientMessageId }) => {
  const body = cleanText(text);
  if (!body && !attachments.length) throw httpError(400, 'Message is required');
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw httpError(400, `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`);

  let c = conversation;
  if (c.status === CHAT_STATUS.WAITING) c = await acceptConversation({ conversation: c, admin });
  if (c.status !== CHAT_STATUS.ACTIVE) throw httpError(409, 'Reopen this chat before replying.', { code: 'CHAT_CLOSED' });
  if (String(c.assignedAdminId) !== String(admin._id) && !isSuperAdmin(admin)) {
    throw httpError(403, `This chat is assigned to ${c.assignedAdminName || 'another agent'}. Ask them to transfer it.`, { code: 'CHAT_NOT_ASSIGNED' });
  }

  const result = await persistMessage(c, {
    senderId: admin._id, senderRole: 'AGENT', senderName: admin.name || 'Support',
    messageType: attachments.length && !body ? 'ATTACHMENT' : 'TEXT', text: body, attachments, clientMessageId,
  });
  if (!result.duplicate) {
    await fanOutMessage(result.conversation, result.message);
    if (result.conversation.unreadForUser === 1) {
      notifyRequester(result.conversation, {
        event: EVT.SUPPORT_CHAT_MESSAGE,
        title: 'Bulkimart Support replied',
        message: `You have a new reply in chat ${result.conversation.conversationNumber}.`,
      });
    }
  }
  return result;
};

/** Messages, newest page first in the query, returned oldest → newest. */
export const listMessages = async (conversationId, { before, limit = 30 } = {}) => {
  const size = Math.min(100, Math.max(1, Number(limit) || 30));
  const filter = { conversationId };
  if (before) {
    if (mongoose.isValidObjectId(before)) {
      const pivot = await ChatMessage.findOne({ _id: before, conversationId }).select('createdAt').lean();
      if (pivot) filter.$or = [{ createdAt: { $lt: pivot.createdAt } }, { createdAt: pivot.createdAt, _id: { $lt: pivot._id } }];
    } else if (!Number.isNaN(Date.parse(before))) {
      filter.createdAt = { $lt: new Date(before) };
    }
  }
  const rows = await ChatMessage.find(filter).sort({ createdAt: -1, _id: -1 }).limit(size + 1).lean();
  const hasMore = rows.length > size;
  return { messages: rows.slice(0, size).reverse().map(messageView), hasMore };
};

export const getMessage = async (conversationId, messageId) => {
  const message = await ChatMessage.findOne({ _id: oid(messageId, 'message id'), conversationId }).lean();
  if (!message) throw httpError(404, 'Message not found');
  return messageView(message);
};

/** Marks the other side's messages read (and delivered). `side` is the reader: 'USER' | 'AGENT'. */
export const markRead = async (conversation, side) => {
  const now = new Date();
  const senderRole = { $in: otherSideRoles(side === 'AGENT' ? 'AGENT' : 'USER') };
  await ChatMessage.updateMany({ conversationId: conversation._id, senderRole, deliveredAt: null }, { $set: { deliveredAt: now } });
  const { modifiedCount } = await ChatMessage.updateMany({ conversationId: conversation._id, senderRole, readAt: null }, { $set: { readAt: now } });
  const field = side === 'AGENT' ? 'unreadForAgent' : 'unreadForUser';
  const updated = await ChatConversation.findByIdAndUpdate(conversation._id, { $set: { [field]: 0 } }, { new: true });
  if (modifiedCount) {
    const payload = { conversationId: String(conversation._id), readAt: now, reader: side };
    if (side === 'AGENT') await emitToRequester(conversation, 'support:message:read', payload);
    else await emitToAgents('support:message:read', payload);
  }
  return updated;
};

/** The reader's app confirms it received these messages. */
export const markDelivered = async (conversation, side, messageIds = []) => {
  const ids = (Array.isArray(messageIds) ? messageIds : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 100);
  if (!ids.length) return 0;
  const now = new Date();
  const { modifiedCount } = await ChatMessage.updateMany(
    { _id: { $in: ids }, conversationId: conversation._id, senderRole: { $in: otherSideRoles(side === 'AGENT' ? 'AGENT' : 'USER') }, deliveredAt: null },
    { $set: { deliveredAt: now } },
  );
  if (modifiedCount) {
    const payload = { conversationId: String(conversation._id), messageIds: ids.map(String), deliveredAt: now };
    if (side === 'AGENT') await emitToRequester(conversation, 'support:message:delivered', payload);
    else await emitToAgents('support:message:delivered', payload);
  }
  return modifiedCount;
};

// ---------------------------------------------------------------- requester lifecycle

/**
 * Start a chat, or resume the requester's open one (one open chat per app).
 * Returns { conversation, message, resumed }.
 */
export const startConversation = async ({ user, requester, category, text, relatedOrderId, attachments = [], clientMessageId }) => {
  const existing = await ChatConversation.findOne({ userId: user._id, userRole: requester.role, isOpen: true });
  if (existing) {
    let message = null;
    let conversation = existing;
    if (cleanText(text) || attachments.length) {
      ({ message, conversation } = await sendRequesterMessage({ conversation: existing, requester, user, text, attachments, clientMessageId }));
    }
    return { conversation, message, resumed: true };
  }

  if (!category || !categoriesFor(requester.role).includes(category)) throw httpError(400, 'Choose a support topic');
  const body = cleanText(text);
  if (!body && !attachments.length) throw httpError(400, 'Describe your issue to start the chat');
  if (body.length > CHAT_MESSAGE_MAX_LENGTH) throw httpError(400, `Messages can be at most ${CHAT_MESSAGE_MAX_LENGTH} characters`);

  let relatedOrder = null;
  if (relatedOrderId) {
    ({ order: relatedOrder } = await assertRelatedEntitiesOwned(
      { role: CHAT_ROLE_TO_TICKET_ROLE[requester.role], vendorId: requester.vendorId, user },
      { relatedOrder: relatedOrderId },
    ));
  }

  let conversation;
  for (let attempt = 0; attempt < 5 && !conversation; attempt += 1) {
    try {
      conversation = await ChatConversation.create({
        conversationNumber: newConversationNumber(),
        userId: user._id, userRole: requester.role, userName: requester.name, vendorId: requester.vendorId || undefined,
        status: CHAT_STATUS.WAITING, isOpen: true, supportCategory: category,
        relatedOrderId: relatedOrder?._id, queuedAt: new Date(), lastMessageAt: new Date(),
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      if (err.keyPattern?.isOpen || err.keyPattern?.userRole) {
        // Another request opened one at the same moment: resume it instead.
        const raced = await ChatConversation.findOne({ userId: user._id, userRole: requester.role, isOpen: true });
        if (raced) return startConversation({ user, requester, category, text, relatedOrderId, attachments, clientMessageId });
      }
    }
  }
  if (!conversation) throw httpError(503, 'Could not start the chat. Please try again.');

  const { message, conversation: updated } = await sendRequesterMessage({ conversation, requester, user, text: body, attachments, clientMessageId });

  await emitToAgents('support:conversation:created', { conversation: agentView(updated.toObject()) });
  notify("notifyAllAdmins", {
    event: EVT.SUPPORT_CHAT_STARTED,
    title: 'New live chat waiting',
    message: `${ROLE_LABEL[requester.role]} ${requester.name} started ${updated.conversationNumber} (${category}).`,
    metadata: { conversationId: String(updated._id) },
    route: `/admin/live-chat/${updated._id}`,
  }).catch(() => {});

  return { conversation: updated, message, resumed: false };
};

export const closeConversation = async ({ conversation, by, admin }) => {
  if (conversation.status === CHAT_STATUS.CLOSED) return conversation;
  if (by === 'AGENT' && conversation.assignedAdminId && String(conversation.assignedAdminId) !== String(admin._id) && !isSuperAdmin(admin)) {
    throw httpError(403, 'Only the assigned agent can close this chat.', { code: 'CHAT_NOT_ASSIGNED' });
  }
  const updated = await ChatConversation.findOneAndUpdate(
    { _id: conversation._id, status: { $ne: CHAT_STATUS.CLOSED } },
    { $set: { status: CHAT_STATUS.CLOSED, isOpen: false, closedAt: new Date(), closedBy: by } },
    { new: true },
  );
  if (!updated) return loadConversation(conversation._id);
  const after = await systemMessage(updated, by === 'AGENT' ? `${admin.name || 'Support'} closed this chat.` : 'Chat closed by user.');
  await broadcastConversation(after, 'closed');
  if (by === 'AGENT') {
    notifyRequester(after, { event: EVT.SUPPORT_CHAT_STATUS, title: 'Support chat closed', message: `Chat ${after.conversationNumber} was closed by Bulkimart Support.` });
  }
  return after;
};

export const reopenConversation = async ({ conversation, by, admin }) => {
  if (![CHAT_STATUS.RESOLVED, CHAT_STATUS.CLOSED].includes(conversation.status)) throw httpError(409, 'This chat is still open.');
  if (by === 'USER' && !canRequesterReopen(conversation)) {
    throw httpError(409, `Chats can be reopened for ${CHAT_REOPEN_WINDOW_DAYS} days. Please start a new chat.`, { code: 'CHAT_REOPEN_EXPIRED' });
  }
  const set = by === 'AGENT'
    ? { status: CHAT_STATUS.ACTIVE, assignedAdminId: admin._id, assignedAdminName: admin.name || 'Support', acceptedAt: new Date() }
    : { status: CHAT_STATUS.WAITING, queuedAt: new Date() };
  let updated;
  try {
    updated = await ChatConversation.findOneAndUpdate(
      { _id: conversation._id, status: { $in: [CHAT_STATUS.RESOLVED, CHAT_STATUS.CLOSED] } },
      { $set: { ...set, isOpen: true }, $unset: { closedAt: 1, resolvedAt: 1, closedBy: 1, ...(by === 'USER' ? { assignedAdminId: 1, assignedAdminName: 1, acceptedAt: 1 } : {}) }, $inc: { reopenCount: 1 } },
      { new: true },
    );
  } catch (err) {
    if (err.code === 11000) throw httpError(409, 'There is already an open chat for this account. Continue that one.', { code: 'CHAT_ALREADY_OPEN' });
    throw err;
  }
  if (!updated) throw httpError(409, 'This chat is still open.');
  const after = await systemMessage(updated, by === 'AGENT' ? `${admin.name || 'Support'} reopened this chat.` : 'Chat reopened by user.');
  await broadcastConversation(after, 'reopened');
  if (by === 'USER') {
    await emitToAgents('support:conversation:created', { conversation: agentView(after.toObject()) });
    notify("notifyAllAdmins", {
      event: EVT.SUPPORT_CHAT_STARTED,
      title: 'Live chat reopened',
      message: `${ROLE_LABEL[after.userRole]} ${after.userName} reopened ${after.conversationNumber}.`,
      metadata: { conversationId: String(after._id), reopen: after.reopenCount },
      route: `/admin/live-chat/${after._id}`,
    }).catch(() => {});
  }
  return after;
};

// ---------------------------------------------------------------- agent lifecycle

export const acceptConversation = async ({ conversation, admin }) => {
  const updated = await ChatConversation.findOneAndUpdate(
    { _id: conversation._id, status: CHAT_STATUS.WAITING },
    { $set: { status: CHAT_STATUS.ACTIVE, assignedAdminId: admin._id, assignedAdminName: admin.name || 'Support', acceptedAt: new Date() } },
    { new: true },
  );
  if (!updated) {
    const current = await loadConversation(conversation._id);
    if (current.status === CHAT_STATUS.ACTIVE && String(current.assignedAdminId) === String(admin._id)) return current;
    throw httpError(409, current.status === CHAT_STATUS.ACTIVE
      ? `Already accepted by ${current.assignedAdminName || 'another agent'}.` : 'This chat is no longer waiting.', { code: 'CHAT_NOT_WAITING' });
  }
  const after = await systemMessage(updated, `${admin.name || 'A support agent'} joined the chat.`);
  await broadcastConversation(after, 'accepted');
  notifyRequester(after, { event: EVT.SUPPORT_CHAT_ACCEPTED, title: 'Support agent joined', message: `${admin.name || 'A support agent'} joined chat ${after.conversationNumber}.` });
  return after;
};

/** Assign a waiting chat, or transfer an active one (assigned agent or superAdmin only). */
export const assignConversation = async ({ conversation, admin, targetAdminId }) => {
  const target = await Admin.findOne({ _id: oid(targetAdminId, 'agent id'), isActive: true }).select('_id name').lean();
  if (!target) throw httpError(404, 'Agent not found or inactive');
  if (!CHAT_OPEN_STATUSES.includes(conversation.status)) throw httpError(409, 'Reopen this chat before assigning it.');
  if (conversation.status === CHAT_STATUS.ACTIVE && String(conversation.assignedAdminId) !== String(admin._id) && !isSuperAdmin(admin)) {
    throw httpError(403, 'Only the assigned agent or a super admin can transfer this chat.', { code: 'CHAT_NOT_ASSIGNED' });
  }
  if (String(conversation.assignedAdminId) === String(target._id) && conversation.status === CHAT_STATUS.ACTIVE) return conversation;

  const updated = await ChatConversation.findOneAndUpdate(
    { _id: conversation._id, status: conversation.status, assignedAdminId: conversation.assignedAdminId ?? null },
    { $set: { status: CHAT_STATUS.ACTIVE, assignedAdminId: target._id, assignedAdminName: target.name || 'Support', acceptedAt: new Date() } },
    { new: true },
  );
  if (!updated) throw httpError(409, 'This chat changed while you were assigning it. Refresh and try again.');
  const after = await systemMessage(updated, conversation.assignedAdminId
    ? `Chat transferred to ${target.name || 'another agent'}.` : `${target.name || 'A support agent'} joined the chat.`);
  await broadcastConversation(after, 'assigned');
  if (String(target._id) !== String(admin._id)) {
    notify("notifyAdmin", target._id, {
      event: EVT.SUPPORT_CHAT_STARTED,
      title: 'Live chat assigned to you',
      message: `${admin.name || 'An admin'} assigned ${after.conversationNumber} (${ROLE_LABEL[after.userRole]} ${after.userName}) to you.`,
      metadata: { conversationId: String(after._id) },
      route: `/admin/live-chat/${after._id}`,
    }).catch(() => {});
  }
  return after;
};

export const resolveConversation = async ({ conversation, admin }) => {
  if (conversation.status !== CHAT_STATUS.ACTIVE) throw httpError(409, 'Only an active chat can be resolved.');
  if (String(conversation.assignedAdminId) !== String(admin._id) && !isSuperAdmin(admin)) {
    throw httpError(403, 'Only the assigned agent can resolve this chat.', { code: 'CHAT_NOT_ASSIGNED' });
  }
  const updated = await ChatConversation.findOneAndUpdate(
    { _id: conversation._id, status: CHAT_STATUS.ACTIVE },
    { $set: { status: CHAT_STATUS.RESOLVED, isOpen: false, resolvedAt: new Date() } },
    { new: true },
  );
  if (!updated) throw httpError(409, 'This chat changed. Refresh and try again.');
  const after = await systemMessage(updated, `${admin.name || 'Support'} marked this chat as resolved.`);
  await broadcastConversation(after, 'resolved');
  notifyRequester(after, { event: EVT.SUPPORT_CHAT_STATUS, title: 'Support chat resolved', message: `Chat ${after.conversationNumber} was marked resolved. You can reopen it within ${CHAT_REOPEN_WINDOW_DAYS} days.` });
  return after;
};

// ---------------------------------------------------------------- agents & availability

const activeCounts = async () => {
  const rows = await ChatConversation.aggregate([
    { $match: { status: CHAT_STATUS.ACTIVE, assignedAdminId: { $ne: null } } },
    { $group: { _id: '$assignedAdminId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
};

const effectiveStatus = (preference, online, activeCount) => {
  if (!online || preference === AGENT_STATUS.OFFLINE) return AGENT_STATUS.OFFLINE;
  if (preference === AGENT_STATUS.BUSY || activeCount >= CHAT_AGENT_MAX_ACTIVE) return AGENT_STATUS.BUSY;
  return AGENT_STATUS.AVAILABLE;
};

/** Every active admin with their live chat status — for the agent dashboard. */
export const listAgents = async () => {
  const [admins, prefs, counts] = await Promise.all([
    Admin.find({ isActive: true }).select('_id name email role').lean(),
    SupportAgent.find({}).lean(),
    activeCounts(),
  ]);
  const prefBy = new Map(prefs.map((p) => [String(p.adminId), p]));
  return admins.map((a) => {
    const id = String(a._id);
    const preference = prefBy.get(id)?.status || AGENT_STATUS.AVAILABLE;
    const online = isAgentOnline(id);
    const activeChats = counts.get(id) || 0;
    return { _id: a._id, name: a.name, email: a.email, role: a.role, preference, online, activeChats, status: effectiveStatus(preference, online, activeChats), lastSeenAt: prefBy.get(id)?.lastSeenAt || null };
  });
};

export const setAgentPreference = async (adminId, status) => {
  if (!AGENT_STATUSES.includes(status)) throw httpError(400, `Status must be one of ${AGENT_STATUSES.join(', ')}`);
  await SupportAgent.findOneAndUpdate({ adminId }, { $set: { status, lastSeenAt: new Date() } }, { upsert: true, setDefaultsOnInsert: true });
  await broadcastAgentStatus();
  return status;
};

export const touchAgent = (adminId) => SupportAgent.updateOne({ adminId }, { $set: { lastSeenAt: new Date() } }, { upsert: true }).catch(() => {});

export const broadcastAgentStatus = async () => {
  try {
    const agents = await listAgents();
    emitRoom(SUPPORT_ROOM.agents, 'support:agent:status', { agents });
  } catch (err) {
    console.error('[SUPPORT_CHAT] agent status broadcast failed:', err.message);
  }
};

/**
 * What requesters see before and during a chat. Counts only — no agent
 * identities — and computed from live connections, never assumed.
 */
export const publicAvailability = async (conversation = null) => {
  const agents = await listAgents();
  const availableAgents = agents.filter((a) => a.status === AGENT_STATUS.AVAILABLE).length;
  const onlineAgents = agents.filter((a) => a.status !== AGENT_STATUS.OFFLINE).length;
  const waitingCount = await ChatConversation.countDocuments({ status: CHAT_STATUS.WAITING });
  let queuePosition = null;
  if (conversation?.status === CHAT_STATUS.WAITING) {
    queuePosition = 1 + await ChatConversation.countDocuments({ status: CHAT_STATUS.WAITING, queuedAt: { $lt: conversation.queuedAt || conversation.createdAt } });
  }
  const status = availableAgents ? AGENT_STATUS.AVAILABLE : onlineAgents ? AGENT_STATUS.BUSY : AGENT_STATUS.OFFLINE;
  return {
    status,
    availableAgents,
    onlineAgents,
    waitingCount,
    queuePosition,
    message: status === AGENT_STATUS.AVAILABLE ? 'Support agents are available.'
      : 'All support agents are currently busy. Please wait or create a support ticket.',
  };
};

// ---------------------------------------------------------------- admin queries

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const adminListConversations = async (admin, query = {}) => {
  const filter = {};
  const status = String(query.status || '').toUpperCase();
  if (status === 'OPEN') filter.status = { $in: CHAT_OPEN_STATUSES };
  else if (Object.values(CHAT_STATUS).includes(status)) filter.status = status;
  const role = String(query.role || '').toUpperCase();
  if (CHAT_USER_ROLES.includes(role)) filter.userRole = role;
  if (query.mine === 'true' || query.mine === '1') filter.assignedAdminId = admin._id;
  if (query.unread === 'true' || query.unread === '1') filter.unreadForAgent = { $gt: 0 };
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from && !Number.isNaN(Date.parse(query.from))) filter.createdAt.$gte = new Date(query.from);
    if (query.to && !Number.isNaN(Date.parse(query.to))) filter.createdAt.$lte = new Date(new Date(query.to).getTime() + 86399999);
    if (!Object.keys(filter.createdAt).length) delete filter.createdAt;
  }
  const q = String(query.q || '').trim().slice(0, 80);
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ conversationNumber: rx }, { userName: rx }, { supportCategory: rx }, { lastMessagePreview: rx }];
    if (mongoose.isValidObjectId(q)) filter.$or.push({ _id: q }, { userId: q }, { relatedOrderId: q });
  }

  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
  const sort = status === CHAT_STATUS.WAITING ? { queuedAt: 1, createdAt: 1 } : { lastMessageAt: -1 };
  const [rows, total, counts, unreadMine] = await Promise.all([
    ChatConversation.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    ChatConversation.countDocuments(filter),
    ChatConversation.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ChatConversation.countDocuments({ assignedAdminId: admin._id, status: CHAT_STATUS.ACTIVE, unreadForAgent: { $gt: 0 } }),
  ]);
  const byStatus = Object.fromEntries(Object.values(CHAT_STATUS).map((s) => [s, 0]));
  counts.forEach((c) => { if (c._id) byStatus[c._id] = c.count; });
  return { conversations: rows.map(agentView), total, page, limit, counts: { ...byStatus, unreadMine } };
};

/** Right-panel context for the agent dashboard. */
export const adminConversationContext = async (conversation) => {
  const c = await withTicketNumber(conversation);
  const [user, seller, partner, order, previous, tickets] = await Promise.all([
    User.findById(c.userId).select('name phone email createdAt isActive roles').lean(),
    c.userRole === CHAT_USER_ROLE.SELLER ? Seller.findOne({ userId: c.userId }).select('_id businessName status onboardingStep').lean() : null,
    c.userRole === CHAT_USER_ROLE.DELIVERY ? DeliveryPartner.findOne({ userId: c.userId }).select('_id status vehicleType').lean() : null,
    c.relatedOrderId ? Order.findById(c.relatedOrderId).select('orderNo status orderStatus pricing.totalAmount paymentMethod createdAt').lean() : null,
    ChatConversation.find({ userId: c.userId, userRole: c.userRole, _id: { $ne: c._id } }).sort({ lastMessageAt: -1 }).limit(10)
      .select('conversationNumber status supportCategory lastMessageAt createdAt').lean(),
    Ticket.find({ userId: c.userId }).sort({ createdAt: -1 }).limit(10).select('ticketNumber subject status category requesterRole createdAt').lean(),
  ]);
  return {
    conversation: agentView(c),
    user: user ? { _id: user._id, name: user.name, phone: user.phone, email: user.email, memberSince: user.createdAt, isActive: user.isActive } : null,
    seller: seller ? { _id: seller._id, businessName: seller.businessName, status: seller.status, onboardingStep: seller.onboardingStep } : null,
    deliveryPartner: partner ? { _id: partner._id, status: partner.status, vehicleType: partner.vehicleType } : null,
    relatedOrder: order ? { _id: order._id, orderNo: order.orderNo, status: order.orderStatus || order.status, totalAmount: order.pricing?.totalAmount ?? null, paymentMethod: order.paymentMethod, createdAt: order.createdAt } : null,
    previousConversations: previous,
    tickets,
  };
};

// ---------------------------------------------------------------- ticket integration

const transcript = async (conversationId) => {
  const rows = await ChatMessage.find({ conversationId }).sort({ createdAt: 1 }).limit(200).lean();
  const lines = rows.map((m) => {
    const at = new Date(m.createdAt).toISOString().replace('T', ' ').slice(0, 16);
    const files = m.attachments?.length ? ` [${m.attachments.length} attachment(s)]` : '';
    return `[${at}] ${m.senderRole === 'SYSTEM' ? '—' : m.senderName || m.senderRole}: ${m.messageText || ''}${files}`;
  });
  const text = lines.join('\n');
  return text.length > 8000 ? `…\n${text.slice(-8000)}` : text;
};

/** Create a support ticket from a chat. Idempotent: a chat links to at most one ticket. */
export const createTicketFromChat = async ({ conversation, admin, subject }) => {
  if (conversation.relatedTicketId) {
    const existing = await Ticket.findById(conversation.relatedTicketId).lean();
    if (existing) return { ticket: existing, created: false };
  }
  const ticketNumber = await generateTicketNumber();
  const title = cleanText(subject).slice(0, 150) || `Live chat ${conversation.conversationNumber}: ${conversation.supportCategory}`;
  const description = `Created from live chat ${conversation.conversationNumber} by ${admin.name || 'Support'}.\n\n${await transcript(conversation._id)}`;
  const ticket = await Ticket.create({
    ticketNumber,
    userId: conversation.userId,
    requesterRole: CHAT_ROLE_TO_TICKET_ROLE[conversation.userRole],
    userName: conversation.userName,
    subject: title,
    description,
    category: conversation.supportCategory,
    status: TICKET_STATUS.IN_PROGRESS,
    relatedOrder: conversation.relatedOrderId || undefined,
    relatedDelivery: conversation.relatedDeliveryId || undefined,
    assignedAdmin: admin._id,
  });
  await TicketMessage.create({ ticketId: ticket._id, senderId: admin._id, senderRole: 'admin', senderName: admin.name || 'Support', message: description });

  // Conditional link: a concurrent create cannot attach a second ticket.
  const linked = await ChatConversation.findOneAndUpdate(
    { _id: conversation._id, relatedTicketId: null },
    { $set: { relatedTicketId: ticket._id } },
    { new: true },
  );
  if (!linked) {
    await TicketMessage.deleteMany({ ticketId: ticket._id });
    await Ticket.deleteOne({ _id: ticket._id });
    const fresh = await loadConversation(conversation._id);
    return { ticket: await Ticket.findById(fresh.relatedTicketId).lean(), created: false };
  }
  const after = await systemMessage(linked, `Support ticket ${ticketNumber} was created for this chat.`);
  await broadcastConversation(after, 'ticket');
  notifyRequester(after, { event: EVT.TICKET_CREATED, title: 'Support ticket created', message: `Ticket #${ticketNumber} was created from your chat ${after.conversationNumber}.` });
  return { ticket: ticket.toObject(), created: true };
};

/** Link an existing ticket of the same person to the chat. */
export const linkTicketToChat = async ({ conversation, ticketId }) => {
  const ticket = await Ticket.findOne({ _id: oid(ticketId, 'ticket id'), userId: conversation.userId }).select('ticketNumber').lean();
  if (!ticket) throw httpError(404, 'Ticket not found for this user');
  const updated = await ChatConversation.findByIdAndUpdate(conversation._id, { $set: { relatedTicketId: ticket._id } }, { new: true });
  const after = await systemMessage(updated, `Linked to support ticket ${ticket.ticketNumber || ticket._id}.`);
  await broadcastConversation(after, 'ticket');
  return after;
};

/** Chats linked to a ticket — shown inside the admin ticket detail. */
export const chatsForTicket = (ticketId) => ChatConversation.find({ relatedTicketId: ticketId })
  .select('conversationNumber status supportCategory userRole createdAt lastMessageAt').lean();
