import express from 'express';
import {
  getAvailability, getCategories, listMyConversations, startChat, getMyConversation,
  getMyMessages, getMyMessage, postMyMessage, readMyConversation, closeMyConversation, reopenMyConversation,
} from '../controllers/supportChat.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadMultiple } from '../middlewares/upload.middleware.js';
import { supportChatStartLimiter, supportChatMessageLimiter } from '../middlewares/rateLimit.middleware.js';
import { CHAT_MAX_ATTACHMENTS } from '../constants/enums.js';

/**
 * Live chat for customers, sellers and delivery partners (/api/support-chat).
 * The chat role comes from the session token; agents use /api/admin/support-chat.
 */
const router = express.Router();

router.use(protect, (req, res, next) => {
  if (req.userType !== 'user') return res.status(403).json({ success: false, data: null, message: 'Admins use the support dashboard.', meta: {} });
  next();
});

router.get('/availability', getAvailability);
router.get('/categories', getCategories);
router.get('/conversations', listMyConversations);
router.post('/conversations', supportChatStartLimiter, uploadMultiple('attachments', CHAT_MAX_ATTACHMENTS), startChat);
router.get('/conversations/:id', getMyConversation);
router.get('/conversations/:id/messages', getMyMessages);
router.get('/conversations/:id/messages/:messageId', getMyMessage);
router.post('/conversations/:id/messages', supportChatMessageLimiter, uploadMultiple('attachments', CHAT_MAX_ATTACHMENTS), postMyMessage);
router.post('/conversations/:id/read', readMyConversation);
router.post('/conversations/:id/close', closeMyConversation);
router.post('/conversations/:id/reopen', reopenMyConversation);

export default router;
