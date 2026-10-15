import { io } from 'socket.io-client';
import { API_BASE_URL } from './api';

// Use the same host as HTTP, including VITE_API_URL configurations ending in
// /api. Socket.IO uses its own /socket.io path, not an /api namespace.
export const resolveSocketOrigin = (base = API_BASE_URL) => {
  try { return new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').origin; }
  catch { return typeof window !== 'undefined' ? window.location.origin : ''; }
};
const socketUrl = resolveSocketOrigin();



export const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  withCredentials: true,
});

let identity = null;
let transportIdentity = null;
let disposal;
// Each Engine.IO connection has fresh room membership, including reconnects.
socket.on('connect', () => {
  if (!identity) return;
  const event = { buyer: 'join_user', seller: 'join_seller', delivery: 'join_rider', admin: 'join_admin' }[identity.role];
  if (event) socket.emit(event, identity.id);
});

/**
 * Initialise socket connection and authenticate with the user token.
 * Joins user, seller, or rider rooms based on the active role.
 *
 * @param {string} token - The auth token
 * @param {string} role - 'buyer' | 'seller' | 'delivery'
 * @param {string} id - The MongoDB profile ID to join the room
 */
export const connectSocket = (token, role, id) => {
  if (!token) return;
  clearTimeout(disposal);
  if (transportIdentity && (transportIdentity.token !== token || transportIdentity.role !== role || transportIdentity.id !== id)) {
    socket.disconnect();
    socket.sendBuffer.length = 0;
  }
  identity = { token, role, id };
  transportIdentity = identity;
  socket.auth = { token };
  if (!socket.connected && !socket.active) {
    socket.connect();
  }
};

/** Disconnect socket.io client (e.g. on logout) */
export const disconnectSocket = () => {
  identity = null;
  clearTimeout(disposal);
  // Cancel opening connections too. One task of grace prevents StrictMode's
  // immediate effect replay from tearing down and reopening the transport.
  disposal = setTimeout(() => {
    if (identity) return;
    socket.disconnect();
    socket.auth = {};
    transportIdentity = null;
    socket.sendBuffer.length = 0;
  }, 0);
};
