import Ticket from '../models/Ticket.js';
import TicketMessage from '../models/TicketMessage.js';
import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok, created, paginated, getPagination, httpError } from '../utils/response.js';
import { uploadFileWithMeta } from '../services/cloudinary.service.js';
import {
  resolveRequester, isValidCategory, assertRelatedEntitiesOwned,
  generateTicketNumber, assertRequesterTransition, loadOwnedTicket,
} from '../services/ticket.service.js';
import { notifyUser, notifyAllAdmins, NOTIFICATION_EVENT } from '../services/notification.service.js';
import { TICKET_STATUS, TICKET_MAX_ATTACHMENTS, TICKET_CATEGORIES_BY_ROLE } from '../constants/enums.js';

const uploadAttachments = async (files = []) => {
  if (!files.length) return [];
  if (files.length > TICKET_MAX_ATTACHMENTS) {
    throw httpError(400, `You can attach at most ${TICKET_MAX_ATTACHMENTS} files`);
  }
  const uploaded = [];
  for (const file of files) {
    const meta = await uploadFileWithMeta(file.buffer, 'support-tickets', {
      resource_type: file.mimetype === 'application/pdf' ? 'raw' : 'image',
    });
    uploaded.push({
      url: meta.url,
      publicId: meta.publicId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: meta.size,
      resourceType: meta.resourceType,
    });
  }
  return uploaded;
};

/**
 * Notifies the ticket's original requester. Always routed through
 * `notifyUser` (the requester's own userId) rather than notifySeller/
 * notifyShg/notifyRider — those exist to resolve a *vendor record id* down
 * to its owning User for a socket room; here the User is already known
 * directly (`Ticket.userId`), and DB persistence + FCM (the two reliable
 * channels) both work identically either way. The one thing this trades
 * away is the live 'notification_new' socket ping landing in a seller/shg/
 * rider-room-scoped dashboard instantly — it still arrives on that role's
 * next poll/open, so nothing is lost, only delayed slightly for that one
 * best-effort channel.
 */
export const notifyRequester = (ticket, opts) =>
  notifyUser(ticket.userId, opts).catch((e) => console.error('[TICKET] notify requester failed:', e.message));

// @desc    Which categories the caller may currently pick from — role is
//          derived entirely from the authenticated session
//          (req.tokenRole + live approval records), never from a query param.
// @route   GET /api/tickets/categories
// @access  Private
export const getTicketCategories = asyncHandler(async (req, res) => {
  const requester = await resolveRequester(req.user, req.tokenRole, req.query.role);
  ok(res, { role: requester.role, categories: TICKET_CATEGORIES_BY_ROLE[requester.role] });
});

// @desc    Create a support ticket.
// @route   POST /api/tickets
// @access  Private
export const createTicket = asyncHandler(async (req, res) => {
  const { category, subject, description, relatedOrder, relatedProduct, relatedDelivery, role: bodyRole } = req.body;

  if (!subject || !subject.trim()) throw httpError(400, 'Subject is required');
  if (!description || !description.trim()) throw httpError(400, 'Description is required');

  const requester = await resolveRequester(req.user, req.tokenRole, bodyRole || req.query.role);

  if (!category || !isValidCategory(requester.role, category)) {
    throw httpError(400, `Invalid category for role "${requester.role}"`);
  }

  await assertRelatedEntitiesOwned(
    { role: requester.role, vendorId: requester.vendorId, user: req.user },
    { relatedOrder, relatedProduct, relatedDelivery }
  );

  const attachments = await uploadAttachments(req.files);
  const ticketNumber = await generateTicketNumber();

  const ticket = await Ticket.create({
    ticketNumber,
    userId: req.user._id,
    requesterRole: requester.role,
    userName: requester.name,
    userEmail: requester.email,
    subject: subject.trim(),
    description: description.trim(),
    category,
    status: TICKET_STATUS.OPEN,
    relatedOrder: relatedOrder || undefined,
    relatedProduct: relatedProduct || undefined,
    relatedDelivery: relatedDelivery || undefined,
  });

  await TicketMessage.create({
    ticketId: ticket._id,
    senderId: req.user._id,
    senderRole: requester.role,
    senderName: requester.name,
    message: description.trim(),
    attachments,
  });

  notifyAllAdmins({
    event: NOTIFICATION_EVENT.TICKET_CREATED,
    title: 'New support ticket',
    message: `${requester.name} (${requester.role}) opened ticket ${ticketNumber}: "${subject.trim()}"`,
    metadata: { ticketId: ticket._id },
    route: `/admin/tickets/${ticket._id}`,
  }).catch((e) => console.error('[TICKET] notify admins failed:', e.message));

  notifyUser(req.user._id, {
    event: NOTIFICATION_EVENT.TICKET_CREATED,
    title: 'Complaint Registered',
    message: `Your support ticket #${ticketNumber} ("${subject.trim()}") has been registered. Our team will review it shortly.`,
    metadata: { ticketId: ticket._id },
    route: `/support/tickets/${ticket._id}`,
  }).catch((e) => console.error('[TICKET] notify user failed:', e.message));

  created(res, ticket, `Ticket ${ticketNumber} created`);
});

// @desc    List the caller's own tickets.
// @route   GET /api/tickets
// @access  Private
export const listMyTickets = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, 20, 50);
  const requester = await resolveRequester(req.user, req.tokenRole, req.query.role);
  const filter = { userId: req.user._id, requesterRole: requester.role };
  if (req.query.status) filter.status = req.query.status;

  const [tickets, total] = await Promise.all([
    Ticket.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Ticket.countDocuments(filter),
  ]);

  // Last-message preview, one query for the whole page rather than N+1.
  const ids = tickets.map((t) => t._id);
  const lastMessages = await TicketMessage.aggregate([
    { $match: { ticketId: { $in: ids }, isInternal: false } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$ticketId', message: { $first: '$message' }, createdAt: { $first: '$createdAt' } } },
  ]);
  const previewByTicket = Object.fromEntries(lastMessages.map((m) => [String(m._id), m]));

  const withPreview = tickets.map((t) => ({ ...t, lastMessage: previewByTicket[String(t._id)] || null }));
  paginated(res, withPreview, { page, limit, total });
});

// @desc    Ticket detail + full non-internal conversation.
// @route   GET /api/tickets/:id
// @access  Private
export const getTicketDetail = asyncHandler(async (req, res) => {
  const ticket = await loadOwnedTicket(req.params.id, req.user._id);
  const messages = await TicketMessage.find({ ticketId: ticket._id, isInternal: false })
    .sort({ createdAt: 1 })
    .lean();
  ok(res, { ticket, messages });
});

// @desc    Requester reply. Auto-moves WAITING_FOR_USER -> IN_PROGRESS.
// @route   POST /api/tickets/:id/messages
// @access  Private
export const addRequesterMessage = asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) throw httpError(400, 'Message is required');

  const ticket = await loadOwnedTicket(req.params.id, req.user._id);
  const attachments = await uploadAttachments(req.files);

  const senderName = req.user.name || ticket.userName;
  const entry = await TicketMessage.create({
    ticketId: ticket._id,
    senderId: req.user._id,
    senderRole: ticket.requesterRole || 'customer',
    senderName,
    message: message.trim(),
    attachments,
  });

  if (ticket.status === TICKET_STATUS.WAITING_FOR_USER) {
    ticket.status = TICKET_STATUS.IN_PROGRESS;
    await ticket.save();
  }

  created(res, entry, 'Message sent');
});

// @desc    Requester reopens a RESOLVED ticket.
// @route   POST /api/tickets/:id/reopen
// @access  Private
export const reopenTicket = asyncHandler(async (req, res) => {
  const ticket = await loadOwnedTicket(req.params.id, req.user._id);
  assertRequesterTransition(ticket.status, TICKET_STATUS.REOPENED);

  ticket.status = TICKET_STATUS.REOPENED;
  await ticket.save();

  notifyRequester(ticket, {
    event: NOTIFICATION_EVENT.TICKET_REOPENED,
    title: 'Ticket reopened',
    message: `Your ticket ${ticket.ticketNumber || ticket._id} has been reopened.`,
    metadata: { ticketId: ticket._id },
    route: `/support/tickets/${ticket._id}`,
  });

  ok(res, ticket, 'Ticket reopened');
});
