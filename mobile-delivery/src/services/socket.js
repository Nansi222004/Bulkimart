import { io } from 'socket.io-client';
import { API_BASE_URL, API_CONFIGURED } from '../config/env';

/**
 * Live rider events, same Socket.IO server the web portal uses (backend/socket/socket.js).
 * The JWT goes in the handshake; the server resolves the rider room from that token
 * (join_rider ignores any client-supplied id and refuses non-approved partners).
 *
 * Events the app listens to (emitted by deliveryPartner.controller.js / returnPickup.service.js):
 *   rider_ping, ping_cancelled, delivery_assigned, return_pickup_ping,
 *   notification_new, rider_rating_updated, connect
 * The socket only makes things appear faster. Every screen is reconciled by polling the REST API.
 */
let socket = null;
let currentToken = null;

const origin = () => {
  try { return new URL(API_BASE_URL).origin; } catch { return null; }
};

export function connectRiderSocket(token) {
  if (!API_CONFIGURED || !token) return null;
  if (socket && currentToken === token) {
    if (!socket.connected && !socket.active) socket.connect();
    return socket;
  }
  disconnectRiderSocket();
  const url = origin();
  if (!url) return null;
  currentToken = token;
  socket = io(url, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });
  // Room membership is per connection, so it is requested again after every reconnect.
  socket.on('connect', () => socket?.emit('join_rider'));
  return socket;
}

export function disconnectRiderSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  socket = null;
  currentToken = null;
}

/** Subscribe to one event; returns an unsubscribe function. Safe to call before a connection exists. */
export function onRiderEvent(event, handler) {
  const s = socket;
  if (!s) return () => {};
  s.on(event, handler);
  return () => s.off(event, handler);
}

export const getRiderSocket = () => socket;
