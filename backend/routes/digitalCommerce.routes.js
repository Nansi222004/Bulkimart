import express from 'express';
import { protect } from '../middlewares/auth.middleware.js';
import { createDigitalOrder, downloadDigitalBook, getDigitalLibrary } from '../controllers/digitalCommerce.controller.js';

const router = express.Router();
router.use(protect);
router.post('/checkout', createDigitalOrder);
router.get('/library', getDigitalLibrary);
router.get('/library/:entitlementId/download', downloadDigitalBook);

export default router;
