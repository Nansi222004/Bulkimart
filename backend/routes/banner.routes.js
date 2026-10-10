import express from 'express';
import {
  getBanners,
  clickBanner,
  createBanner,
  updateBanner,
  deleteBanner
} from '../controllers/banner.controller.js';
import { protect, requireRole } from '../middlewares/auth.middleware.js';
import { uploadSingle } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Public routes to fetch active banners / record a click
router.get('/', getBanners);
router.post('/:id/click', clickBanner);

// Protected admin routes to manage banners
router.use(protect, requireRole('admin'));
router.post('/', uploadSingle('image'), createBanner);
router.put('/:id', uploadSingle('image'), updateBanner);
router.delete('/:id', deleteBanner);

export default router;
