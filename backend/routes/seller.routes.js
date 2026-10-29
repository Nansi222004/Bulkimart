import { initiateQuickShiprocketFee, verifyQuickShiprocketFee, getQuickShiprocketFee } from '../controllers/quickShiprocketFee.controller.js';
import { getProfile, updateProfile } from '../controllers/user.controller.js';
import express from 'express';
import { getPickupStatus, retryPickupSync } from '../controllers/sellerPickup.controller.js';
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
  requestWholesaleChannel,
  getSellerFaqs,
  answerSellerFaq
} from '../controllers/seller.controller.js';
import { listSellerReturns, getSellerReturn, sellerDecideReturnCtrl, assignRiderForReturn, sellerConfirmReturnReceived, selectReturnPickup, refreshReturnCourier, cancelReturnPickup, getReturnPickupOptions } from '../controllers/return.controller.js';
import {
  getFulfillmentOptions, selectManualFulfillment, createShiprocketShipment,
} from '../controllers/fulfillment.controller.js';
import { protect, requireSellerSession } from '../middlewares/auth.middleware.js';
import { requireApprovedSeller } from '../middlewares/vendor.middleware.js';
import { getSellerOrderInvoice } from '../controllers/taxInvoice.controller.js';
import {
  getSellerFinanceSummary, listSellerLedger, getSellerOrderFinance, requestSellerPayout, getSellerTaxStatement,
} from '../controllers/sellerFinance.controller.js';
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
router.use(protect, requireSellerSession);
router.get('/account-profile', getProfile);
router.put('/account-profile', uploadSingle('avatar'), updateProfile);

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
router.get('/pickup-sync', getPickupStatus);
router.post('/pickup-sync/retry', retryPickupSync);

router.put('/profile', uploadFields([
  { name: 'logo', maxCount: 1 },
  { name: 'banner', maxCount: 1 }
]), updateStoreProfile);

// ---------------------------------------------------------------------------
// SELLER PANEL — approved sellers only.
// Everything above this line is onboarding and stays open to any signed-in user,
// otherwise they could never complete registration or check their own status.
// ---------------------------------------------------------------------------
router.post('/shiprocket-fees/verify', requireApprovedSeller, verifyQuickShiprocketFee);
router.get('/orders/:id/shiprocket-fee', requireApprovedSeller, getQuickShiprocketFee);
router.post('/orders/:id/shiprocket-fee', requireApprovedSeller, initiateQuickShiprocketFee);
router.get('/dashboard', requireApprovedSeller, getDashboard);
router.get('/orders', requireApprovedSeller, getSellerOrders);
router.get('/orders/:id', requireApprovedSeller, getSellerOrders);
router.patch('/orders/:id/status', requireApprovedSeller, updateOrderStatus);
router.get('/orders/:id/fulfillment-options', requireApprovedSeller, getFulfillmentOptions);
router.post('/orders/:id/fulfillment/manual', requireApprovedSeller, selectManualFulfillment);
router.post('/orders/:id/fulfillment/shiprocket', requireApprovedSeller, createShiprocketShipment);
router.get('/orders/:id/financial-breakdown', requireApprovedSeller, getSellerOrderFinance);
router.get('/orders/:id/invoice', requireApprovedSeller, getSellerOrderInvoice);
router.get('/finances/summary', requireApprovedSeller, getSellerFinanceSummary);
router.get('/finances/ledger', requireApprovedSeller, listSellerLedger);
router.get('/finances/tax-statement', requireApprovedSeller, getSellerTaxStatement);
router.post('/payouts', requireApprovedSeller, requestSellerPayout);
router.patch('/channels', requireApprovedSeller, updateSalesChannels);
router.post('/wholesale-request', requireApprovedSeller, requestWholesaleChannel);
router.get('/faqs', requireApprovedSeller, getSellerFaqs);
router.patch('/faqs/:faqId/answer', requireApprovedSeller, answerSellerFaq);

// ---- Packaging Material -------------------------------------------------
// Registered before /packaging/packages/:id so "orders" is never parsed as an id.

// ---- Return & Refund — read-only visibility (Phase 4) -------------------
router.get('/returns', requireApprovedSeller, listSellerReturns);
router.get('/returns/:returnId/pickup-options', requireApprovedSeller, getReturnPickupOptions);
router.get('/returns/:returnId', requireApprovedSeller, getSellerReturn);
router.post('/returns/:returnId/decision', requireApprovedSeller, sellerDecideReturnCtrl);
// Quick Commerce reverse pickup — Seller triggers/confirms these two steps;
// every other transition stays Admin-only (services/return.service.js).
router.post('/returns/:returnId/assign-rider', requireApprovedSeller, assignRiderForReturn);
router.post('/returns/:returnId/pickup', requireApprovedSeller, selectReturnPickup);
router.post('/returns/:returnId/pickup/refresh', requireApprovedSeller, refreshReturnCourier);
router.post('/returns/:returnId/pickup/cancel', requireApprovedSeller, cancelReturnPickup);
router.post('/returns/:returnId/mark-received', requireApprovedSeller, sellerConfirmReturnReceived);

export default router;
