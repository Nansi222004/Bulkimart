import express from 'express';
import { wholesalePublicLimiter, wholesaleCustomerLimiter } from '../middlewares/rateLimit.middleware.js';
import { imageSearchRouter } from './imageSearch.routes.js';
import {
  getProducts,
  getFeaturedProducts,
  getGroceryProducts,
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
  getCategoryReturnPolicyForSeller,
  updateProductWholesalePricing,
  getWholesaleCatalog,
  getWholesaleAvailability,
  previewWholesaleProduct,
  uploadDigitalProductFile,
} from '../controllers/product.controller.js';
import { protect, requireRole, requireCustomerSession, requireSellerSession } from '../middlewares/auth.middleware.js';
import { requireApprovedSeller } from '../middlewares/vendor.middleware.js';
import { downloadBulkTemplate, processBulkUpload } from '../controllers/bulkProduct.controller.js';
import { uploadProductImages, uploadBulkFiles } from '../middlewares/upload.middleware.js';
import { uploadEbookFile } from '../middlewares/ebookUpload.middleware.js';

const router = express.Router();
router.use('/search-by-image', imageSearchRouter());

// Bulk Product Upload & Template routes (declared before /:id)
router.get('/bulk/template', protect, requireRole('seller', 'admin'), downloadBulkTemplate);
router.post('/bulk/upload', protect, requireRole('seller', 'admin'), requireSellerSession, requireApprovedSeller, uploadBulkFiles, processBulkUpload);

// Public routes
router.get('/', getProducts);
router.get('/featured', getFeaturedProducts);
router.get('/grocery', getGroceryProducts);
router.get('/search', searchProducts);

// Public read-only catalog; quotes and purchases require a customer session.
router.get('/wholesale/availability', wholesalePublicLimiter, getWholesaleAvailability);
router.get('/wholesale/catalog', wholesalePublicLimiter, getWholesaleCatalog);
router.post('/wholesale/quote', protect, requireCustomerSession, wholesaleCustomerLimiter, previewWholesaleProduct);

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

// Keep this fixed path above /:id: Express otherwise treats "seller" as a
// product id and the seller's own listing request fails with a CastError.
router.get('/seller/mine', protect, requireRole('seller'), getMyProducts);

// Which of a given list this shopper already reviewed — a delivered-order
// screen's "Rate & Review" vs "already submitted" badge reads this, never
// local state alone, so it survives a refresh and a reorder of the same
// product. Two path segments, so this can never be mistaken for `/:id`.
router.get('/reviews/mine', protect, getMyReviewedProductIds);

// Quick Commerce only — read-only, for the Seller create/edit form's
// "Category Return Window" display. Declared before `/:id` for the same
// reason as `/reviews/mine` above: Express would otherwise treat
// "category-return-policy" as an `:id`.
router.get('/category-return-policy', protect, requireRole('seller'), getCategoryReturnPolicyForSeller);

// Seller-owned, terms-only write; never accepts retail price or stock fields.
router.patch('/:id/wholesale-pricing', protect, requireRole('seller'), requireSellerSession, requireApprovedSeller, updateProductWholesalePricing);

router.get('/:id', getProductById);
// Actual e-book bytes use private local storage, never the image CDN.
router.post('/:id/digital-file', protect, requireRole('seller'), requireApprovedSeller, uploadEbookFile('file'), uploadDigitalProductFile);
// Public: approved reviews + the star breakdown a product page renders.
router.get('/:id/reviews', getProductReviews);
// Public: answered Q&A only — an unanswered question isn't public yet.
router.get('/:id/faqs', getProductFaqs);

// Protected routes
router.post('/', protect, requireRole('seller'), requireSellerSession, requireApprovedSeller, uploadProductImages('images', 5), createProduct);
router.put('/:id', protect, requireRole('seller', 'admin'), requireSellerSession, requireApprovedSeller, uploadProductImages('images', 5), updateProduct);
router.patch('/:id/channels', protect, requireRole('seller', 'admin'), requireSellerSession, requireApprovedSeller, updateProductChannelStatus);
router.patch('/:id/stock', protect, requireRole('seller', 'admin'), requireSellerSession, requireApprovedSeller, adjustProductStock);
router.delete('/:id', protect, requireRole('seller', 'admin'), deleteProduct);

router.post('/:id/reviews', protect, addProductReview);
router.post('/:id/faqs', protect, askProductQuestion);

export default router;
