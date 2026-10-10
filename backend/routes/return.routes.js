import express from 'express';
import { createReturn, listMyReturns, getMyReturn } from '../controllers/return.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadMultiple } from '../middlewares/upload.middleware.js';
import { RETURN_MAX_ATTACHMENTS } from '../constants/enums.js';

const router = express.Router();

router.use(protect);

router.post('/', uploadMultiple('attachments', RETURN_MAX_ATTACHMENTS), createReturn);
router.get('/', listMyReturns);
router.get('/:id', getMyReturn);

export default router;
