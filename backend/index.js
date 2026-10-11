// IMPORTANT: this must be the very first import.
import "dotenv/config";

import { setServers } from "dns";
import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import compression from "compression";
import connectDB from "./config/db.js";
import apiRoutes from "./routes/index.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { initSocket } from "./socket/socket.js";
import { startOrderSweeper } from "./services/orderSweeper.service.js";
import { startSubscriptionAcceptSweeper } from "./services/subscriptionAcceptSweeper.service.js";
import { startSubscriptionPrepSweeper } from "./services/subscriptionPrepSweeper.service.js";
import { startSellerPromotionSweeper } from "./services/sellerPromotionSweeper.service.js";
import { loadRates } from "./services/riderPay.service.js";
import { loadDeliveryChargeSetting } from "./services/deliveryCharge.service.js";
import { loadCoinConfig } from "./services/coinConfig.service.js";
import { loadRadiusSetting } from "./services/radiusSetting.service.js";
import { loadReferralConfig } from "./services/referralConfig.service.js";
import { loadDonationSetting } from "./services/donation.service.js";
import { seedPrivacyPolicies } from "./seed/privacyPolicySeedData.js";

// Fix: Node.js on Windows uses local router DNS (fe80::1) which blocks SRV record queries.
if (process.env.NODE_ENV === "development") {
  setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}

// Refuse to boot with mock integrations in production.
if (process.env.NODE_ENV === "production") {
  const unsafe = ["OTP_MODE", "RAZORPAY_MODE", "SHIPROCKET_MODE", "FCM_MODE", "MAPS_MODE"]
    .filter((key) => process.env[key] === "mock");
  if (unsafe.length) {
    throw new Error(`Refusing to boot — mock mode enabled in production: ${unsafe.join(", ")}`);
  }
}

const app = express();
const PORT = process.env.PORT || 5050;
const HOSTNAME = process.env.HOSTNAME || 'localhost';

// CSP off: the built frontend below pulls scripts from Firebase, Google
// Maps and the payment gateway's own checkout script — helmet's default
// policy blocks all of that with no allowlist configured for this app yet.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check moved off "/" — the built frontend (below) now owns that
// path, and a route registered here would win over it on every request.
app.get("/api/health", (req, res) => {
  res.json({ message: "Backend is running 🚀" });
});

app.use("/api", apiRoutes);

/**
 * The built frontend, served by this same process on this same port.
 *
 * Independent of NODE_ENV: this deploy runs the backend in development mode
 * (see the mock-integration guard above — several integrations are still
 * mocked, which would refuse to boot in production), but the frontend still
 * needs serving from somewhere. Presence of the built `dist` folder is the
 * real signal, not the env flag.
 */
const frontendDist = path.resolve(import.meta.dirname, "../forntend/dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

app.use(errorHandler);

const start = async () => {
  await connectDB();
  const httpServer = http.createServer(app);
  initSocket(httpServer);
  // Started after the database is up: the sweeper queries on every tick.
  startOrderSweeper();
  startSubscriptionAcceptSweeper();
  startSubscriptionPrepSweeper();
  startSellerPromotionSweeper();
  // Rider pay rates into memory once, so the offer screen never waits on a
  // query. Admin saves refresh this; a failure leaves the env defaults.
  await loadRates().catch((e) => console.warn('[RATES] using env defaults:', e.message));
  // Same reasoning, for the customer-facing delivery charge.
  await loadDeliveryChargeSetting().catch((e) => console.warn('[DELIVERY CHARGE] using defaults:', e.message));
  // Same reasoning, for NHCONE Coins earn/redemption rules.
  await loadCoinConfig().catch((e) => console.warn('[COIN CONFIG] using defaults:', e.message));
  // Same reasoning, for the Same-Day/seller/rider radius ceilings.
  await loadRadiusSetting().catch((e) => console.warn('[RADIUS SETTING] using env defaults:', e.message));
  // Same reasoning, for the Referral Program's reward/limit configuration.
  await loadReferralConfig().catch((e) => console.warn('[REFERRAL CONFIG] using defaults:', e.message));
  // Same reasoning, for the checkout Donation prompt setting.
  await loadDonationSetting().catch((e) => console.warn('[DONATION SETTING] using defaults:', e.message));
  // Auto-seed default role privacy policies if missing
  await seedPrivacyPolicies().catch((e) => console.warn('[PRIVACY POLICY SEED] error:', e.message));

  httpServer.listen(PORT, HOSTNAME, () => {
    console.log(`Server running on http://${HOSTNAME}:${PORT}`);
  });
};

start();
