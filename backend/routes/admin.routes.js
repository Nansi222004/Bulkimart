import express from 'express';
import {
  listSellers, getSellerDetail, approveSeller, rejectSeller, suspendSeller, setSellerRadius,
  vendorDashboard, getVendorOrdersAdmin, getVendorSalesAdmin, getVendorEarningsAdmin, getVendorPayoutsAdmin, settleVendorPayoutAdmin,
  listSHGStores, getSHGDetail, approveSHG, rejectSHG, suspendSHG, shgPerformanceStats,
  listProducts, approveProduct, rejectProduct, featureProduct, sponsorProduct,
  listUsers, setUserStatus, setUserCDS, getConsumerLocations,
  getPendingCounts,
  listDeliveryPartners,
  deliveryFleetStats, getDeliveryPartnerDetail, deliveryPerformanceStats, listDeliveryZones,
  approveDeliveryPartner, rejectDeliveryPartner, suspendDeliveryPartner, setDeliveryPartnerRadius,
  getDeliveryRates, setDeliveryRate, previewDeliveryRate, deliveryRateImpact,
  getDeliveryChargeSettingForAdmin, setDeliveryChargeSettingForAdmin,
  getRadiusSettingForAdmin, setRadiusSettingForAdmin,
  listSubscriptionsForAdmin, getSubscriptionDetailForAdmin,
  listShgSubscriptionPlans, createShgSubscriptionPlan, updateShgSubscriptionPlan,
  listShgSubscriptionsForAdmin,
  getDashboardOverview,
  getConsumerStats, listCDSMembers, getCustomerActivityLog, getCustomerOrders, getConsumerOrdersSummary,
  getCustomerReviews, deleteCustomerReview, updateReviewStatus,
  getTickets, resolveTicket, getTicketDetailAdmin, replyToTicket, addInternalNote,
  assignTicket, changeTicketStatus,
  getAdminNotifications, getAdminUnreadCount, markAdminNotificationRead, markAllAdminNotificationsRead,
  getDeliveryHistory,
  listRiderPayouts, settleRiderPayout,
  listDeliveryPayoutRequests, completeDeliveryPayoutRequest, rejectDeliveryPayoutRequest,
} from '../controllers/admin.controller.js';
import {
  listPackagingMaterialsAdmin, createPackagingMaterial, updatePackagingMaterial, setPackagingMaterialStatus,
  listPackagingPackagesAdmin, getPackagingPackageAdmin, createPackagingPackage, updatePackagingPackage,
  publishPackagingPackage, disablePackagingPackage,
  listPackagingOrdersAdmin, getPackagingOrderAdmin, updatePackagingOrderStatusAdmin,
} from '../controllers/packaging.controller.js';
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
  getReferralConfigForAdmin, setReferralConfigForAdmin,
  listReferralsAdmin, getReferralAdmin, blockReferralAdmin, approveReferralAdmin,
  getReferralCostReport,
} from '../controllers/referralAdmin.controller.js';
import {
  listCoupons, createCoupon, updateCoupon, toggleCoupon, deleteCoupon, getCouponRedemptions,
} from '../controllers/coupon.controller.js';
import {
  listPremiumPlansForAdmin, createPremiumPlan, updatePremiumPlan,
} from '../controllers/premium.controller.js';
import {
  getDonationSettingForAdmin, setDonationSettingForAdmin,
  getAdminDonationOverview, getAdminDonationTransactions, getAdminDonationDetail,
  addAdminNoteToDonation, updateDonationStatus, exportDonationTransactionsCSV,
} from '../controllers/donation.controller.js';
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
import {
  getAdminPlans, createAdminPlan, updateAdminPlan, toggleAdminPlanStatus,
  getAdminNhcApplications, getAdminNhcApplicationDetail, approveNhcApplication, rejectNhcApplication
} from '../controllers/nhc.controller.js';
import { protect, requireAdmin } from '../middlewares/auth.middleware.js';
import { uploadSingle, uploadMultiple } from '../middlewares/upload.middleware.js';

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
router.get('/vendor-payouts', getVendorPayoutsAdmin);
router.patch('/vendor-payouts/:id/settle', settleVendorPayoutAdmin);
router.get('/sellers', listSellers);              // ?status=pending | approved | rejected | suspended
router.get('/sellers/:id', getSellerDetail);      // full registration data + documents
router.patch('/sellers/:id/radius', setSellerRadius);
router.patch('/sellers/:id/approve', approveSeller);
router.patch('/sellers/:id/reject', rejectSeller);
router.patch('/sellers/:id/suspend', suspendSeller);

// ---- SHG vendors -----------------------------------------------------------
// Static segment before /shg/:id, same ordering rule as deliveryFleetStats.
router.get('/shg-performance', shgPerformanceStats);
router.get('/shg', listSHGStores);
router.get('/shg/:id', getSHGDetail);
router.patch('/shg/:id/approve', approveSHG);
router.patch('/shg/:id/reject', rejectSHG);
router.patch('/shg/:id/suspend', suspendSHG);

// ---- product moderation ----------------------------------------------------
router.get('/products', listProducts);
router.patch('/products/:id/approve', approveProduct);
router.patch('/products/:id/reject', rejectProduct);
router.patch('/products/:id/feature', featureProduct);
router.patch('/products/:id/sponsor', sponsorProduct);

// ---- delivery partners -----------------------------------------------------
router.get('/delivery-partners', listDeliveryPartners);
// Registered before /:id — Express matches in order, so ":id" would otherwise
// swallow "stats" and try to look it up as an ObjectId.
router.get('/delivery-partners/stats', deliveryFleetStats);

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

// ---- Referral Program -------------------------------------------------------
// `/cost-report` and `/referral-settings` are registered before `/referrals/:id`
// for the same "static segment before :id" reason as `deliveryFleetStats` above.
router.get('/referral-settings', getReferralConfigForAdmin);
router.post('/referral-settings', setReferralConfigForAdmin);
router.get('/referrals/cost-report', getReferralCostReport);
router.get('/referrals', listReferralsAdmin);
router.get('/referrals/:id', getReferralAdmin);
router.patch('/referrals/:id/block', blockReferralAdmin);
router.patch('/referrals/:id/approve', approveReferralAdmin);

// ---- Help Wallet / Social Work donation setting & transactions ----------------
router.get('/donation-setting', getDonationSettingForAdmin);
router.post('/donation-setting', setDonationSettingForAdmin);
router.get('/donations/overview', getAdminDonationOverview);
router.get('/donations/transactions', getAdminDonationTransactions);
router.get('/donations/export', exportDonationTransactionsCSV);
router.get('/donations/transactions/:id', getAdminDonationDetail);
router.post('/donations/transactions/:id/notes', addAdminNoteToDonation);
router.patch('/donations/transactions/:id/status', updateDonationStatus);

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

// ---- Packaging Material System (V1) -------------------------------------
router.get('/packaging/materials', listPackagingMaterialsAdmin);
router.post('/packaging/materials', uploadSingle('image'), createPackagingMaterial);
router.patch('/packaging/materials/:id', uploadSingle('image'), updatePackagingMaterial);
router.patch('/packaging/materials/:id/status', setPackagingMaterialStatus);

router.get('/packaging/packages', listPackagingPackagesAdmin);
router.post('/packaging/packages', uploadSingle('image'), createPackagingPackage);
router.get('/packaging/packages/:id', getPackagingPackageAdmin);
router.patch('/packaging/packages/:id', uploadSingle('image'), updatePackagingPackage);
router.patch('/packaging/packages/:id/publish', publishPackagingPackage);
router.patch('/packaging/packages/:id/disable', disablePackagingPackage);

router.get('/packaging/orders', listPackagingOrdersAdmin);
router.get('/packaging/orders/:id', getPackagingOrderAdmin);
router.patch('/packaging/orders/:id/status', updatePackagingOrderStatusAdmin);

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

// ---- subscriptions (read-only monitoring) ----------------------------------
router.get('/subscriptions', listSubscriptionsForAdmin);
router.get('/subscriptions/:id', getSubscriptionDetailForAdmin);

// ---- SHG seller subscriptions (plan catalog + purchased records) -----------
router.get('/shg-subscription-plans', listShgSubscriptionPlans);
router.post('/shg-subscription-plans', createShgSubscriptionPlan);
router.patch('/shg-subscription-plans/:id', updateShgSubscriptionPlan);
router.get('/shg-subscriptions', listShgSubscriptionsForAdmin);

// ---- customer Premium Membership plans ---------------------------------
// Handlers live in premium.controller.js (domain cohesion) and are wired
// here so they inherit this router's protect + requireAdmin — same shape as
// the coupon handlers above.
router.get('/premium-plans', listPremiumPlansForAdmin);
router.post('/premium-plans', createPremiumPlan);
router.patch('/premium-plans/:id', updatePremiumPlan);

// ---- customers -------------------------------------------------------------
router.get('/users', listUsers);
router.patch('/users/:id/status', setUserStatus);
router.patch('/users/:id/cds', setUserCDS);

// ---- consumer management (Consumer Users tab) ------------------------------
router.get('/consumers/stats', getConsumerStats);
router.get('/consumers/locations', getConsumerLocations);
router.get('/consumers/cds', listCDSMembers);
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

// ---- NHC Management --------------------------------------------------------
router.get('/nhc/plans', getAdminPlans);
router.post('/nhc/plans', createAdminPlan);
router.patch('/nhc/plans/:id', updateAdminPlan);
router.patch('/nhc/plans/:id/status', toggleAdminPlanStatus);

router.get('/nhc/seller-applications', getAdminNhcApplications);
router.get('/nhc/seller-applications/:id', getAdminNhcApplicationDetail);
router.patch('/nhc/seller-applications/:id/approve', approveNhcApplication);
router.patch('/nhc/seller-applications/:id/reject', rejectNhcApplication);

export default router;
