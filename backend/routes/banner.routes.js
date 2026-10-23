import express from 'express';
import {
  getBanners,
  clickBanner,
  createBanner,
  updateBanner,
  deleteBanner
} from '../controllers/banner.controller.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { marketingPermission } from '../services/storefrontPolicy.service.js';
import { uploadBannerImage } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Public routes to fetch active banners / record a click
router.get('/', (req, res, next) => req.query.all === 'true' ? protect(req, res, next) : next(),
  (req, res, next) => req.query.all === 'true' ? requireAdmin(req, res, next) : next(),
  (req, res, next) => req.query.all === 'true' ? marketingPermission(req, res, next) : next(), getBanners);
router.post('/:id/click', clickBanner);

// Protected admin routes to manage banners
router.use(protect, requireAdmin, marketingPermission);
router.post('/', uploadBannerImage, createBanner);
router.put('/:id', uploadBannerImage, updateBanner);
router.delete('/:id', deleteBanner);

export default router;
