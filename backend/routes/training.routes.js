import { Router } from 'express';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { uploadTrainingVideoFile } from '../middlewares/upload.middleware.js';
import {
  adminListTrainingVideos, createTrainingVideo, deleteTrainingVideo, listTrainingVideos,
  updateTrainingVideo, uploadTrainingVideo,
} from '../controllers/training.controller.js';

// Seller and rider apps: GET /api/training/seller | /api/training/delivery
export const trainingRouter = Router();
trainingRouter.get('/:audience', protect, listTrainingVideos);

// Admin panel: /api/admin/training-videos
export const adminTrainingRouter = Router();
adminTrainingRouter.use(protect, requireAdmin);
adminTrainingRouter.get('/', adminListTrainingVideos);
adminTrainingRouter.post('/upload', uploadTrainingVideoFile, uploadTrainingVideo);
adminTrainingRouter.post('/', createTrainingVideo);
adminTrainingRouter.patch('/:id', updateTrainingVideo);
adminTrainingRouter.delete('/:id', deleteTrainingVideo);
