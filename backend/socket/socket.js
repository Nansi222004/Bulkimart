/**
 * socket.js — Socket.io server initialiser.
 *
 * Rooms are named after the identity they belong to:
 *   "user:<userId>"        — the buyer
 *   "seller:<sellerId>"    — the Seller document, not the User behind it
 *   "shg:<shgStoreId>"     — the SHGStore document, likewise
 *   "rider:<partnerId>"    — the DeliveryPartner document, likewise
 *
 * Which room a socket may enter is decided here, from the JWT, and never from
 * anything the client sends.
 *
 * That distinction used to be missing: the join handlers took an id as an
 * argument and joined it verbatim. Since the events carried real data —
 * `new_order` includes the customer's name, address and phone; `otp_ready`
 * includes the delivery OTP — anyone with a browser console could subscribe to
 * another shop's orders, or to the OTP that is the only proof a parcel actually
 * reached its owner:
 *
 *     socket.emit('join_seller', '<someone else's seller id>')
 *
 * The client still emits an id, because the existing frontend does; it is now
 * ignored. The seller and rider rooms need a lookup because the JWT identifies
 * the person, while those rooms are keyed by their vendor record.
 */

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import Seller from "../models/Seller.js";
import SHGStore from "../models/SHGStore.js";
import DeliveryPartner from "../models/DeliveryPartner.js";
import { VENDOR_STATUS } from "../constants/enums.js";
import { JWT_SECRET } from "../config/jwt.js";

let io;

/** @returns {Server} */
export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialised — call initSocket first.");
  return io;
};

/** Origins allowed to open a socket. Same list the HTTP API should accept. */
const allowedOrigins = () => {
  const configured = (process.env.CORS_ORIGINS || process.env.APP_BASE_URL || process.env.FRONTEND_URL || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  if (configured.length) return configured;

  // Nothing configured: allow the local dev servers only. A wildcard here would
  // let any page on the internet open an authenticated socket against this API.
  return ["http://localhost:4173", "http://127.0.0.1:4173"];
};

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: allowedOrigins(), methods: ["GET", "POST"], credentials: true },
    pingTimeout: 60000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      socket.userId = payload.id;
      socket.userType = payload.type;
      return next();
    } catch {
      // Every event this server emits is addressed to somebody. There is no
      // public feed to fall back to, so an unverifiable token gets no socket.
      return next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[SOCKET] connected ${socket.id} (user ${socket.userId})`);

    // ── Buyer ────────────────────────────────────────────────────────────
    // The JWT already says who this is; the argument is discarded.
    socket.on("join_user", () => {
      socket.join(`user:${socket.userId}`);
      console.log(`[SOCKET] ${socket.id} → user:${socket.userId}`);
    });

    // ── Seller ───────────────────────────────────────────────────────────
    socket.on("join_seller", async () => {
      try {
        const seller = await Seller.findOne({ userId: socket.userId }).select("_id status");
        if (!seller) return socket.emit("join_denied", { room: "seller", reason: "No seller profile" });
        // A suspended or still-pending vendor has no business receiving orders.
        if (seller.status !== VENDOR_STATUS.APPROVED) {
          return socket.emit("join_denied", { room: "seller", reason: `Seller is ${seller.status}` });
        }
        socket.join(`seller:${seller._id}`);
        console.log(`[SOCKET] ${socket.id} → seller:${seller._id}`);
      } catch (err) {
        console.error("[SOCKET] join_seller failed:", err.message);
      }
    });

    // ── SHG store ────────────────────────────────────────────────────────
    socket.on("join_shg", async () => {
      try {
        const shgStore = await SHGStore.findOne({ userId: socket.userId }).select("_id status");
        if (!shgStore) return socket.emit("join_denied", { room: "shg", reason: "No SHG store profile" });
        if (shgStore.status !== VENDOR_STATUS.APPROVED) {
          return socket.emit("join_denied", { room: "shg", reason: `SHG store is ${shgStore.status}` });
        }
        socket.join(`shg:${shgStore._id}`);
        console.log(`[SOCKET] ${socket.id} → shg:${shgStore._id}`);
      } catch (err) {
        console.error("[SOCKET] join_shg failed:", err.message);
      }
    });

    // ── Delivery partner ─────────────────────────────────────────────────
    socket.on("join_rider", async () => {
      try {
        const partner = await DeliveryPartner.findOne({ userId: socket.userId }).select("_id status");
        if (!partner) return socket.emit("join_denied", { room: "rider", reason: "No rider profile" });
        if (partner.status !== VENDOR_STATUS.APPROVED) {
          return socket.emit("join_denied", { room: "rider", reason: `Rider is ${partner.status}` });
        }
        socket.join(`rider:${partner._id}`);
        console.log(`[SOCKET] ${socket.id} → rider:${partner._id}`);
      } catch (err) {
        console.error("[SOCKET] join_rider failed:", err.message);
      }
    });

    // ── Admin ────────────────────────────────────────────────────────────
    // Admin is a separate model from User (models/Admin.js), never a vendor
    // record to look up — the JWT's own `type: "admin"` (see auth
    // middleware above) is the whole check. One shared room rather than
    // one per admin: every admin sees the same support-ticket queue, so a
    // "something changed" ping is meaningful to all of them at once. This
    // is the smallest room that gives Admin ANY real-time channel at all —
    // previously it had none (a pure HTTP-polling dashboard).
    socket.on("join_admin", () => {
      if (socket.userType !== "admin") {
        return socket.emit("join_denied", { room: "admin", reason: "Not an admin session" });
      }
      socket.join("admin:all");
      console.log(`[SOCKET] ${socket.id} → admin:all`);
    });

    socket.on("disconnect", () => {
      console.log(`[SOCKET] disconnected ${socket.id}`);
    });
  });

  console.log("Socket.io initialised");
  return io;
};
