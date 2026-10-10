import express from "express";
import {
  getActivePlans,
  selectPlan,
  submitNhcApplication,
  getSellerNhcApplication,
  getAdminPlans,
  createAdminPlan,
  updateAdminPlan,
  toggleAdminPlanStatus,
  getAdminNhcApplications,
  getAdminNhcApplicationDetail,
  approveNhcApplication,
  rejectNhcApplication,
} from "../controllers/nhc.controller.js";
import { protect, requireAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();

/* ============================================================================
 * PUBLIC / SELLER ROUTES
 * ========================================================================== */

// Public / Seller: Fetch active NHC plans
router.get("/plans", getActivePlans);

// Seller: Plan selection, submit & application status
router.post("/seller/select-plan", protect, selectPlan);
router.post("/seller/submit-application", protect, submitNhcApplication);
router.get("/seller/application", protect, getSellerNhcApplication);

/* ============================================================================
 * ADMIN ROUTES
 * ========================================================================== */

// Admin: Manage NHC Plans
router.get("/admin/plans", protect, requireAdmin, getAdminPlans);
router.post("/admin/plans", protect, requireAdmin, createAdminPlan);
router.patch("/admin/plans/:id", protect, requireAdmin, updateAdminPlan);
router.patch("/admin/plans/:id/status", protect, requireAdmin, toggleAdminPlanStatus);

// Admin: Manage NHC Seller Applications
router.get("/admin/seller-applications", protect, requireAdmin, getAdminNhcApplications);
router.get("/admin/seller-applications/:id", protect, requireAdmin, getAdminNhcApplicationDetail);
router.patch("/admin/seller-applications/:id/approve", protect, requireAdmin, approveNhcApplication);
router.patch("/admin/seller-applications/:id/reject", protect, requireAdmin, rejectNhcApplication);

export default router;
