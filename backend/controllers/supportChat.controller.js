import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, httpError } from '../utils/response.js';
import { uploadAttachments } from './ticket.controller.js';
import {
  resolveChatRequester, categoriesFor, requesterView, agentView, messageView,
  loadOwnedConversation, loadConversation, startConversation, sendRequesterMessage, sendAgentMessage,
  listMessages, getMessage, markRead, closeConversation, reopenConversation, acceptConversation,
  assignConversation, resolveConversation, publicAvailability, listAgents, setAgentPreference,
  adminListConversations, adminConversationContext, createTicketFromChat, linkTicketToChat, assertChatAttachments,
} from '../services/supportChat.service.js';
import ChatConversation from '../models/ChatConversation.js';

const requesterOf = (req) => resolveChatRequester(req.user, req.tokenRole);

const withNumber = async (conversation) => {
  const c = conversation.toObject ? conversation.toObject() : conversation;
  if (c.relatedTicketId) {
    const { default: Ticket } = await import('../models/Ticket.js');
    c.relatedTicketNumber = (await Ticket.findById(c.relatedTicketId).select('ticketNumber').lean())?.ticketNumber || null;
  }
  return c;
};

const files = async (req) => {
  assertChatAttachments(req.files || []);
  return uploadAttachments(req.files || [], req);
};

// ================================================================ requester (customer / seller / delivery)

// GET /api/support-chat/availability
export const getAvailability = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const open = await ChatConversation.findOne({ userId: req.user._id, userRole: requester.role, isOpen: true }).lean();
  ok(res, await publicAvailability(open));
});

// GET /api/support-chat/categories
export const getCategories = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  ok(res, { role: requester.role, categories: categoriesFor(requester.role) });
});

// GET /api/support-chat/conversations  — this app's chat history
export const listMyConversations = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const filter = { userId: req.user._id, userRole: requester.role };
  const [rows, total] = await Promise.all([
    ChatConversation.find(filter).sort({ isOpen: -1, lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ChatConversation.countDocuments(filter),
  ]);
  ok(res, await Promise.all(rows.map(async (r) => requesterView(await withNumber(r)))), '', { page, limit, total });
});

// POST /api/support-chat/conversations  { supportCategory, message, relatedOrderId?, clientMessageId? } + attachments
export const startChat = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const attachments = await files(req);
  const { conversation, message, resumed } = await startConversation({
    user: req.user, requester,
    category: req.body.supportCategory || req.body.category,
    text: req.body.message,
    relatedOrderId: req.body.relatedOrderId || undefined,
    attachments,
    clientMessageId: req.body.clientMessageId,
  });
  const body = { conversation: requesterView(await withNumber(conversation)), message: message ? messageView(message) : null, resumed, availability: await publicAvailability(conversation) };
  return resumed ? ok(res, body, 'Continuing your open chat') : created(res, body, 'Chat started');
});

// GET /api/support-chat/conversations/:id
export const getMyConversation = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  ok(res, { conversation: requesterView(await withNumber(conversation)), availability: await publicAvailability(conversation) });
});

// GET /api/support-chat/conversations/:id/messages?before=&limit=
export const getMyMessages = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  ok(res, await listMessages(conversation._id, req.query));
});

// GET /api/support-chat/conversations/:id/messages/:messageId  (refetch with signed attachment URLs)
export const getMyMessage = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  ok(res, await getMessage(conversation._id, req.params.messageId));
});

// POST /api/support-chat/conversations/:id/messages  { message, clientMessageId? } + attachments
export const postMyMessage = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  if (!['WAITING', 'ACTIVE'].includes(conversation.status)) throw httpError(409, 'This chat has ended. Reopen it or start a new chat.', { code: 'CHAT_CLOSED' });
  const attachments = await files(req);
  const { message, duplicate } = await sendRequesterMessage({ conversation, requester, user: req.user, text: req.body.message, attachments, clientMessageId: req.body.clientMessageId });
  return duplicate ? ok(res, messageView(message), 'Already sent') : created(res, messageView(message), 'Message sent');
});

// POST /api/support-chat/conversations/:id/read
export const readMyConversation = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  ok(res, requesterView(await withNumber(await markRead(conversation, 'USER'))));
});

// POST /api/support-chat/conversations/:id/close
export const closeMyConversation = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  ok(res, requesterView(await withNumber(await closeConversation({ conversation, by: 'USER' }))), 'Chat closed');
});

// POST /api/support-chat/conversations/:id/reopen
export const reopenMyConversation = asyncHandler(async (req, res) => {
  const requester = await requesterOf(req);
  const conversation = await loadOwnedConversation(req.params.id, requester, req.user._id);
  ok(res, requesterView(await withNumber(await reopenConversation({ conversation, by: 'USER' }))), 'Chat reopened');
});

// ================================================================ admin / support agents

// GET /api/admin/support-chat/agents
export const adminGetAgents = asyncHandler(async (req, res) => {
  ok(res, { agents: await listAgents(), me: String(req.user._id) });
});

// PATCH /api/admin/support-chat/agents/me  { status: AVAILABLE | BUSY | OFFLINE }
export const adminSetMyStatus = asyncHandler(async (req, res) => {
  ok(res, { status: await setAgentPreference(req.user._id, String(req.body.status || '').toUpperCase()) });
});

// GET /api/admin/support-chat/conversations?status=&role=&q=&from=&to=&mine=&unread=&page=
export const adminListChats = asyncHandler(async (req, res) => {
  const result = await adminListConversations(req.user, req.query);
  ok(res, result.conversations, '', { page: result.page, limit: result.limit, total: result.total, counts: result.counts });
});

// GET /api/admin/support-chat/conversations/:id
export const adminGetChat = asyncHandler(async (req, res) => {
  ok(res, await adminConversationContext(await loadConversation(req.params.id)));
});

// GET /api/admin/support-chat/conversations/:id/messages
export const adminGetMessages = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.params.id);
  ok(res, await listMessages(conversation._id, req.query));
});

// GET /api/admin/support-chat/conversations/:id/messages/:messageId
export const adminGetMessage = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.params.id);
  ok(res, await getMessage(conversation._id, req.params.messageId));
});

// POST /api/admin/support-chat/conversations/:id/messages
export const adminPostMessage = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.params.id);
  const attachments = await files(req);
  const { message, duplicate } = await sendAgentMessage({ conversation, admin: req.user, text: req.body.message, attachments, clientMessageId: req.body.clientMessageId });
  return duplicate ? ok(res, messageView(message), 'Already sent') : created(res, messageView(message), 'Message sent');
});

const agentAction = (fn, message) => asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.params.id);
  const result = await fn(conversation, req);
  ok(res, agentView(await withNumber(result)), message);
});

export const adminReadChat = agentAction((conversation) => markRead(conversation, 'AGENT'));
export const adminAcceptChat = agentAction((conversation, req) => acceptConversation({ conversation, admin: req.user }), 'Chat accepted');
export const adminAssignChat = agentAction((conversation, req) => assignConversation({ conversation, admin: req.user, targetAdminId: req.body.adminId }), 'Chat assigned');
export const adminResolveChat = agentAction((conversation, req) => resolveConversation({ conversation, admin: req.user }), 'Chat resolved');
export const adminCloseChat = agentAction((conversation, req) => closeConversation({ conversation, by: 'AGENT', admin: req.user }), 'Chat closed');
export const adminReopenChat = agentAction((conversation, req) => reopenConversation({ conversation, by: 'AGENT', admin: req.user }), 'Chat reopened');
export const adminLinkTicket = agentAction((conversation, req) => linkTicketToChat({ conversation, ticketId: req.body.ticketId }), 'Ticket linked');

// POST /api/admin/support-chat/conversations/:id/ticket  { subject? }
export const adminCreateTicket = asyncHandler(async (req, res) => {
  const conversation = await loadConversation(req.params.id);
  const { ticket, created: isNew } = await createTicketFromChat({ conversation, admin: req.user, subject: req.body.subject });
  return isNew ? created(res, ticket, `Ticket ${ticket.ticketNumber} created`) : ok(res, ticket, 'This chat already has a ticket');
});
