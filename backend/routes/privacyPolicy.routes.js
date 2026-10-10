import express from "express";
import {
  getAllPolicies,
  getPolicyByRole,
  getPolicyBySlug,
  updatePolicy,
} from "../controllers/privacyPolicyController.js";
import { protect, requireAdmin } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Public routes for fetching privacy policies
router.get("/", getAllPolicies);
router.get("/role/:roleKey", getPolicyByRole);

// Specific role route aliases requested with distinct names
router.get("/user-policy", (req, res) => {
  req.params.slug = "user-policy";
  return getPolicyBySlug(req, res);
});

router.get("/seller-policy", (req, res) => {
  req.params.slug = "seller-policy";
  return getPolicyBySlug(req, res);
});

router.get("/delivery-policy", (req, res) => {
  req.params.slug = "delivery-policy";
  return getPolicyBySlug(req, res);
});

router.get("/shg-policy", (req, res) => {
  req.params.slug = "shg-policy";
  return getPolicyBySlug(req, res);
});

// Dynamic slug catch-all
router.get("/:slug", getPolicyBySlug);

// Admin update routes (Protected)
router.put("/admin/:identifier", protect, requireAdmin, updatePolicy);

export default router;
