# Legacy feature removal report

## Outcome

SHG/NHC franchise selling, recurring grocery subscriptions, donations, and Premium Membership no longer have active routes, controllers, services, scheduled jobs, seed catalogs, or frontend management/purchase surfaces. Shared commerce, PhonePe, wallet, NHCONE coin, seller promotion, delivery, refund, and checkout paths remain.

No MongoDB connection, query, migration, index change, document update, or cleanup script was run.

## Added files

- `backend/__tests__/api/retired-features.routes.test.js`
- `legacy_feature_removal_report.md`

## Deleted files (69)

### Backend tests, controllers, models, routes, scripts, seeds, and services

- `backend/__tests__/api/retired-subscription.routes.test.js`
- `backend/controllers/donation.controller.js`
- `backend/controllers/premium.controller.js`
- `backend/controllers/shg.controller.js`
- `backend/controllers/shgSubscription.controller.js`
- `backend/controllers/subscription.controller.js`
- `backend/controllers/subscriptionBasket.controller.js`
- `backend/models/DonationSetting.js`
- `backend/models/DonationTransaction.js`
- `backend/models/PremiumMembership.js`
- `backend/models/PremiumPlan.js`
- `backend/models/SHGStore.js`
- `backend/models/SHGSubscription.js`
- `backend/models/Subscription.js`
- `backend/models/SubscriptionBasket.js`
- `backend/models/SubscriptionPlan.js`
- `backend/routes/donation.routes.js`
- `backend/routes/premium.routes.js`
- `backend/routes/shg.routes.js`
- `backend/routes/shgSubscription.routes.js`
- `backend/routes/subscription.routes.js`
- `backend/routes/subscriptionBasket.routes.js`
- `backend/scripts/cleanupLegacySHGCategories.mjs`
- `backend/scripts/dryRunLegacyStoreCleanup.mjs`
- `backend/seed/data/shgStores.js`
- `backend/seed/seedPremiumPlans.js`
- `backend/seed/seedShgSubscriptionPlans.js`
- `backend/services/donation.service.js`
- `backend/services/premium.service.js`
- `backend/services/shgSubscription.service.js`
- `backend/services/shgSubscriptionSweeper.service.js`
- `backend/services/subscription.service.js`
- `backend/services/subscriptionAcceptSweeper.service.js`
- `backend/services/subscriptionPrepSweeper.service.js`

### Frontend

- `forntend/src/assets/shg_hero_banner.png`
- `forntend/src/modules/Admin/components/DonationSettingsTab.jsx`
- `forntend/src/modules/Admin/components/PremiumPlansTab.jsx`
- `forntend/src/modules/Admin/components/SHGDashboardTab.jsx`
- `forntend/src/modules/Admin/components/SHGDetailModal.jsx`
- `forntend/src/modules/Admin/components/SHGFeaturedCollectionsTab.jsx`
- `forntend/src/modules/Admin/components/SHGPayoutsTab.jsx`
- `forntend/src/modules/Admin/components/SHGPerformanceTab.jsx`
- `forntend/src/modules/Admin/components/SHGProductApprovalTab.jsx`
- `forntend/src/modules/Admin/components/SHGProductsTab.jsx`
- `forntend/src/modules/Admin/components/SHGSubscriptionsTab.jsx`
- `forntend/src/modules/Admin/components/SHGVendorsTab.jsx`
- `forntend/src/modules/Admin/components/SHGVerificationsTab.jsx`
- `forntend/src/modules/Admin/components/SubscriptionsTab.jsx`
- `forntend/src/modules/Admin/pages/DashboardPage.jsx`
- `forntend/src/modules/SHG/SHG.css`
- `forntend/src/modules/SHG/components/SHGAccountTab.jsx`
- `forntend/src/modules/SHG/components/SHGDashboardTab.jsx`
- `forntend/src/modules/SHG/components/SHGEarningsTab.jsx`
- `forntend/src/modules/SHG/components/SHGLeftNav.jsx`
- `forntend/src/modules/SHG/components/SHGMembersTab.jsx`
- `forntend/src/modules/SHG/components/SHGOrdersTab.jsx`
- `forntend/src/modules/SHG/components/SHGProductsTab.jsx`
- `forntend/src/modules/SHG/components/SHGSubscriptionsTab.jsx`
- `forntend/src/modules/SHG/components/SHGSupportTab.jsx`
- `forntend/src/modules/SHG/components/SubscriptionBanner.jsx`
- `forntend/src/modules/SHG/components/SubscriptionRequiredModal.jsx`
- `forntend/src/modules/SHG/context/SHGContext.jsx`
- `forntend/src/modules/SHG/pages/SHGDashboardPage.jsx`
- `forntend/src/modules/SHG/pages/SHGLoginPage.jsx`
- `forntend/src/modules/SHG/pages/SHGOnboardingPage.jsx`
- `forntend/src/modules/SHG/routes/index.jsx`
- `forntend/src/modules/Seller/components/SubscriptionPackChecklist.jsx`
- `forntend/src/modules/Seller/components/SubscriptionRequestRingModal.jsx`
- `forntend/src/modules/Seller/components/SubscriptionsTab.jsx`

## Modified files (76)

### Documentation and tests

- `README.md`
- `backend/__tests__/api/checkout-workflow.http.test.js`
- `backend/__tests__/api/delivery-otp.http.test.js`
- `backend/__tests__/api/seller-payment.http.test.js`
- `backend/__tests__/utils/seller-onboarding-draft.test.js`

### Backend

- `backend/constants/enums.js`
- `backend/controllers/admin.controller.js`
- `backend/controllers/auth.controller.js`
- `backend/controllers/cart.controller.js`
- `backend/controllers/deliveryPartner.controller.js`
- `backend/controllers/order.controller.js`
- `backend/controllers/packaging.controller.js`
- `backend/controllers/payment.controller.js`
- `backend/controllers/product.controller.js`
- `backend/controllers/return.controller.js`
- `backend/controllers/sellerPromotion.controller.js`
- `backend/controllers/user.controller.js`
- `backend/index.js`
- `backend/middlewares/error.middleware.js`
- `backend/middlewares/vendor.middleware.js`
- `backend/models/NotificationBroadcast.js`
- `backend/models/Payment.js`
- `backend/models/PromotionPackage.js`
- `backend/models/Seller.js`
- `backend/models/User.js`
- `backend/package.json`
- `backend/routes/admin.routes.js`
- `backend/routes/index.js`
- `backend/routes/privacyPolicy.routes.js`
- `backend/routes/promotion.routes.js`
- `backend/routes/user.routes.js`
- `backend/seed/data/banners.js`
- `backend/seed/data/categories.js`
- `backend/seed/data/categoryTree.js`
- `backend/seed/data/commissions.js`
- `backend/seed/data/products.js`
- `backend/seed/data/users.js`
- `backend/seed/fixVendorRoles.js`
- `backend/seed/ids.js`
- `backend/seed/index.js`
- `backend/seed/privacyPolicySeedData.js`
- `backend/services/broadcast.service.js`
- `backend/services/fulfilmentGroups.service.js`
- `backend/services/fulfilmentOrders.service.js`
- `backend/services/notification.service.js`
- `backend/services/pricing.service.js`
- `backend/services/ticket.service.js`
- `backend/services/wallet.service.js`
- `backend/socket/rooms.js`
- `backend/utils/excelParser.js`
- `backend/utils/ownership.js`

### Frontend

- `forntend/src/modules/Admin/components/LeftNav.jsx`
- `forntend/src/modules/Admin/components/LeftSidebar.jsx`
- `forntend/src/modules/Admin/components/NotificationBroadcasterTab.jsx`
- `forntend/src/modules/Admin/components/PrivacyPolicyTab.jsx`
- `forntend/src/modules/Admin/components/PromotionPackagesTab.jsx`
- `forntend/src/modules/Admin/components/TicketsTab.jsx`
- `forntend/src/modules/Admin/components/UserWalletsTab.jsx`
- `forntend/src/modules/Admin/context/AdminContext.jsx`
- `forntend/src/modules/Admin/pages/SuperAdminDashboard.jsx`
- `forntend/src/modules/Admin/routes/index.jsx`
- `forntend/src/modules/Seller/components/AccountTab.jsx`
- `forntend/src/modules/Seller/components/BulkUploadModal.jsx`
- `forntend/src/modules/Seller/components/NotificationDrawer.jsx`
- `forntend/src/modules/Seller/context/SellerContext.jsx`
- `forntend/src/modules/Seller/pages/DashboardPage.jsx`
- `forntend/src/modules/Seller/pages/OnboardingPage.jsx`
- `forntend/src/modules/Seller/utils/onboardingDraft.js`
- `forntend/src/modules/User/User.css`
- `forntend/src/modules/User/components/BottomNav.jsx`
- `forntend/src/modules/User/components/HeroBanner.jsx`
- `forntend/src/modules/User/components/QuickActions.jsx`
- `forntend/src/modules/User/context/UserContext.jsx`
- `forntend/src/modules/User/pages/CheckoutPage.jsx`
- `forntend/src/modules/User/pages/ProfilePage.jsx`
- `forntend/src/utils/socket.js`

## Remaining retired-feature references

### Required historical compatibility

- `backend/models/Payment.js`: optional `subscriptionId`, `shgSubscriptionId`, and `premiumMembershipId` identifiers remain inert so historical financial records deserialize without mutation.
- `backend/models/Order.js`, `backend/models/Delivery.js`, and `backend/models/Notification.js`: historical subscription identifiers/types remain readable; no active controller writes or advances subscriptions.
- `backend/models/Order.js`: historical donation and CDS-discount snapshots remain readable; new pricing and checkout code no longer creates donation amounts or CDS membership discounts.
- Shared product/cart/order/return schemas retain legacy SHG identifiers where removing them could hide fields on old records. Public product lookup, direct cart insertion, and checkout revalidation reject legacy SHG products.
- User and seller notification drawers filter historical `subscription`/`membership` notifications, and banner selection filters retired subscription/Premium banners, preventing old stored content from resurfacing.
- Historical donation values may still render on old order tracking records; there is no donation setting, preference, checkout input, settlement, or admin route.

### Tests and documentation

- `backend/__tests__/api/retired-features.routes.test.js` names retired URLs only to assert HTTP 404.
- `README.md` names retired features only to document that they are unsupported.

### Not the retired Premium Membership feature

- “Same-Day Delivery Premium” is an active delivery surcharge, not a membership.
- Seller “Premium Product Ranking” refers to active paid promotion placement, not customer membership.

## Verification

- Backend syntax: all backend JavaScript files passed `node --check`.
- Focused backend tests: 4 suites, 54 tests passed (including 13 retired-route assertions).
- Retired-route test: premium plan discovery, membership state/purchase, subscription, SHG, and donation URLs all return 404.
- Frontend production build: passed with Vite 8.2.1.
- `git diff --check`: passed (only Git line-ending warnings).
- Database operations: none.

## Preserved unrelated worktree items

Pre-existing untracked seller-schema tests, seller email-index migration, color-theme notes, and banner/design-token assets were left untouched.
