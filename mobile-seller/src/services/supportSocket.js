import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import { API_BASE_URL, API_CONFIGURED } from '../config/env';

/**
 * Socket.IO connection for live chat support (backend/socket/supportChat.socket.js).
 * Authenticated with the seller session JWT in the handshake; the server decides
 * the chat role and rooms from that token, never from anything sent here.
 * The chat also works over REST alone, so a missing connection only delays updates.
 */
let socket = null;
let currentToken = null;

const origin = () => {
  try { return new URL(API_BASE_URL).origin; } catch { return null; }
};

export function getSupportSocket(token) {
  if (!API_CONFIGURED || !token) return null;
  if (socket && currentToken === token) {
    if (!socket.connected && !socket.active) socket.connect();
    return socket;
  }
  closeSupportSocket();
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
  return socket;
}

/** Call on sign-out so the next account never inherits this connection. */
export function closeSupportSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
  }
  socket = null;
  currentToken = null;
}

// Back in the foreground: reconnect now instead of waiting out the retry delay.
AppState.addEventListener('change', (state) => {
  if (state === 'active' && socket && !socket.connected && !socket.active) socket.connect();
});
