import express from 'express';
import {
  startOnboarding,
  submitStep1,
  submitStep2,
  submitStep3,
  submitStep4,
  submitApplication,
  getMySellerProfile,
  updateStoreProfile,
  getDashboard,
  getSellerOrders,
  updateOrderStatus,
  updateSalesChannels,
  requestBrand,
  requestPromo,
  getSellerFaqs,
  answerSellerFaq
} from '../controllers/seller.controller.js';
import {
  listCampaignsForSeller, getCampaignForSeller, acceptCampaignParticipation, rejectCampaignParticipation,
} from '../controllers/campaign.controller.js';
import {
  listActivePromotionPackages, listMyPromotions, getMyPromotionDetail, createPromotion, updatePromotion,
  submitPromotion, resubmitPromotion, cancelPromotion, initiatePromotionPayment,
} from '../controllers/sellerPromotion.controller.js';
import {
  listPackagingMaterialsForSeller, listPackagingPackagesForSeller, getPackagingPackageForSeller,
  createPackageOrder, createBulkOrder, listMyPackagingOrders, getMyPackagingOrder,
} from '../controllers/packaging.controller.js';
import { listSellerReturns, assignRiderForReturn, sellerConfirmReturnReceived } from '../controllers/return.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { requireApprovedSeller } from '../middlewares/vendor.middleware.js';
import { uploadFields, uploadSingle } from '../middlewares/upload.middleware.js';
import Seller from '../models/Seller.js';

const router = express.Router();

// Public store details for checkout & order tracking
router.get('/public/:id', async (req, res) => {
  try {
    const s = await Seller.findById(req.params.id).populate('userId', 'phone name').lean();
    if (!s) {
      return res.status(404).json({ success: false, message: 'Seller not found' });
    }
    const name = s.storeDetails?.name || s.businessName || 'Local Partner Store';
    const phone = s.storeDetails?.phone || s.userId?.phone || '';
    const addressParts = [
      s.storeDetails?.address,
      s.storeDetails?.city,
      s.storeDetails?.state,
      s.storeDetails?.pincode,
    ].filter(Boolean);
    const address = addressParts.length > 0 ? addressParts.join(', ') : (s.storeDetails?.city || '');
    return res.json({
      success: true,
      data: {
        _id: s._id,
        name,
        phone,
        address,
        city: s.storeDetails?.city || '',
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// Apply auth to all subsequent seller routes
router.use(protect);

router.post('/start', startOnboarding);
router.put('/step/1', submitStep1);

router.put('/step/2', uploadFields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 }
]), submitStep2);

router.put('/step/3', uploadSingle('passbookUrl'), submitStep3);

router.put('/step/4', uploadFields([
  { name: 'gstin_cert', maxCount: 1 },
  { name: 'trade_license', maxCount: 1 },
  { name: 'pan_card', maxCount: 1 },
  { name: 'fssai_cert', maxCount: 1 }
]), submitStep4);

router.post('/submit', submitApplication);
router.get('/me', getMySellerProfile);

router.put('/profile', uploadFields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]), updateStoreProfile);

// ---------------------------------------------------------------------------
// SELLER PANEL — approved sellers only.
// Everything above this line is onboarding and stays open to any signed-in user,
// otherwise they could never complete registration or check their own status.
// ---------------------------------------------------------------------------
router.get('/dashboard', requireApprovedSeller, getDashboard);
router.get('/orders', requireApprovedSeller, getSellerOrders);
router.patch('/orders/:id/status', requireApprovedSeller, updateOrderStatus);
router.patch('/channels', requireApprovedSeller, updateSalesChannels);
router.post('/brand-request', requireApprovedSeller, requestBrand);
router.post('/promo-request', requireApprovedSeller, requestPromo);
router.get('/faqs', requireApprovedSeller, getSellerFaqs);
router.patch('/faqs/:faqId/answer', requireApprovedSeller, answerSellerFaq);

// ---- Campaigns / Deals ------------------------------------------------------
router.get('/campaigns', requireApprovedSeller, listCampaignsForSeller);
router.get('/campaigns/:id', requireApprovedSeller, getCampaignForSeller);
router.patch('/campaigns/:id/accept', requireApprovedSeller, acceptCampaignParticipation);
router.patch('/campaigns/:id/reject', requireApprovedSeller, rejectCampaignParticipation);

// ---- Promotions / Advertisement ---------------------------------------------
// Registered before /promotions/:id so "packages" is never parsed as an id.
router.get('/promotions/packages', requireApprovedSeller, listActivePromotionPackages);
router.get('/promotions', requireApprovedSeller, listMyPromotions);
router.post('/promotions', requireApprovedSeller, uploadSingle('bannerImage'), createPromotion);
router.get('/promotions/:id', requireApprovedSeller, getMyPromotionDetail);
router.put('/promotions/:id', requireApprovedSeller, uploadSingle('bannerImage'), updatePromotion);
router.post('/promotions/:id/submit', requireApprovedSeller, submitPromotion);
router.post('/promotions/:id/resubmit', requireApprovedSeller, resubmitPromotion);
router.post('/promotions/:id/cancel', requireApprovedSeller, cancelPromotion);
router.post('/promotions/:id/payment', requireApprovedSeller, initiatePromotionPayment);

// ---- Packaging Material -------------------------------------------------
// Registered before /packaging/packages/:id so "orders" is never parsed as an id.
router.get('/packaging/materials', requireApprovedSeller, listPackagingMaterialsForSeller);
router.get('/packaging/packages', requireApprovedSeller, listPackagingPackagesForSeller);
router.get('/packaging/packages/:id', requireApprovedSeller, getPackagingPackageForSeller);
router.post('/packaging/orders/package', requireApprovedSeller, createPackageOrder);
router.post('/packaging/orders/bulk', requireApprovedSeller, createBulkOrder);
router.get('/packaging/orders', requireApprovedSeller, listMyPackagingOrders);
router.get('/packaging/orders/:id', requireApprovedSeller, getMyPackagingOrder);

// ---- Return & Refund — read-only visibility (Phase 4) -------------------
router.get('/returns', requireApprovedSeller, listSellerReturns);
// Quick Commerce reverse pickup — Seller triggers/confirms these two steps;
// every other transition stays Admin-only (services/return.service.js).
router.post('/returns/:returnId/assign-rider', requireApprovedSeller, assignRiderForReturn);
router.post('/returns/:returnId/mark-received', requireApprovedSeller, sellerConfirmReturnReceived);

export default router;
