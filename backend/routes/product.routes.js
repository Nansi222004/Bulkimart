import express from 'express';
import {
  getProducts,
  getFeaturedProducts,
  getGroceryProducts,
  getSHGProducts,
  getApprovedSHGStores,
  searchProducts,
  getProductById,
  createProduct,
  updateProduct,
  updateProductChannelStatus,
  adjustProductStock,
  deleteProduct,
  getMyProducts,
  addProductReview,
  getProductReviews,
  getMyReviewedProductIds,
  askProductQuestion,
  getProductFaqs,
  getDeliveryOptions,
  getProductDeliveryOptions,
  getCategoryReturnPolicyForSeller
} from '../controllers/product.controller.js';
import { protect, requireRole } from '../middlewares/auth.middleware.js';
import { downloadBulkTemplate, processBulkUpload } from '../controllers/bulkProduct.controller.js';
import { uploadMultiple, uploadBulkFiles } from '../middlewares/upload.middleware.js';

const router = express.Router();

// Bulk Product Upload & Template routes (declared before /:id)
router.get('/bulk/template', protect, requireRole('seller', 'shg', 'admin'), downloadBulkTemplate);
router.post('/bulk/upload', protect, requireRole('seller', 'shg', 'admin'), uploadBulkFiles, processBulkUpload);

// Public routes
router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/grocery', getGroceryProducts);
router.get('/shg/stores', getApprovedSHGStores);
router.get('/shg', getSHGProducts);
router.get('/search', searchProducts);

/**
 * What delivery is actually available, per product, for one address.
 *
 * Public, because a shopper has to see this before signing in — the answer
 * depends on where they are, not on who they are.
 *
 * A POST for a read: the batched form carries a list of ids and a destination,
 * which is more than a query string should hold for a full grid, and a verdict
 * expires the moment a cut-off passes or the last nearby rider goes offline, so
 * it must not sit in an HTTP cache.
 *
 * Declared before `/:id` for readability only — Express matches on the whole
 * path, so `/abc/delivery-options` could never be mistaken for `/:id` anyway.
 */
router.post('/delivery-options', getDeliveryOptions);
router.get('/:id/delivery-options', getProductDeliveryOptions);

// Which of a given list this shopper already reviewed — a delivered-order
// screen's "Rate & Review" vs "already submitted" badge reads this, never
// local state alone, so it survives a refresh and a reorder of the same
// product. Two path segments, so this can never be mistaken for `/:id`.
router.get('/reviews/mine', protect, getMyReviewedProductIds);

// Quick Commerce only — read-only, for the Seller create/edit form's
// "Category Return Window" display. Declared before `/:id` for the same
// reason as `/reviews/mine` above: Express would otherwise treat
// "category-return-policy" as an `:id`.
router.get('/category-return-policy', protect, requireRole('seller', 'shg'), getCategoryReturnPolicyForSeller);

router.get('/:id', getProductById);
// Public: approved reviews + the star breakdown a product page renders.
router.get('/:id/reviews', getProductReviews);
// Public: answered Q&A only — an unanswered question isn't public yet.
router.get('/:id/faqs', getProductFaqs);

// Protected routes
router.post('/', protect, requireRole('seller', 'shg'), uploadMultiple('images', 5), createProduct);
router.put('/:id', protect, requireRole('seller', 'shg', 'admin'), uploadMultiple('images', 5), updateProduct);
router.patch('/:id/channels', protect, requireRole('seller', 'shg', 'admin'), updateProductChannelStatus);
router.patch('/:id/stock', protect, requireRole('seller', 'shg', 'admin'), adjustProductStock);
router.delete('/:id', protect, requireRole('seller', 'shg', 'admin'), deleteProduct);

router.get('/seller/mine', protect, requireRole('seller', 'shg'), getMyProducts);
router.post('/:id/reviews', protect, addProductReview);
router.post('/:id/faqs', protect, askProductQuestion);

export default router;
