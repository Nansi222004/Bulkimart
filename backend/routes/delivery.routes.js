import express from 'express';
import { listFinanceOrders, listFinanceLedger, getDeliveryFinance, collectCod, reportCodRemittance } from '../controllers/financeWorkflow.controller.js';
import {
  startOnboarding,
  submitStep1,
  submitStep2,
  submitStep3,
  submitApplication,
  getMyProfile,
  updateLocation,
  updateServiceArea,
  updatePresence,
  acceptOrder,
  declineOrder,
  expireOrder,
  cancelDelivery,
  updateDeliveryStatus,
  generateDeliveryOtp,
  verifyDeliveryOtp,
  toggleAvailability,
  getPendingDeliveryOrders,
  updateDeliveryLocation,
  getActiveDelivery,
  getRiderHistory,
  getEarningsSummary,
  requestPayout,
  getMyPayouts
} from '../controllers/deliveryPartner.controller.js';
import {
  listReturnPickups,
  acceptReturnPickupCtrl,
  declineReturnPickupCtrl,
  expireReturnPickupCtrl,
  generateReturnPickupOtpCtrl,
  verifyReturnPickupOtpCtrl,
  updateReturnPickupLocationCtrl,
  updateReturnPickupStageCtrl,
} from '../controllers/returnDelivery.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { uploadSingle, uploadFields } from '../middlewares/upload.middleware.js';
import { requireApprovedPartner } from '../middlewares/vendor.middleware.js';
import { deleteMyDeliveryAccount } from '../controllers/accountManagement.controller.js';

const router = express.Router();

router.use(protect);
router.delete('/account', deleteMyDeliveryAccount);
router.delete('/profile', deleteMyDeliveryAccount);

// ---------------------------------------------------------------------------
// ONBOARDING — open to any signed-in user, otherwise nobody could ever apply.
// ---------------------------------------------------------------------------
router.post('/start', startOnboarding);
router.get('/me', getMyProfile);

router.put('/step/1', uploadSingle('license'), submitStep1);
router.put('/step/2', uploadFields([
  { name: 'aadhaarFront', maxCount: 1 },
  { name: 'aadhaarBack', maxCount: 1 },
]), submitStep2);
router.put('/step/3', uploadSingle('passbook'), submitStep3);

router.put('/location', updateLocation);
router.put('/service-area', updateServiceArea);
router.put('/presence', updatePresence);
router.post('/submit', submitApplication);

// ---------------------------------------------------------------------------
// RIDER APP — approved partners only. Added as those features are built.
// ---------------------------------------------------------------------------
router.put('/availability', requireApprovedPartner, toggleAvailability);
// Restores a trip already in progress after a refresh.
router.get('/orders/active', requireApprovedPartner, getActiveDelivery);
router.get('/orders/pending', requireApprovedPartner, getPendingDeliveryOrders);
router.get('/orders/history', requireApprovedPartner, getRiderHistory);
router.get('/earnings/summary', requireApprovedPartner, getEarningsSummary);
router.post('/orders/:id/accept', requireApprovedPartner, acceptOrder);
router.post('/orders/:id/decline', requireApprovedPartner, declineOrder);
router.post('/orders/:id/expire', requireApprovedPartner, expireOrder);
router.post('/orders/:id/cancel', requireApprovedPartner, cancelDelivery);
router.put('/orders/:id/location', requireApprovedPartner, updateDeliveryLocation);
router.patch('/orders/:id/status', requireApprovedPartner, updateDeliveryStatus);
router.post('/orders/:id/generate-otp', requireApprovedPartner, generateDeliveryOtp);
router.post('/orders/:id/verify-otp', requireApprovedPartner, verifyDeliveryOtp);

router.post('/payouts', requireApprovedPartner, requestPayout);
router.get('/payouts', requireApprovedPartner, getMyPayouts);
router.get('/finances/cod', requireApprovedPartner, listFinanceOrders);
router.get('/finances/ledger', requireApprovedPartner, listFinanceLedger);
router.get('/finances/deliveries', requireApprovedPartner, getDeliveryFinance);
router.post('/orders/:id/cod/collect', requireApprovedPartner, collectCod);
router.post('/orders/:id/cod/remit', requireApprovedPartner, reportCodRemittance);

// ---------------------------------------------------------------------------
// QUICK COMMERCE REVERSE PICKUP — a Return's customer -> rider -> seller
// leg, same "approved partners only" gate as the forward-order routes above.
// ---------------------------------------------------------------------------
router.get('/return-pickups', requireApprovedPartner, listReturnPickups);
router.post('/return-pickups/:id/accept', requireApprovedPartner, acceptReturnPickupCtrl);
router.post('/return-pickups/:id/decline', requireApprovedPartner, declineReturnPickupCtrl);
router.post('/return-pickups/:id/expire', requireApprovedPartner, expireReturnPickupCtrl);
router.put('/return-pickups/:id/location', requireApprovedPartner, updateReturnPickupLocationCtrl);
router.patch('/return-pickups/:id/status', requireApprovedPartner, updateReturnPickupStageCtrl);
router.post('/return-pickups/:id/generate-otp', requireApprovedPartner, generateReturnPickupOtpCtrl);
router.post('/return-pickups/:id/verify-otp', requireApprovedPartner, verifyReturnPickupOtpCtrl);

export default router;
