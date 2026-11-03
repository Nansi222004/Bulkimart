import mongoose from 'mongoose';
import { CHAT_USER_ROLES, CHAT_STATUSES, CHAT_STATUS } from '../constants/enums.js';

const { Schema, model } = mongoose;

/**
 * One live support chat between a requester (customer, seller or delivery
 * partner — always the base User identity, like Ticket) and Bulkimart support
 * agents (Admin documents). Messages live in ChatMessage.
 *
 * `userRole` is decided by the server from the signed session (never from the
 * request) and fixes which app may see the chat: a seller chat is invisible to
 * the same person's customer session, and the other way round.
 */
const chatConversationSchema = new Schema({
  conversationNumber: { type: String, required: true, unique: true }, // display reference, e.g. CHAT-48213

  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  userRole: { type: String, enum: CHAT_USER_ROLES, required: true },
  userName: { type: String, required: true },
  vendorId: { type: Schema.Types.ObjectId }, // Seller._id or DeliveryPartner._id for those roles

  status: { type: String, enum: CHAT_STATUSES, default: CHAT_STATUS.WAITING },
  // true while WAITING or ACTIVE — backs the "one open chat per user and role" unique index.
  isOpen: { type: Boolean, default: true },

  supportCategory: { type: String, required: true },
  relatedOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  relatedDeliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery' },
  relatedTicketId: { type: Schema.Types.ObjectId, ref: 'Ticket' },

  assignedAdminId: { type: Schema.Types.ObjectId, ref: 'Admin' },
  assignedAdminName: { type: String },
  acceptedAt: Date,

  // When the chat (re)entered the waiting queue — queue order and position.
  queuedAt: { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now },
  lastMessagePreview: { type: String, default: '' },
  lastMessageSenderRole: String,

  // Unread counters, kept in step with ChatMessage.readAt by the service.
  unreadForUser: { type: Number, default: 0 },
  unreadForAgent: { type: Number, default: 0 },

  resolvedAt: Date,
  closedAt: Date,
  closedBy: { type: String, enum: ['USER', 'AGENT'] },
  reopenCount: { type: Number, default: 0 },
}, { timestamps: true });

chatConversationSchema.virtual('conversationId').get(function () { return this._id; });
chatConversationSchema.set('toJSON', { virtuals: true });
chatConversationSchema.set('toObject', { virtuals: true });

chatConversationSchema.index(
  { userId: 1, userRole: 1, isOpen: 1 },
  { unique: true, partialFilterExpression: { isOpen: true }, name: 'chat_one_open_per_user_role' },
);
chatConversationSchema.index({ userId: 1, userRole: 1, lastMessageAt: -1 });
chatConversationSchema.index({ status: 1, lastMessageAt: -1 });
chatConversationSchema.index({ status: 1, queuedAt: 1 }); // waiting queue order
chatConversationSchema.index({ assignedAdminId: 1, status: 1 });
chatConversationSchema.index({ relatedTicketId: 1 }, { sparse: true });

const ChatConversation = model('ChatConversation', chatConversationSchema);
export default ChatConversation;
