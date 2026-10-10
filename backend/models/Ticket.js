import mongoose from 'mongoose';
import { TICKET_STATUS, TICKET_REQUESTER_ROLES } from '../constants/enums.js';

const { Schema, model } = mongoose;

const attachmentSchema = new Schema({
  url:          { type: String, required: true },
  publicId:     String,
  fileName:     String,
  mimeType:     String,
  size:         Number,
  resourceType: String,
}, { _id: false });

/**
 * One common ticket model for every requester role — Customer, Seller, SHG,
 * Delivery Partner — deliberately not four separate models. `createdBy`
 * always points at the base User identity (the same "User is the base
 * identity" architecture the rest of the app uses); `requesterRole` records
 * which hat they were wearing when they filed it.
 *
 * Legacy fields (`userId`/`userName`/`userEmail`/`reply`/the old
 * 'Open'/'Resolved' status strings) are kept, not removed — this is the same
 * collection the original single-role ticket system wrote to, and Mongoose
 * doesn't validate on read, so those older documents keep loading exactly as
 * they always did. New code reads/writes `createdBy` (aliased from `userId`)
 * and the new fields; nothing deletes or rewrites old rows.
 */
const ticketSchema = new Schema({
  ticketNumber: { type: String, unique: true, sparse: true }, // e.g. "NHC-10234" — legacy rows have none

  // `userId` is the pre-existing field name; kept so nothing that already
  // queries/reads it breaks. New code should prefer `createdBy` below, which
  // is the same value — Mongoose alias, not a second copy.
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

  requesterRole: { type: String, enum: TICKET_REQUESTER_ROLES }, // absent on legacy rows
  userName:  { type: String, required: true }, // legacy name; new code also reads this as requesterName
  userEmail: { type: String },

  subject:     { type: String, required: true },
  description: { type: String, required: true },
  category:    { type: String }, // absent on legacy rows; validated against role at creation time

  // Legacy enum was ['Open', 'Resolved']; new tickets use the six-state
  // machine. Left permissive (no enum constraint) so an old row's exact
  // legacy string is never rejected by a future .save() on it either —
  // validity of NEW transitions is enforced in ticket.service.js, not here.
  status: { type: String, default: TICKET_STATUS.OPEN },

  relatedOrder:    { type: Schema.Types.ObjectId, ref: 'Order' },
  relatedProduct:  { type: Schema.Types.ObjectId, ref: 'Product' },
  relatedDelivery: { type: Schema.Types.ObjectId, ref: 'Delivery' },

  assignedAdmin: { type: Schema.Types.ObjectId, ref: 'Admin' },

  // Legacy one-shot admin reply field — still written by the original
  // /resolve endpoint for backward compatibility, but the real conversation
  // now lives in TicketMessage.
  reply: { type: String },

  resolvedAt: { type: Date },
  closedAt:   { type: Date },
}, { timestamps: true });

ticketSchema.virtual('createdBy').get(function () { return this.userId; }).set(function (v) { this.userId = v; });
ticketSchema.set('toJSON', { virtuals: true });
ticketSchema.set('toObject', { virtuals: true });

ticketSchema.index({ userId: 1, createdAt: -1 });
ticketSchema.index({ status: 1, createdAt: -1 });
ticketSchema.index({ requesterRole: 1, category: 1 });
ticketSchema.index({ assignedAdmin: 1 });

const Ticket = model('Ticket', ticketSchema);
export default Ticket;
export { attachmentSchema as ticketAttachmentSchema };
