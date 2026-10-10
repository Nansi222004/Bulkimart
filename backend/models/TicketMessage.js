import mongoose from 'mongoose';
import { ticketAttachmentSchema } from './Ticket.js';

const { Schema, model } = mongoose;

/**
 * The real conversation for a Ticket — every requester message, every admin
 * reply, every internal note is one row here, in chronological order.
 * `Ticket.reply` (a single legacy string) is not used as the conversation;
 * it's kept only so the original /resolve endpoint keeps working unchanged.
 */
const ticketMessageSchema = new Schema({
  ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },

  senderId:   { type: Schema.Types.ObjectId, required: true }, // User._id or Admin._id
  senderRole: { type: String, required: true }, // 'customer' | 'seller' | 'shg' | 'delivery' | 'admin'
  senderName: { type: String, required: true },

  message: { type: String, required: true },
  attachments: [ticketAttachmentSchema],

  // Admin-only internal note — never returned by any requester-facing API.
  isInternal: { type: Boolean, default: false },
}, { timestamps: true });

ticketMessageSchema.index({ ticketId: 1, createdAt: 1 });

const TicketMessage = model('TicketMessage', ticketMessageSchema);
export default TicketMessage;
