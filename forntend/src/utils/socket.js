import { io } from 'socket.io-client';

// Construct socket instance pointing to our VITE_API_BASE_URL.
// We keep autoConnect: false so we only connect when the user is logged in
// and we have an identity to authenticate.
//
// `??`, not `||` (same reasoning as api.js's API_BASE_URL): an intentionally
// empty VITE_API_BASE_URL means same-origin, which is exactly this app's
// production deploy — where the frontend and the socket server are the same
// process. An empty string is passed through to `window.location.origin`
// explicitly rather than handed to `io()` as-is, since socket.io-client's
// same-origin behaviour is documented for a missing/undefined URL, not for
// an empty string.
const rawApiUrl = import.meta.env.VITE_API_BASE_URL;
const socketUrl = (rawApiUrl !== undefined && rawApiUrl !== null && rawApiUrl !== '')
  ? rawApiUrl
  : (typeof window !== 'undefined' ? window.location.origin : '');



export const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
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

  socket.auth = { token };

  if (!socket.connected) {
    socket.connect();
  }

  // Join the appropriate real-time updates room based on user role
  if (role === 'buyer') {
    socket.emit('join_user', id);
  } else if (role === 'seller') {
    socket.emit('join_seller', id);
  } else if (role === 'delivery') {
    socket.emit('join_rider', id);
  } else if (role === 'admin') {
    socket.emit('join_admin');
  }
};

/** Disconnect socket.io client (e.g. on logout) */
export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
  }
};
