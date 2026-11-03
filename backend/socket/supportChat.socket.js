/**
 * Live chat socket events. Authorization is decided here from the verified
 * JWT on the socket (socket.userId / socket.userType / socket.tokenRole) and
 * the database — never from ids or roles in the event payload.
 *
 * Client → server (all accept an optional ack callback):
 *   support:join        {}                          requester: join own requester room; admin: join agents room (+ presence)
 *   support:leave       {}
 *   support:message:send      { conversationId, text, clientMessageId }
 *   support:message:delivered { conversationId, messageIds }
 *   support:message:read      { conversationId }
 *   support:typing:start / support:typing:stop { conversationId }
 *   support:agent:status      { status }          admin only
 *
 * Server → client: support:message:new, support:message:delivered,
 * support:message:read, support:typing, support:conversation:created,
 * support:conversation:updated (+ :accepted / :assigned / :close / :reopen),
 * support:agent:status.
 */
import Admin from '../models/Admin.js';
import User from '../models/User.js';
import ChatConversation from '../models/ChatConversation.js';
import {
  SUPPORT_ROOM, setSupportIo, resolveChatRequester, chatRoleFromToken, agentSocketConnected, agentSocketDisconnected,
  sendRequesterMessage, sendAgentMessage, markRead, markDelivered, setAgentPreference, broadcastAgentStatus,
  touchAgent, messageView, isSuperAdmin,
} from '../services/supportChat.service.js';
import { CHAT_STATUS } from '../constants/enums.js';

const reply = (ack, body) => { if (typeof ack === 'function') ack(body); };
const fail = (ack, err) => reply(ack, { ok: false, message: err?.message || 'Request failed', code: err?.meta?.code || null });
const validId = (v) => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);

export const registerSupportChatHandlers = (io, socket) => {
  setSupportIo(() => io);

  // Identity cached per socket after the first successful join.
  let identity = null; // { kind: 'agent', admin } | { kind: 'requester', user, requester }
  const sendWindow = []; // simple per-socket send rate limit

  const loadIdentity = async () => {
    if (identity) return identity;
    if (socket.userType === 'admin') {
      const admin = await Admin.findById(socket.userId).select('_id name role isActive').lean();
      if (!admin?.isActive) throw new Error('Admin account is not active');
      identity = { kind: 'agent', admin };
    } else {
      const user = await User.findById(socket.userId).select('_id name roles isActive').lean();
      if (!user?.isActive) throw new Error('Account is not active');
      identity = { kind: 'requester', user, requester: await resolveChatRequester(user, socket.tokenRole) };
    }
    return identity;
  };

  /** Conversation the caller may act on, or throws. Cached briefly for typing events. */
  const owned = new Map();
  const loadAllowed = async (conversationId) => {
    if (!validId(conversationId)) throw new Error('Invalid conversation id');
    const id = await loadIdentity();
    const conversation = await ChatConversation.findById(conversationId);
    if (!conversation) throw new Error('Conversation not found');
    if (id.kind === 'requester') {
      if (String(conversation.userId) !== String(id.user._id) || conversation.userRole !== id.requester.role) {
        throw new Error('Conversation not found');
      }
    }
    owned.set(conversationId, { at: Date.now(), userId: String(conversation.userId), userRole: conversation.userRole, assignedAdminId: String(conversation.assignedAdminId || '') });
    return { conversation, id };
  };
  const cachedAllowed = async (conversationId) => {
    const hit = owned.get(conversationId);
    if (hit && Date.now() - hit.at < 60_000) return hit;
    await loadAllowed(conversationId);
    return owned.get(conversationId);
  };

  socket.on('support:join', async (_payload, ack) => {
    try {
      const id = await loadIdentity();
      if (id.kind === 'agent') {
        socket.join(SUPPORT_ROOM.agents);
        if (agentSocketConnected(id.admin._id, socket.id)) {
          touchAgent(id.admin._id);
          await broadcastAgentStatus();
        }
        return reply(ack, { ok: true, role: 'AGENT' });
      }
      socket.join(SUPPORT_ROOM.requester(id.requester.role, id.user._id));
      return reply(ack, { ok: true, role: id.requester.role });
    } catch (err) { return fail(ack, err); }
  });

  socket.on('support:leave', async (_payload, ack) => {
    if (identity?.kind === 'agent') {
      socket.leave(SUPPORT_ROOM.agents);
      if (agentSocketDisconnected(identity.admin._id, socket.id)) await broadcastAgentStatus();
    } else if (identity?.kind === 'requester') {
      socket.leave(SUPPORT_ROOM.requester(identity.requester.role, identity.user._id));
    }
    reply(ack, { ok: true });
  });

  socket.on('support:message:send', async (payload = {}, ack) => {
    try {
      const now = Date.now();
      while (sendWindow.length && now - sendWindow[0] > 10_000) sendWindow.shift();
      if (sendWindow.length >= 15) throw new Error('You are sending messages too quickly. Please wait a moment.');
      sendWindow.push(now);
      const { conversation, id } = await loadAllowed(payload.conversationId);
      const result = id.kind === 'agent'
        ? await sendAgentMessage({ conversation, admin: id.admin, text: payload.text, clientMessageId: payload.clientMessageId })
        : await sendRequesterMessage({ conversation, requester: id.requester, user: id.user, text: payload.text, clientMessageId: payload.clientMessageId });
      return reply(ack, { ok: true, message: messageView(result.message), duplicate: result.duplicate });
    } catch (err) { return fail(ack, err); }
  });

  socket.on('support:message:delivered', async (payload = {}, ack) => {
    try {
      const { conversation, id } = await loadAllowed(payload.conversationId);
      await markDelivered(conversation, id.kind === 'agent' ? 'AGENT' : 'USER', payload.messageIds);
      reply(ack, { ok: true });
    } catch (err) { fail(ack, err); }
  });

  socket.on('support:message:read', async (payload = {}, ack) => {
    try {
      const { conversation, id } = await loadAllowed(payload.conversationId);
      await markRead(conversation, id.kind === 'agent' ? 'AGENT' : 'USER');
      reply(ack, { ok: true });
    } catch (err) { fail(ack, err); }
  });

  const typing = (isTyping) => async (payload = {}) => {
    try {
      const meta = await cachedAllowed(payload.conversationId);
      const id = await loadIdentity();
      const event = { conversationId: payload.conversationId, typing: isTyping };
      if (id.kind === 'agent') {
        // Only the agent handling the chat (or a super admin) shows as typing to the user.
        if (meta.assignedAdminId && meta.assignedAdminId !== String(id.admin._id) && !isSuperAdmin(id.admin)) return;
        io.to(SUPPORT_ROOM.requester(meta.userRole, meta.userId)).emit('support:typing', { ...event, side: 'AGENT', name: id.admin.name || 'Support' });
        socket.to(SUPPORT_ROOM.agents).emit('support:typing', { ...event, side: 'AGENT', name: id.admin.name || 'Support', agentId: String(id.admin._id) });
      } else {
        io.to(SUPPORT_ROOM.agents).emit('support:typing', { ...event, side: 'USER', name: id.requester.name });
      }
    } catch { /* typing is best effort */ }
  };
  socket.on('support:typing:start', typing(true));
  socket.on('support:typing:stop', typing(false));

  socket.on('support:agent:status', async (payload = {}, ack) => {
    try {
      const id = await loadIdentity();
      if (id.kind !== 'agent') throw new Error('Not a support agent');
      const status = await setAgentPreference(id.admin._id, String(payload.status || '').toUpperCase());
      reply(ack, { ok: true, status });
    } catch (err) { fail(ack, err); }
  });

  socket.on('disconnect', async () => {
    if (identity?.kind === 'agent' && agentSocketDisconnected(identity.admin._id, socket.id)) {
      touchAgent(identity.admin._id);
      await broadcastAgentStatus();
    }
  });
};

// Exported for tests.
export { chatRoleFromToken, CHAT_STATUS };
