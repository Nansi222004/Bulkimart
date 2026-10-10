/**
 * rooms.js — Emit helpers for controller use.
 *
 * Controllers import these instead of calling getIO() directly so:
 *   1. The room naming convention is defined in ONE place.
 *   2. It's easy to add logging / throttling here later.
 *   3. Tests can mock this module without touching Socket.io.
 */

import { getIO } from "./socket.js";

/** Emit to a single buyer / user. */
export const emitToUser = (userId, event, payload) => {
  getIO().to(`user:${userId}`).emit(event, payload);
};

/** Emit to a single seller. */
export const emitToSeller = (sellerId, event, payload) => {
  getIO().to(`seller:${sellerId}`).emit(event, payload);
};

/** Emit to a single SHG store. */
export const emitToShg = (shgStoreId, event, payload) => {
  getIO().to(`shg:${shgStoreId}`).emit(event, payload);
};

/** Emit to a single delivery partner. */
export const emitToRider = (partnerId, event, payload) => {
  getIO().to(`rider:${partnerId}`).emit(event, payload);
};

/** Emit to every connected admin at once — see socket.js's `join_admin`. */
export const emitToAdmins = (event, payload) => {
  getIO().to('admin:all').emit(event, payload);
};

/**
 * Broadcast to several delivery partners at once (order ping).
 * @param {string[]} partnerIds
 */
export const broadcastToRiders = (partnerIds, event, payload) => {
  const io = getIO();
  for (const id of partnerIds) {
    io.to(`rider:${id}`).emit(event, payload);
  }
};
