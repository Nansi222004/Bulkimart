/**
 * socket.js — Socket.io server initialiser.
 *
 * Rooms are named after the identity they belong to:
 *   "user:<userId>"        — the buyer
 *   "seller:<sellerId>"    — the Seller document, not the User behind it
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
import Seller from "../models/Seller.js";
import DeliveryPartner from "../models/DeliveryPartner.js";
import { VENDOR_STATUS } from "../constants/enums.js";
import { verifySessionToken } from "../config/jwt.js";
import { getAllowedOrigins } from "../config/cors.js";

let io;

/** @returns {Server} */
export const getIO = () => {
  if (!io) throw new Error("Socket.io not initialised — call initSocket first.");
  return io;
};

export const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: getAllowedOrigins(), methods: ["GET", "POST"], credentials: true },
    pingTimeout: 60000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));

    try {
      const payload = verifySessionToken(token);
      socket.userId = payload.id;
      socket.userType = payload.type;
      return next();
    } catch {
      // Every event this server emits is addressed to somebody. There is no
      // public feed to fall back to, so an unverifiable token gets no socket.
      return next(new Error("Invalid or expired token"));
    }
  });

  io.engine.on('connection_error', (error) => {
    // Engine.IO codes distinguish unknown SID (1), bad request (3), origin
    // rejection (4), etc. Never log the request URL, SID, token or headers.
    console.warn(JSON.stringify({ event: 'socket_transport_error', code: Number(error.code), instance: process.pid }));
  });

  io.on("connection", (socket) => {

    // ── Buyer ────────────────────────────────────────────────────────────
    // The JWT already says who this is; the argument is discarded.
    socket.on("join_user", () => {
      socket.join(`user:${socket.userId}`);
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
      } catch (err) {
        console.error('[SOCKET] Seller room lookup failed');
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
      } catch (err) {
        console.error('[SOCKET] Rider room lookup failed');
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
    });

  });

  console.log("Socket.io initialised");
  return io;
};
