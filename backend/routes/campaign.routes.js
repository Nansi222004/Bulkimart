import express from 'express';
import { getActiveCampaignsPublic, getCampaignPublic, getCampaignProductsPublic } from '../controllers/campaign.controller.js';

const router = express.Router();

router.get('/', getActiveCampaignsPublic);
router.get('/:id', getCampaignPublic);
router.get('/:id/products', getCampaignProductsPublic);

export default router;
