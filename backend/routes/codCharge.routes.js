import express from 'express';
import { getCodChargePublic } from '../controllers/codCharge.controller.js';

const router = express.Router();
router.get('/', getCodChargePublic);
export default router;
