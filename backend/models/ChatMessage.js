import mongoose from 'mongoose';
import { ticketAttachmentSchema } from './Ticket.js';
import { CHAT_SENDER_ROLES } from '../constants/enums.js';

const { Schema, model } = mongoose;

/**
 * One message in a live chat. Persisted before anything is broadcast.
 * Attachments use the ticket attachment shape and the same private media
 * category ('support-tickets' → private), so files are only ever served
 * through short-lived signed URLs.
 */
const chatMessageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'ChatConversation', required: true },
  senderId: { type: Schema.Types.ObjectId }, // User._id, Admin._id; none for SYSTEM
  senderRole: { type: String, enum: CHAT_SENDER_ROLES, required: true },
  senderName: { type: String, default: '' },
  messageType: { type: String, enum: ['TEXT', 'ATTACHMENT', 'SYSTEM'], default: 'TEXT' },
  messageText: { type: String, default: '' },
  attachments: { type: [ticketAttachmentSchema], default: [] },
  // Client-generated id: a retried send returns the stored message instead of a duplicate.
  clientMessageId: { type: String },
  deliveredAt: Date,
  readAt: Date,
}, { timestamps: true });

chatMessageSchema.index({ conversationId: 1, createdAt: -1 });
chatMessageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } }, name: 'chat_message_client_id_unique' },
);

const ChatMessage = model('ChatMessage', chatMessageSchema);
export default ChatMessage;
