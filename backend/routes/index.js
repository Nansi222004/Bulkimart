import express from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import sellerRoutes from "./seller.routes.js";
import premiumRoutes from "./premium.routes.js";
import categoryRoutes from "./category.routes.js";
import productRoutes from "./product.routes.js";
import adminRoutes from "./admin.routes.js";
import cartRoutes from "./cart.routes.js";
import wishlistRoutes from "./wishlist.routes.js";
import donationRoutes from "./donation.routes.js";
import tipRoutes from "./tip.routes.js";
import campaignRoutes from "./campaign.routes.js";
import subscriptionRoutes from "./subscription.routes.js";
import orderRoutes from "./order.routes.js";
import couponRoutes from "./coupon.routes.js";
import deliveryRoutes from "./delivery.routes.js";
import paymentRoutes from "./payment.routes.js";
import geoRoutes from "./geo.routes.js";
import bannerRoutes from "./banner.routes.js";
import promotionRoutes from "./promotion.routes.js";
import notificationRoutes from "./notification.routes.js";
import ticketRoutes from "./ticket.routes.js";
import packagingRoutes from "./packaging.routes.js";
import coinRoutes from "./coin.routes.js";
import returnRoutes from "./return.routes.js";
import referralRoutes from "./referral.routes.js";
import privacyPolicyRoutes from "./privacyPolicy.routes.js";
import walletRoutes from "./wallet.routes.js";

const router = express.Router();

// Register active Day 1 routers
router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/sellers", sellerRoutes);
router.use("/premium", premiumRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/admin", adminRoutes);
router.use("/cart", cartRoutes);
router.use("/wishlist", wishlistRoutes);
router.use("/donation-setting", donationRoutes);
router.use("/tip-setting", tipRoutes);
router.use("/campaigns", campaignRoutes);
router.use("/orders", orderRoutes);
router.use("/coupons", couponRoutes);
router.use("/delivery", deliveryRoutes);
router.use("/payments", paymentRoutes);
router.use("/geo", geoRoutes);
router.use("/banners", bannerRoutes);
router.use("/promotions", promotionRoutes);
router.use("/packaging", packagingRoutes);
router.use("/coins", coinRoutes);
router.use("/returns", returnRoutes);
router.use("/referrals", referralRoutes);
router.use("/privacy-policy", privacyPolicyRoutes);
router.use("/wallet", walletRoutes);

// Placeholder stub lists for Day 2 modules
router.use("/subscriptions", subscriptionRoutes);
// Product-subscription basket routes are intentionally unmounted: new
// subscription purchases are retired. Keep historical subscription reads,
// seller fulfillment, and payment callbacks available for in-flight records.
router.use("/notifications", notificationRoutes);
router.use("/tickets", ticketRoutes);
router.use("/analytics", (req, res) => res.json({ message: "Analytics API placeholder (Day 2)" }));

export default router;
