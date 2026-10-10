import express from 'express';
import {
  startSHGOnboarding,
  submitSHGStep1,
  submitSHGStep2,
  submitSHGStep3,
  submitSHGStep4,
  submitSHGStep5,
  submitSHGApplication,
  getMySHGProfile,
  getSHGDashboard,
  getSHGMembers,
  addSHGMember,
  deleteSHGMember,
  getSHGOrders,
  updateSHGOrderStatus
} from '../controllers/shg.controller.js';
import { protect } from '../middlewares/auth.middleware.js';
import { requireApprovedSHG } from '../middlewares/vendor.middleware.js';
import { uploadFields, uploadSingle } from '../middlewares/upload.middleware.js';

const router = Router();
function Router() {
  return express.Router();
}

// Apply auth to all SHG routes
router.use(protect);

router.post('/start', startSHGOnboarding);
router.put('/step/1', submitSHGStep1);

router.put('/step/2', uploadFields([
  { name: 'leaderAadhaarFront', maxCount: 1 },
  { name: 'leaderAadhaarBack', maxCount: 1 }
]), submitSHGStep2);

router.put('/step/3', uploadFields([
  { name: 'shgCert', maxCount: 1 },
  { name: 'nrlmCert', maxCount: 1 }
]), submitSHGStep3);

router.put('/step/4', uploadSingle('passbook'), submitSHGStep4);

router.put('/step/5', submitSHGStep5);

router.post('/submit', submitSHGApplication);
router.get('/me', getMySHGProfile);

// ---------------------------------------------------------------------------
// SHG PANEL — approved SHG stores only. Onboarding routes above stay open.
// ---------------------------------------------------------------------------
router.get('/dashboard', requireApprovedSHG, getSHGDashboard);
router.get('/orders', requireApprovedSHG, getSHGOrders);
router.patch('/orders/:id/status', requireApprovedSHG, updateSHGOrderStatus);

router.route('/members')
  .get(requireApprovedSHG, getSHGMembers)
  .post(requireApprovedSHG, addSHGMember);

router.delete('/members/:memberId', requireApprovedSHG, deleteSHGMember);

export default router;
