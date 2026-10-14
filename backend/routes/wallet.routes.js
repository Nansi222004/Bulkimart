import express from "express";
import { protect, requireAdmin } from "../middlewares/auth.middleware.js";
import {
  getMyWallet,
  getMyWalletTransactions,
  devQuickTopup,
  adminGetOverview,
  adminGetUserWallets,
  adminGetUserWalletDetail,
  adminGetAllTransactions,
  adminCreditUser,
  adminDebitUser,
} from "../controllers/wallet.controller.js";

const router = express.Router();

// ============================================================================
// CUSTOMER WALLET ROUTES & TOP-UP
// ============================================================================
router.get("/", protect, getMyWallet);
router.get("/transactions", protect, getMyWalletTransactions);
router.post("/dev-topup", protect, devQuickTopup);

// ============================================================================
// ADMIN WALLET ROUTES (Protected - Admin Only)
// ============================================================================
router.get("/admin/overview", protect, requireAdmin, adminGetOverview);
router.get("/admin/users", protect, requireAdmin, adminGetUserWallets);
router.get("/admin/users/:userId", protect, requireAdmin, adminGetUserWalletDetail);
router.get("/admin/users/:userId/transactions", protect, requireAdmin, adminGetUserWalletDetail);
router.get("/admin/transactions", protect, requireAdmin, adminGetAllTransactions);
router.post("/admin/users/:userId/credit", protect, requireAdmin, adminCreditUser);
router.post("/admin/users/:userId/debit", protect, requireAdmin, adminDebitUser);

export default router;
