import express from 'express';
import {
  getTicketCategories, createTicket, listMyTickets, getTicketDetail,
  addRequesterMessage, reopenTicket,
} from '../controllers/ticket.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadMultiple } from '../middlewares/upload.middleware.js';
import { TICKET_MAX_ATTACHMENTS } from '../constants/enums.js';

const router = express.Router();

router.use(protect);

router.get('/categories', getTicketCategories);
router.post('/', uploadMultiple('attachments', TICKET_MAX_ATTACHMENTS), createTicket);
router.get('/', listMyTickets);
router.get('/:id', getTicketDetail);
router.post('/:id/messages', uploadMultiple('attachments', TICKET_MAX_ATTACHMENTS), addRequesterMessage);
router.post('/:id/reopen', reopenTicket);

export default router;
