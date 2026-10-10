import express from 'express';
import { getTipSettingPublic } from '../controllers/tip.controller.js';

const router = express.Router();

router.get('/', getTipSettingPublic);

export default router;
