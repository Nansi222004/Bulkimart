// IMPORTANT: this must be the very first import.
import "./config/environment.js";

import { setServers } from "dns";
import http from "http";
import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import { requestContext } from './middlewares/requestContext.middleware.js';
import morgan from "morgan";
import helmet from "helmet";
import compression from "compression";
import connectDB from "./config/db.js";
import { getCorsOptions } from "./config/cors.js";
import { validateRuntimeConfig } from "./config/runtime.js";
import { JWT_ALGORITHM } from './config/jwt.js';
import { validateCloudinaryStartupConfig } from "./config/cloudinary.js";
import { getFirebaseApp, validateFirebaseAdminConfig } from "./config/firebaseAdmin.js";
import apiRoutes from "./routes/index.js";
import healthRoutes from "./routes/health.routes.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { initSocket } from "./socket/socket.js";
import { startOrderSweeper } from "./services/orderSweeper.service.js";
import { loadRates } from "./services/riderPay.service.js";
import { loadDeliveryChargeSetting } from "./services/deliveryCharge.service.js";
import { loadCoinConfig } from "./services/coinConfig.service.js";
import { loadRadiusSetting } from "./services/radiusSetting.service.js";
import { seedPrivacyPolicies } from "./seed/privacyPolicySeedData.js";
import { startImageSearchIndexer } from './services/imageSearchIndexer.service.js';

// Fix: Node.js on Windows uses local router DNS (fe80::1) which blocks SRV record queries.
if (process.env.NODE_ENV === "development") {
  setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
}

// Validate before connecting to MongoDB or starting any background work.
validateRuntimeConfig();
console.info(JSON.stringify({ event: 'jwt_configuration_ready', algorithm: JWT_ALGORITHM, instance: process.pid,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'non-production' }));
validateCloudinaryStartupConfig();
if (process.env.FCM_MODE === "live") {
  validateFirebaseAdminConfig();
  getFirebaseApp();
}

const app = express();

// Hostinger routes traffic through a single reverse-proxy layer (Nginx/LiteSpeed)
// that sets X-Forwarded-For. Trusting exactly one hop lets express-rate-limit
// key on the real client IP instead of the proxy's, and silences the
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR validation error from express-rate-limit v8.
app.set('trust proxy', 1);

const PORT = process.env.PORT || 5050;
// Hosting platforms route public traffic to the assigned PORT on the network
// interface. Binding localhost makes the process healthy only from itself.
const HOSTNAME = process.env.BIND_HOST || "0.0.0.0";

// CSP off: the built frontend below pulls scripts from Firebase, Google
// Maps and the payment gateway's own checkout script — helmet's default
// policy blocks all of that with no allowlist configured for this app yet.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}
app.use(cors(getCorsOptions()));
app.use(requestContext);
app.use(express.json({
  verify: (req, _res, buffer) => {
    if (req.originalUrl?.startsWith('/api/payments/razorpay/webhook')) {
      req.rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: true }));

// Health check moved off "/" — the built frontend (below) now owns that
// path, and a route registered here would win over it on every request.
app.use("/api/health", healthRoutes);

app.use("/api", apiRoutes);

/**
 * The built frontend, served by this same process on this same port.
 *
 * Independent of NODE_ENV: presence of the built `dist` folder is the real
 * signal for serving the frontend, not the runtime environment name.
 */
// NOTE: KYC documents in backend/uploads/ are NOT served statically.
// Identity documents must never be publicly accessible. Cloudinary URLs
// are the intended delivery mechanism; the local fallback stores files
// for disaster recovery but does not expose them without authorization.

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
  startImageSearchIndexer();
  const httpServer = http.createServer(app);
  initSocket(httpServer);
  // Started after the database is up: the sweeper queries on every tick.
  startOrderSweeper();
  // Rider pay rates into memory once, so the offer screen never waits on a
  // query. Admin saves refresh this; a failure leaves the env defaults.
  await loadRates().catch((e) => console.warn('[RATES] using env defaults:', e.message));
  // Same reasoning, for the customer-facing delivery charge.
  await loadDeliveryChargeSetting().catch((e) => console.warn('[DELIVERY CHARGE] using defaults:', e.message));
  // Same reasoning, for NHCONE Coins earn/redemption rules.
  await loadCoinConfig().catch((e) => console.warn('[COIN CONFIG] using defaults:', e.message));
  // Same reasoning, for the Same-Day/seller/rider radius ceilings.
  await loadRadiusSetting().catch((e) => console.warn('[RADIUS SETTING] using env defaults:', e.message));
  // Auto-seed default role privacy policies if missing
  await seedPrivacyPolicies().catch((e) => console.warn('[PRIVACY POLICY SEED] error:', e.message));

  httpServer.listen(PORT, HOSTNAME, () => {
    console.log(`Server running on http://${HOSTNAME}:${PORT}`);
  });
};

start();

// Graceful shutdown: stop background sweepers and close the HTTP server
// so Hostinger restarts see a clean exit rather than a killed process.
const shutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully`);
  import('./services/orderSweeper.service.js').then((m) => m.stopOrderSweeper()).catch(() => {});
  // Allow in-flight requests to drain for up to 10 s before forcing exit.
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
