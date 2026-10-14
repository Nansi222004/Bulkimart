import express from 'express';
import { shiprocketWebhook } from '../controllers/fulfillment.controller.js';

const router = express.Router();
router.post('/webhook', shiprocketWebhook);
export default router;
