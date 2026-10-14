import express from 'express';
import {
  listSellers, getSellerDetail, approveSeller, rejectSeller, suspendSeller, setSellerRadius, setSellerThirdPartyFulfillment, decideSellerWholesaleChannel, getWholesaleManagementSummary,
  vendorDashboard, getVendorOrdersAdmin, getVendorSalesAdmin, getVendorEarningsAdmin, getVendorPayoutsAdmin, settleVendorPayoutAdmin,
  listProducts, approveProduct, rejectProduct, featureProduct, sponsorProduct, deleteProductAdmin,
  listUsers, setUserStatus, getConsumerLocations,
  getPendingCounts,
  listDeliveryPartners,
  deliveryFleetStats, getDeliveryPartnerDetail, deliveryPerformanceStats, listDeliveryZones,
  approveDeliveryPartner, rejectDeliveryPartner, suspendDeliveryPartner, setDeliveryPartnerRadius,
  getDeliveryRates, setDeliveryRate, previewDeliveryRate, deliveryRateImpact,
  getDeliveryChargeSettingForAdmin, setDeliveryChargeSettingForAdmin,
  getRadiusSettingForAdmin, setRadiusSettingForAdmin,
  getDashboardOverview,
  getConsumerStats, getCustomerActivityLog, getCustomerOrders, getConsumerOrdersSummary,
  getCustomerReviews, deleteCustomerReview, updateReviewStatus,
  getTickets, resolveTicket, getTicketDetailAdmin, replyToTicket, addInternalNote,
  assignTicket, changeTicketStatus,
  getAdminNotifications, getAdminUnreadCount, markAdminNotificationRead, markAllAdminNotificationsRead,
  getDeliveryHistory,
  listRiderPayouts, settleRiderPayout,
  listDeliveryPayoutRequests, completeDeliveryPayoutRequest, rejectDeliveryPayoutRequest,
} from '../controllers/admin.controller.js';
import { listReturnPolicies, upsertReturnPolicy } from '../controllers/returnPolicy.controller.js';
import {
  listReturnsAdmin, getReturnAdmin, updateReturnStatusAdmin,
  processReturnRefundAdmin, codSettleReturnAdmin,
} from '../controllers/return.controller.js';
import {
  createBroadcastAdmin, listBroadcastsAdmin, getBroadcastAdmin, sendBroadcastAdmin,
  cancelBroadcastAdmin, deleteBroadcastAdmin, exportBroadcastsCsvAdmin,
} from '../controllers/broadcast.controller.js';
import {
  listCoupons, createCoupon, updateCoupon, toggleCoupon, deleteCoupon, getCouponRedemptions,
} from '../controllers/coupon.controller.js';
import {
  getTipSettingForAdmin, setTipSettingForAdmin,
} from '../controllers/tip.controller.js';
import {
  listCampaignsForAdmin, getCampaignForAdmin, createCampaign, updateCampaign, deleteCampaign,
} from '../controllers/campaign.controller.js';
import {
  listSellerPromotionsForAdmin, getSellerPromotionForAdmin, approveSellerPromotion,
  requestPromotionChanges, rejectSellerPromotion, disableSellerPromotion,
  listPromotionPackagesForAdmin, createPromotionPackage, updatePromotionPackage,
} from '../controllers/sellerPromotion.controller.js';
import {
  getAllPolicies, getPolicyByRole, getPolicyBySlug, updatePolicy,
} from '../controllers/privacyPolicyController.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { uploadSingle, uploadMultiple } from '../middlewares/upload.middleware.js';
import {
  deleteCustomerAccount, deleteSellerAccount, deleteDeliveryAccount,
} from '../controllers/accountManagement.controller.js';
import { getManualAssignmentQueue, assignDeliveryPartner } from '../controllers/deliveryAssignment.controller.js';
import {
  getQuickCommerceDeliveryConfigAdmin, updateQuickCommerceDeliveryConfigAdmin,
  listSellerLedgerAdmin, getSellerBalancesAdmin, getOrderFinanceAdmin,
  listFinancialReconciliationAdmin, listSellerPayoutsLedgerAdmin, settleSellerPayoutLedgerAdmin,
} from '../controllers/adminSellerFinance.controller.js';

const router = express.Router();

// Every admin route is behind auth + admin check — applied once here.
router.use(protect, requireAdmin);

// ---- dashboard -------------------------------------------------------------
router.get('/dashboard/pending-counts', getPendingCounts);
router.get('/dashboard/overview', getDashboardOverview);

// ---- general vendors (sellers) ---------------------------------------------
// Static segment before /sellers/:id, same ordering rule as the fleet stats.
router.get('/vendor-dashboard', vendorDashboard);
router.get('/vendor-orders', getVendorOrdersAdmin);
router.get('/vendor-sales', getVendorSalesAdmin);
router.get('/vendor-earnings', getVendorEarningsAdmin);
router.get('/seller-balances', getSellerBalancesAdmin);
router.get('/vendor-payouts', listSellerPayoutsLedgerAdmin);
router.patch('/vendor-payouts/:id/settle', settleSellerPayoutLedgerAdmin);
router.get('/seller-ledger', listSellerLedgerAdmin);
router.get('/orders/:id/financial-breakdown', getOrderFinanceAdmin);
router.get('/financial-reconciliation', listFinancialReconciliationAdmin);
router.get('/quick-commerce-third-party-config', getQuickCommerceDeliveryConfigAdmin);
router.patch('/quick-commerce-third-party-config', updateQuickCommerceDeliveryConfigAdmin);
router.get('/sellers', listSellers);              // ?status=pending | approved | rejected | suspended
router.get('/wholesale/summary', getWholesaleManagementSummary);
router.get('/sellers/:id', getSellerDetail);      // full registration data + documents
router.patch('/sellers/:id/radius', setSellerRadius);
router.patch('/sellers/:id/third-party-fulfillment', setSellerThirdPartyFulfillment);
router.patch('/sellers/:id/wholesale', decideSellerWholesaleChannel);
router.patch('/sellers/:id/approve', approveSeller);
router.patch('/sellers/:id/reject', rejectSeller);
router.patch('/sellers/:id/suspend', suspendSeller);
router.delete('/sellers/:id', deleteSellerAccount);

// ---- product moderation ----------------------------------------------------
router.get('/products', listProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/feature', featureProduct);
router.patch('/products/:id/sponsor', sponsorProduct);
router.delete('/products/:id', deleteProductAdmin);

// ---- delivery partners -----------------------------------------------------
router.get('/delivery-partners', listDeliveryPartners);
// Registered before /:id — Express matches in order, so ":id" would otherwise
// swallow "stats" and try to look it up as an ObjectId.
router.get('/delivery-partners/stats', deliveryFleetStats);
router.get('/delivery-assignments', getManualAssignmentQueue);
router.post('/delivery-assignments/:id', assignDeliveryPartner);

// ---- rider pay rates (Delivery Fleet) ----------------------------------
// Above /delivery-partners/:id would not clash, but these are their own thing.
router.get('/delivery-rates', getDeliveryRates);
router.post('/delivery-rates', setDeliveryRate);
router.get('/delivery-rates/preview', previewDeliveryRate);
router.get('/delivery-rates/impact', deliveryRateImpact);

// ---- customer delivery charge — distinct from rider pay above -------------
router.get('/delivery-charge', getDeliveryChargeSettingForAdmin);
router.post('/delivery-charge', setDeliveryChargeSettingForAdmin);

router.get('/radius-settings', getRadiusSettingForAdmin);
router.post('/radius-settings', setRadiusSettingForAdmin);

// ---- Dynamic Tip Setting ----------------------------------------------------
router.get('/tip-setting', getTipSettingForAdmin);
router.post('/tip-setting', setTipSettingForAdmin);

// ---- Campaigns / Deals -----------------------------------------------------
router.get('/campaigns', listCampaignsForAdmin);
router.post('/campaigns', uploadSingle('image'), createCampaign);
router.get('/campaigns/:id', getCampaignForAdmin);
router.patch('/campaigns/:id', uploadSingle('image'), updateCampaign);
router.delete('/campaigns/:id', deleteCampaign);
// ---- Seller Promotions / Advertisement --------------------------------------
router.get('/promotions', listSellerPromotionsForAdmin);
router.get('/promotions/:id', getSellerPromotionForAdmin);
router.post('/promotions/:id/approve', approveSellerPromotion);
router.post('/promotions/:id/request-changes', requestPromotionChanges);
router.post('/promotions/:id/reject', rejectSellerPromotion);
router.post('/promotions/:id/disable', disableSellerPromotion);

// ---- Promotion Packages (price catalog for Seller Promotions) --------------
router.get('/promotion-packages', listPromotionPackagesForAdmin);
router.post('/promotion-packages', createPromotionPackage);
router.patch('/promotion-packages/:id', updatePromotionPackage);

router.get('/delivery-partners/:id', getDeliveryPartnerDetail);
router.patch('/delivery-partners/:id/radius', setDeliveryPartnerRadius);
router.patch('/delivery-partners/:id/approve', approveDeliveryPartner);
router.patch('/delivery-partners/:id/reject', rejectDeliveryPartner);
router.patch('/delivery-partners/:id/suspend', suspendDeliveryPartner);
router.delete('/delivery-partners/:id', deleteDeliveryAccount);

// ---- delivery performance (Fleet SLA scorecard) -----------------------------
router.get('/delivery-performance', deliveryPerformanceStats);

// ---- delivery hub zones (serviceable pincode coverage) ----------------------
router.get('/delivery-zones', listDeliveryZones);

// ---- delivery history (Completed Deliveries) --------------------------------
router.get('/delivery-history', getDeliveryHistory);

// ---- rider payouts (Earnings & Payouts) --------------------------------------
router.get('/rider-payouts', listRiderPayouts);
router.patch('/rider-payouts/:id/settle', settleRiderPayout);
router.get('/delivery-payouts', listDeliveryPayoutRequests);
router.patch('/delivery-payouts/:id/complete', completeDeliveryPayoutRequest);
router.patch('/delivery-payouts/:id/reject', rejectDeliveryPayoutRequest);

// ---- Return & Refund — Category Return Policy (Phase 2 foundation) -----
router.get('/return-policies', listReturnPolicies);
router.patch('/return-policies/:categoryId', upsertReturnPolicy);

// ---- Return & Refund — item-level Return requests (Phase 4) ------------
router.get('/returns', listReturnsAdmin);
router.get('/returns/:id', getReturnAdmin);
router.patch('/returns/:id/status', updateReturnStatusAdmin);
router.post('/returns/:id/refund', processReturnRefundAdmin);
router.post('/returns/:id/cod-settle', codSettleReturnAdmin);

// ---- Push Notifications Broadcaster --------------------------------------
// `/export` is registered before `/:id` for the same reason
// `deliveryFleetStats` is registered before `/delivery-partners/:id` above —
// otherwise Express would treat "export" as an `:id`.
router.get('/broadcasts/export', exportBroadcastsCsvAdmin);
router.get('/broadcasts', listBroadcastsAdmin);
router.post('/broadcasts', uploadSingle('media'), createBroadcastAdmin);
router.get('/broadcasts/:id', getBroadcastAdmin);
router.post('/broadcasts/:id/send', sendBroadcastAdmin);
router.patch('/broadcasts/:id/cancel', cancelBroadcastAdmin);
router.delete('/broadcasts/:id', deleteBroadcastAdmin);

// ---- coupons ---------------------------------------------------------------
router.get('/coupons', listCoupons);
router.post('/coupons', createCoupon);
router.get('/coupons/:id/redemptions', getCouponRedemptions);
router.put('/coupons/:id', updateCoupon);
router.patch('/coupons/:id/toggle', toggleCoupon);
router.delete('/coupons/:id', deleteCoupon);

// ---- customers -------------------------------------------------------------
router.get('/users', listUsers);
router.patch('/users/:id/status', setUserStatus);
router.delete('/users/:id', deleteCustomerAccount);

// ---- consumer management (Consumer Users tab) ------------------------------
router.get('/consumers/stats', getConsumerStats);
router.get('/consumers/locations', getConsumerLocations);
router.get('/consumers/activity-log', getCustomerActivityLog);
router.get('/consumers/orders', getCustomerOrders);
router.get('/consumers/orders-summary', getConsumerOrdersSummary);
router.get('/consumers/reviews', getCustomerReviews);
router.patch('/consumers/reviews/:id/status', updateReviewStatus);
router.delete('/consumers/reviews/:id', deleteCustomerReview);

// ---- admin's own notification inbox -----------------------------------------
router.get('/notifications', getAdminNotifications);
router.get('/notifications/unread-count', getAdminUnreadCount);
router.patch('/notifications/read-all', markAllAdminNotificationsRead);
router.patch('/notifications/:id/read', markAdminNotificationRead);

// ---- support tickets --------------------------------------------------------
router.get('/tickets', getTickets);
router.get('/tickets/:id', getTicketDetailAdmin);
router.post('/tickets/:id/messages', uploadMultiple('attachments', 5), replyToTicket);
router.post('/tickets/:id/notes', uploadMultiple('attachments', 5), addInternalNote);
router.patch('/tickets/:id/assign', assignTicket);
router.patch('/tickets/:id/status', changeTicketStatus);
router.patch('/tickets/:id/resolve', resolveTicket);

// ---- privacy policy management (4 roles: user, seller, delivery, shg) -------
router.get('/privacy-policy', getAllPolicies);
router.get('/privacy-policy/:identifier', getPolicyBySlug);
router.put('/privacy-policy/:identifier', updatePolicy);

export default router;
