import express from 'express';
import {
  getCategories,
  getCategoryTree,
  getGroceryCategories,
  getSelectableCategories,
  getCategoryStats,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory
} from '../controllers/category.controller.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { uploadFields } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Public routes
router.get('/', getCategories);
router.get('/tree', getCategoryTree);
router.get('/grocery', getGroceryCategories);
// leaves only, with full paths — used by the vendor product form
router.get('/selectable', getSelectableCategories);
// per-section counts for the Shop All / Quick badges
router.get('/stats', getCategoryStats);
router.get('/:id', getCategoryById);

// Admin-only category modifications
router.post('/', protect, requireAdmin, uploadFields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 }
]), createCategory);

router.put('/:id', protect, requireAdmin, uploadFields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 }
]), updateCategory);

router.delete('/:id', protect, requireAdmin, deleteCategory);

export default router;
