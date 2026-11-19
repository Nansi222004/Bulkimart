import { asyncHandler } from '../middlewares/error.middleware.js';
import { ok } from '../utils/response.js';
import {
  riderWalletView, submitRiderCashPayment, approveRiderCashPayment, rejectRiderCashPayment,
  ridersOwing, listRiderCashPayments, riderWalletAdminDetail,
} from '../services/riderWallet.service.js';

// ---------------------------------------------------------------- rider (/api/delivery/wallet)
export const getMyWallet = asyncHandler(async (req, res) => ok(res, await riderWalletView(req.partner._id)));

// POST { amount (₹), method: 'upi'|'cash', reference, note? }
export const payMyWallet = asyncHandler(async (req, res) =>
  ok(res, await submitRiderCashPayment(req.partner, req.user._id, req.body || {}), 'Payment sent for approval'));

// ---------------------------------------------------------------- admin (/api/admin/rider-wallets, finance permission)
export const listRidersOwingAdmin = asyncHandler(async (req, res) => ok(res, await ridersOwing(req.query)));
export const listRiderCashPaymentsAdmin = asyncHandler(async (req, res) => ok(res, await listRiderCashPayments(req.query)));
export const riderWalletDetailAdmin = asyncHandler(async (req, res) => ok(res, await riderWalletAdminDetail(req.params.partnerId)));
export const approveRiderCashPaymentAdmin = asyncHandler(async (req, res) =>
  ok(res, await approveRiderCashPayment(req.params.id, req.user._id, req.body || {}), 'Payment approved and added to the rider wallet'));
export const rejectRiderCashPaymentAdmin = asyncHandler(async (req, res) =>
  ok(res, await rejectRiderCashPayment(req.params.id, req.user._id, req.body || {}), 'Payment rejected'));
